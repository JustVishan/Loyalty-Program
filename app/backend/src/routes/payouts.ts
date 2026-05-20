import type { FastifyInstance } from 'fastify'
import { z } from 'zod/v4'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { payouts, members, settingsVersions, users } from '../db/schema.js'
import { calculatePayout } from '../services/calculation.js'
import { writeAudit } from '../lib/audit.js'
import { verifyPassword } from '../lib/auth.js'
import type { SettingsPayload } from '../types/settings.js'

export async function payoutRoutes(app: FastifyInstance) {

  // GET /api/payouts
  app.get('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user  = (req as any).user
    const query = req.query as any
    const conditions = []

    if (user.role !== 'super_admin') {
      // Join via member to filter by branch
      const branchMembers = await db.select({ memberId: members.memberId })
        .from(members).where(eq(members.branchId, user.branchId))
      const memberIds = branchMembers.map(m => m.memberId)
      if (memberIds.length === 0) return reply.send([])
    }

    if (query.memberId) conditions.push(eq(payouts.memberId, query.memberId))
    if (query.status)   conditions.push(eq(payouts.status,   query.status))

    const rows = await db.select({
      payoutId:              payouts.payoutId,
      memberId:              payouts.memberId,
      memberName:            members.name,
      memberPhone:           members.phone,
      pointsRedeemed:        payouts.pointsRedeemed,
      cashValue:             payouts.cashValue,
      redemptionRateApplied: payouts.redemptionRateApplied,
      status:                payouts.status,
      confirmedAt:           payouts.confirmedAt,
      paidAt:                payouts.paidAt,
      createdAt:             payouts.createdAt,
    }).from(payouts)
      .innerJoin(members, eq(payouts.memberId, members.memberId))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(payouts.createdAt))

    return reply.send(rows)
  })

  // POST /api/payouts  — create redemption request
  app.post('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = (req as any).user
    const body = z.object({
      memberId:       z.string().uuid(),
      pointsToRedeem: z.number().int().positive(),
      password:       z.string().min(1),
    }).parse(req.body)

    // Verify the requesting user's password before proceeding
    const [reqUser] = await db.select({ passwordHash: users.passwordHash })
      .from(users).where(eq(users.userId, user.sub)).limit(1)
    if (!reqUser) return reply.status(401).send({ error: 'User not found' })
    const passwordOk = await verifyPassword(body.password, reqUser.passwordHash)
    if (!passwordOk) return reply.status(403).send({ error: 'Incorrect password' })

    const [member] = await db.select().from(members).where(eq(members.memberId, body.memberId)).limit(1)
    if (!member) return reply.status(404).send({ error: 'Member not found' })

    if (user.role !== 'super_admin' && member.branchId !== user.branchId) {
      return reply.status(403).send({ error: 'Access denied' })
    }

    if (body.pointsToRedeem > member.ytdPoints) {
      return reply.status(400).send({ error: `Insufficient points. Available: ${member.ytdPoints}` })
    }

    const [latestSettings] = await db.select().from(settingsVersions)
      .orderBy(desc(settingsVersions.validFrom)).limit(1)
    if (!latestSettings) return reply.status(500).send({ error: 'No settings configured' })

    const settings = latestSettings.payload as SettingsPayload
    const { cashValue, redemptionRate } = calculatePayout(body.pointsToRedeem, member.pointsTier, settings)

    const [payout] = await db.insert(payouts).values({
      memberId:              body.memberId,
      pointsRedeemed:        body.pointsToRedeem,
      cashValue:             cashValue.toString(),
      redemptionRateApplied: redemptionRate.toString(),
      settingsVersionId:     latestSettings.versionId,
      createdBy:             user.sub,
    }).returning()

    await writeAudit({
      userId: user.sub, userRole: user.role,
      action: 'payout_created',
      entityType: 'payout', entityId: payout.payoutId,
      newValue: { pointsRedeemed: body.pointsToRedeem, cashValue },
      ipAddress: req.ip,
    })

    return reply.status(201).send(payout)
  })

  // PATCH /api/payouts/:id/confirm  (branch admin+)
  app.patch('/:id/confirm', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const user   = (req as any).user

    if (user.role === 'user') return reply.status(403).send({ error: 'Admins only' })

    const [payout] = await db.select().from(payouts).where(eq(payouts.payoutId, id)).limit(1)
    if (!payout)                        return reply.status(404).send({ error: 'Payout not found' })
    if (payout.status !== 'pending')    return reply.status(400).send({ error: `Cannot confirm — status is ${payout.status}` })

    await db.update(payouts).set({ status: 'confirmed', confirmedBy: user.sub, confirmedAt: new Date() })
      .where(eq(payouts.payoutId, id))

    await writeAudit({
      userId: user.sub, userRole: user.role,
      action: 'payout_confirmed',
      entityType: 'payout', entityId: id,
      ipAddress: req.ip,
    })

    return reply.send({ success: true })
  })

  // PATCH /api/payouts/:id/paid  (branch admin+)
  app.patch('/:id/paid', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const user   = (req as any).user

    if (user.role === 'user') return reply.status(403).send({ error: 'Admins only' })

    const [payout] = await db.select().from(payouts).where(eq(payouts.payoutId, id)).limit(1)
    if (!payout)                        return reply.status(404).send({ error: 'Payout not found' })
    if (payout.status !== 'confirmed')  return reply.status(400).send({ error: 'Payout must be confirmed before marking paid' })

    const [member] = await db.select().from(members).where(eq(members.memberId, payout.memberId)).limit(1)

    await db.transaction(async (tx) => {
      await tx.update(payouts).set({ status: 'paid', paidBy: user.sub, paidAt: new Date() })
        .where(eq(payouts.payoutId, id))

      // Deduct points from member
      await tx.update(members).set({ ytdPoints: (member!.ytdPoints - payout.pointsRedeemed) })
        .where(eq(members.memberId, payout.memberId))
    })

    await writeAudit({
      userId: user.sub, userRole: user.role,
      action: 'payout_paid',
      entityType: 'payout', entityId: id,
      newValue: { cashValue: payout.cashValue, pointsRedeemed: payout.pointsRedeemed },
      ipAddress: req.ip,
    })

    return reply.send({ success: true })
  })
}
