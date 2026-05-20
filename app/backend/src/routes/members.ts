import type { FastifyInstance } from 'fastify'
import { z } from 'zod/v4'
import { eq, and, ilike, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { members, users, branches, settingsVersions } from '../db/schema.js'
import { writeAudit } from '../lib/audit.js'
import type { SettingsPayload } from '../types/settings.js'
import type { TierLevel } from '../services/calculation.js'

export async function memberRoutes(app: FastifyInstance) {

  // GET /api/members
  app.get('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user  = (req as any).user
    const query = req.query as any

    const conditions = []

    // Branch admins and users only see their own branch
    if (user.role !== 'super_admin') {
      conditions.push(eq(members.branchId, user.branchId))
    } else if (query.branchId) {
      conditions.push(eq(members.branchId, query.branchId))
    }

    if (query.search) {
      conditions.push(ilike(members.name, `%${query.search}%`))
    }

    if (query.active !== undefined) {
      conditions.push(eq(members.active, query.active === 'true'))
    }

    const rows = await db.select({
      memberId:     members.memberId,
      name:         members.name,
      phone:        members.phone,
      type:         members.type,
      branchId:     members.branchId,
      discountTier: members.discountTier,
      pointsTier:   members.pointsTier,
      ytdSaleValue: members.ytdSaleValue,
      ytdPoints:    members.ytdPoints,
      active:       members.active,
      joinedAt:     members.joinedAt,
      customDiscountRate: members.customDiscountRate,
    })
      .from(members)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(members.name)

    return reply.send(rows)
  })

  // GET /api/members/:id
  app.get('/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const user   = (req as any).user

    const [member] = await db.select().from(members).where(eq(members.memberId, id)).limit(1)
    if (!member) return reply.status(404).send({ error: 'Member not found' })

    if (user.role !== 'super_admin' && member.branchId !== user.branchId) {
      return reply.status(403).send({ error: 'Access denied' })
    }

    const [latestSettings] = await db.select()
      .from(settingsVersions).orderBy(desc(settingsVersions.validFrom)).limit(1)
    const settings = latestSettings?.payload as SettingsPayload | undefined
    const redemptionRate = settings?.pointsTiers[member.pointsTier as TierLevel]?.redemptionRate ?? 0
    const pointsCashValue = Math.round(member.ytdPoints * redemptionRate * 100) / 100

    return reply.send({ ...member, pointsCashValue })
  })

  // POST /api/members
  app.post('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = (req as any).user
    const body = z.object({
      name:     z.string().min(1),
      phone:    z.string().regex(/^\d{10}$/, 'Phone must be exactly 10 digits'),
      type:     z.enum(['engineer', 'contractor', 'tile_layer', 'architect']),
      branchId: z.string().uuid(),
    }).parse(req.body)

    // Non-super-admin can only create in their own branch
    if (user.role !== 'super_admin' && body.branchId !== user.branchId) {
      return reply.status(403).send({ error: 'Cannot create member for another branch' })
    }

    const [existing] = await db.select({ memberId: members.memberId })
      .from(members).where(eq(members.phone, body.phone)).limit(1)
    if (existing) return reply.status(409).send({ error: 'A member with this phone number already exists' })

    const [newMember] = await db.insert(members).values({
      name:      body.name,
      phone:     body.phone,
      type:      body.type,
      branchId:  body.branchId,
      createdBy: user.sub,
    }).returning()

    await writeAudit({
      userId: user.sub, userRole: user.role,
      action: 'member_created',
      entityType: 'member', entityId: newMember.memberId,
      newValue: { name: body.name, type: body.type, branchId: body.branchId },
      ipAddress: req.ip,
    })

    return reply.status(201).send(newMember)
  })

  // PATCH /api/members/:id
  app.patch('/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const user   = (req as any).user
    const body   = z.object({
      name:   z.string().min(1).optional(),
      phone:  z.string().regex(/^\d{10}$/, 'Phone must be exactly 10 digits').optional(),
      active: z.boolean().optional(),
    }).parse(req.body)

    const [existing] = await db.select().from(members).where(eq(members.memberId, id)).limit(1)
    if (!existing) return reply.status(404).send({ error: 'Member not found' })

    if (user.role !== 'super_admin' && existing.branchId !== user.branchId) {
      return reply.status(403).send({ error: 'Access denied' })
    }

    const [updated] = await db.update(members).set(body).where(eq(members.memberId, id)).returning()

    await writeAudit({
      userId: user.sub, userRole: user.role,
      action: 'member_updated',
      entityType: 'member', entityId: id,
      oldValue: { name: existing.name, phone: existing.phone, active: existing.active },
      newValue: body,
      ipAddress: req.ip,
    })

    return reply.send(updated)
  })

  // PATCH /api/members/:id/custom-rate  (super admin only)
  app.patch('/:id/custom-rate', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const user   = (req as any).user

    if (user.role !== 'super_admin') return reply.status(403).send({ error: 'Super admin only' })

    const body = z.object({
      customDiscountRate: z.number().min(0).max(1).nullable(),
    }).parse(req.body)

    const [existing] = await db.select().from(members).where(eq(members.memberId, id)).limit(1)
    if (!existing) return reply.status(404).send({ error: 'Member not found' })

    const [updated] = await db.update(members)
      .set({
        customDiscountRate: body.customDiscountRate?.toString(),
        customRateSetBy:    body.customDiscountRate != null ? user.sub : null,
        customRateSetAt:    body.customDiscountRate != null ? new Date() : null,
      })
      .where(eq(members.memberId, id))
      .returning()

    await writeAudit({
      userId: user.sub, userRole: user.role,
      action: 'member_custom_rate_changed',
      entityType: 'member', entityId: id,
      oldValue: { customDiscountRate: existing.customDiscountRate },
      newValue: { customDiscountRate: body.customDiscountRate },
      ipAddress: req.ip,
    })

    return reply.send(updated)
  })
}
