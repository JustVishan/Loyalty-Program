import type { FastifyInstance } from 'fastify'
import { z } from 'zod/v4'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { invoices, members, pointsLedger, settingsVersions } from '../db/schema.js'
import { calculateDiscount, calculatePoints } from '../services/calculation.js'
import { writeAudit } from '../lib/audit.js'
import type { SettingsPayload } from '../types/settings.js'

export async function invoiceRoutes(app: FastifyInstance) {

  // GET /api/invoices
  app.get('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user  = (req as any).user
    const query = req.query as any
    const conditions = []

    if (user.role !== 'super_admin') {
      conditions.push(eq(invoices.branchId, user.branchId))
    } else if (query.branchId) {
      conditions.push(eq(invoices.branchId, query.branchId))
    }

    if (query.memberId) conditions.push(eq(invoices.memberId, query.memberId))
    if (query.status)   conditions.push(eq(invoices.status,   query.status))

    const rows = await db.select().from(invoices)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(invoices.confirmedAt))
      .limit(100)

    return reply.send(rows)
  })

  // GET /api/invoices/:id
  app.get('/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const user   = (req as any).user

    const [invoice] = await db.select().from(invoices).where(eq(invoices.invoiceId, id)).limit(1)
    if (!invoice) return reply.status(404).send({ error: 'Invoice not found' })

    if (user.role !== 'super_admin' && invoice.branchId !== user.branchId) {
      return reply.status(403).send({ error: 'Access denied' })
    }

    const ledgerRows = await db.select().from(pointsLedger).where(eq(pointsLedger.invoiceId, id))
    return reply.send({ ...invoice, ledgerEntries: ledgerRows })
  })

  // GET /api/invoices/preview?memberId=&invoiceValue=&overrideDiscountRate=
  app.get('/preview', { onRequest: [app.authenticate] }, async (req, reply) => {
    const query = z.object({
      memberId:             z.string().uuid(),
      invoiceValue:         z.coerce.number().positive(),
      overrideDiscountRate: z.coerce.number().min(0).max(1).optional(),
    }).parse(req.query)

    const [member] = await db.select().from(members).where(eq(members.memberId, query.memberId)).limit(1)
    if (!member) return reply.status(404).send({ error: 'Member not found' })

    const [latestSettings] = await db.select().from(settingsVersions)
      .orderBy(desc(settingsVersions.validFrom)).limit(1)
    if (!latestSettings) return reply.status(500).send({ error: 'No settings configured' })

    const settings = latestSettings.payload as SettingsPayload

    const discount = calculateDiscount(
      query.invoiceValue,
      member.discountTier,
      settings,
      member.customDiscountRate ? parseFloat(member.customDiscountRate) : null,
      query.overrideDiscountRate ?? null,
    )
    const points = calculatePoints(query.invoiceValue, member.pointsTier, member.ytdPoints, settings)

    return reply.send({ discount, points, memberYtdPoints: member.ytdPoints })
  })

  // POST /api/invoices
  app.post('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = (req as any).user
    const body = z.object({
      memberId:             z.string().uuid(),
      invoiceNumber:        z.string().min(1),
      invoiceValue:         z.number().positive(),
      overrideDiscountRate: z.number().min(0).max(1).optional(),
      overrideReason:       z.string().optional(),
    }).parse(req.body)

    // Validate override fields together
    if ((body.overrideDiscountRate != null) !== (body.overrideReason != null)) {
      return reply.status(400).send({ error: 'overrideDiscountRate and overrideReason must both be provided' })
    }

    // Only branch admin and super admin can apply overrides
    if (body.overrideDiscountRate != null && user.role === 'user') {
      return reply.status(403).send({ error: 'Only admins can apply invoice overrides' })
    }

    const [member] = await db.select().from(members).where(eq(members.memberId, body.memberId)).limit(1)
    if (!member) return reply.status(404).send({ error: 'Member not found' })
    if (!member.active) return reply.status(400).send({ error: 'Member is inactive' })

    if (user.role !== 'super_admin' && member.branchId !== user.branchId) {
      return reply.status(403).send({ error: 'Access denied' })
    }

    // Get active settings version
    const [latestSettings] = await db.select().from(settingsVersions)
      .orderBy(desc(settingsVersions.validFrom)).limit(1)

    if (!latestSettings) return reply.status(500).send({ error: 'No settings configured' })

    const settings = latestSettings.payload as SettingsPayload

    // Discount calculation
    const discount = calculateDiscount(
      body.invoiceValue,
      member.discountTier,
      settings,
      member.customDiscountRate ? parseFloat(member.customDiscountRate) : null,
      body.overrideDiscountRate ?? null,
    )

    // Points calculation
    const cumBefore = member.ytdPoints
    const points    = calculatePoints(body.invoiceValue, member.pointsTier, cumBefore, settings)

    // All writes in one transaction
    await db.transaction(async (tx) => {
      // Insert invoice
      const [invoice] = await tx.insert(invoices).values({
        invoiceNumber:        body.invoiceNumber,
        memberId:             body.memberId,
        branchId:             member.branchId,
        invoiceValue:         body.invoiceValue.toString(),
        discountRateApplied:  discount.discountRate.toString(),
        discountAmount:       discount.discountAmount.toString(),
        netInvoiceValue:      discount.netValue.toString(),
        rateSource:           discount.rateSource,
        overrideDiscountRate: body.overrideDiscountRate?.toString(),
        overrideReason:       body.overrideReason,
        overrideBy:           body.overrideDiscountRate != null ? user.sub : null,
        settingsVersionId:    latestSettings.versionId,
        confirmedBy:          user.sub,
      }).returning()

      // Insert points ledger entries
      for (const entry of points.entries) {
        await tx.insert(pointsLedger).values({
          memberId:          body.memberId,
          invoiceId:         invoice.invoiceId,
          entryType:         entry.entryType,
          points:            entry.points,
          milestoneNumber:   entry.milestoneNumber,
          settingsVersionId: latestSettings.versionId,
          note:              entry.note,
          createdBy:         user.sub,
        })
      }

      // Update member YTD totals
      await tx.update(members).set({
        ytdSaleValue: (parseFloat(member.ytdSaleValue) + body.invoiceValue).toString(),
        ytdPoints:    member.ytdPoints + points.totalPoints,
      }).where(eq(members.memberId, body.memberId))

      await writeAudit({
        userId: user.sub, userRole: user.role,
        action: 'invoice_confirmed',
        entityType: 'invoice', entityId: invoice.invoiceId,
        newValue: { invoiceValue: body.invoiceValue, discountAmount: discount.discountAmount, pointsEarned: points.totalPoints },
        ipAddress: req.ip,
      })

      return reply.status(201).send({
        invoice,
        ledgerEntries: points.entries,
        summary: {
          discountAmount:  discount.discountAmount,
          netInvoiceValue: discount.netValue,
          pointsEarned:    points.totalPoints,
        },
      })
    })
  })

  // POST /api/invoices/:id/void
  app.post('/:id/void', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const user   = (req as any).user
    const body   = z.object({ reason: z.string().min(1) }).parse(req.body)

    if (user.role === 'user') return reply.status(403).send({ error: 'Admins only' })

    const [invoice] = await db.select().from(invoices).where(eq(invoices.invoiceId, id)).limit(1)
    if (!invoice)                       return reply.status(404).send({ error: 'Invoice not found' })
    if (invoice.status === 'voided')    return reply.status(400).send({ error: 'Already voided' })

    if (user.role !== 'super_admin' && invoice.branchId !== user.branchId) {
      return reply.status(403).send({ error: 'Access denied' })
    }

    const [member] = await db.select().from(members).where(eq(members.memberId, invoice.memberId)).limit(1)
    if (!member) return reply.status(404).send({ error: 'Member not found' })

    // Get all ledger entries for this invoice to reverse
    const ledgerRows = await db.select().from(pointsLedger).where(eq(pointsLedger.invoiceId, id))
    const totalPtsToReverse = ledgerRows.reduce((s, r) => s + r.points, 0)

    // Get active settings version for reversal entries
    const [latestSettings] = await db.select().from(settingsVersions)
      .orderBy(desc(settingsVersions.validFrom)).limit(1)

    await db.transaction(async (tx) => {
      // Mark invoice voided
      await tx.update(invoices).set({
        status:     'voided',
        voidedBy:   user.sub,
        voidedAt:   new Date(),
        voidReason: body.reason,
      }).where(eq(invoices.invoiceId, id))

      // Insert reversal entries
      if (totalPtsToReverse > 0) {
        await tx.insert(pointsLedger).values({
          memberId:          invoice.memberId,
          invoiceId:         id,
          entryType:         'reversal',
          points:            -totalPtsToReverse,
          settingsVersionId: latestSettings!.versionId,
          note:              `Reversal for voided invoice ${invoice.invoiceNumber}`,
          createdBy:         user.sub,
        })
      }

      // Update member YTD totals
      await tx.update(members).set({
        ytdSaleValue: (parseFloat(member.ytdSaleValue) - parseFloat(invoice.invoiceValue)).toString(),
        ytdPoints:    member.ytdPoints - totalPtsToReverse,
      }).where(eq(members.memberId, invoice.memberId))
    })

    await writeAudit({
      userId: user.sub, userRole: user.role,
      action: 'invoice_voided',
      entityType: 'invoice', entityId: id,
      oldValue: { status: 'confirmed' },
      newValue: { status: 'voided', reason: body.reason },
      ipAddress: req.ip,
    })

    return reply.send({ success: true })
  })
}
