import type { FastifyInstance } from 'fastify'
import { eq, and, sum, count, sql } from 'drizzle-orm'
import { desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { members, invoices, payouts, branches, settingsVersions } from '../db/schema.js'
import type { SettingsPayload } from '../types/settings.js'
import type { TierLevel } from '../services/calculation.js'

export async function dashboardRoutes(app: FastifyInstance) {

  // GET /api/dashboard
  app.get('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = (req as any).user
    const branchFilter = user.role !== 'super_admin' ? user.branchId : null

    const memberConditions  = [eq(members.active, true)]
    const invoiceConditions = [eq(invoices.status, 'confirmed')]
    if (branchFilter) {
      memberConditions.push(eq(members.branchId, branchFilter))
      invoiceConditions.push(eq(invoices.branchId, branchFilter))
    }

    // All queries fired in parallel
    const [
      [memberStats],
      allMembers,
      [invoiceStats],
      [pendingPayouts],
      [paidPayouts],
      [latestSettings],
      branchBreakdown,
    ] = await Promise.all([
      db.select({
        total:    count(),
        gold:     sql<number>`count(*) filter (where discount_tier = 'gold')`,
        platinum: sql<number>`count(*) filter (where discount_tier = 'platinum')`,
        diamond:  sql<number>`count(*) filter (where discount_tier = 'diamond')`,
      }).from(members).where(and(...memberConditions)),

      db.select({ ytdPoints: members.ytdPoints, pointsTier: members.pointsTier })
        .from(members).where(and(...memberConditions)),

      db.select({
        totalInvoices:  count(),
        totalSaleValue: sum(invoices.invoiceValue),
        totalDiscount:  sum(invoices.discountAmount),
      }).from(invoices).where(and(...invoiceConditions)),

      db.select({ count: count(), totalCash: sum(payouts.cashValue) })
        .from(payouts).where(eq(payouts.status, 'pending')),

      db.select({ totalCash: sum(payouts.cashValue) })
        .from(payouts).where(eq(payouts.status, 'paid')),

      db.select().from(settingsVersions).orderBy(desc(settingsVersions.validFrom)).limit(1),

      user.role === 'super_admin'
        ? db.select({
            branchId:   branches.branchId,
            branchName: branches.name,
            members:    sql<number>`(select count(*) from members where branch_id = branches.branch_id and active = true)`,
            ytdSales:   sql<number>`(select coalesce(sum(invoice_value), 0) from invoices where branch_id = branches.branch_id and status = 'confirmed')`,
          }).from(branches).where(eq(branches.active, true))
        : Promise.resolve(null),
    ])

    const settings = latestSettings?.payload as SettingsPayload | undefined

    let totalBalanceAmount = 0
    if (settings) {
      for (const m of allMembers) {
        const rate = settings.pointsTiers[m.pointsTier as TierLevel]?.redemptionRate ?? 0
        totalBalanceAmount += m.ytdPoints * rate
      }
    }
    totalBalanceAmount = Math.round(totalBalanceAmount * 100) / 100

    const totalSaleValue   = Number(invoiceStats?.totalSaleValue ?? 0)
    const totalDiscount    = Number(invoiceStats?.totalDiscount  ?? 0)
    const totalPaidPayouts = Number(paidPayouts?.totalCash       ?? 0)

    const actualGrossPercent      = totalSaleValue > 0
      ? Math.round(((totalDiscount + totalPaidPayouts) / totalSaleValue) * 10000) / 100
      : 0
    const theoreticalGrossPercent = totalSaleValue > 0
      ? Math.round(((totalDiscount + totalPaidPayouts + totalBalanceAmount) / totalSaleValue) * 10000) / 100
      : 0

    return reply.send({
      members: {
        total:    Number(memberStats?.total    ?? 0),
        gold:     Number(memberStats?.gold     ?? 0),
        platinum: Number(memberStats?.platinum ?? 0),
        diamond:  Number(memberStats?.diamond  ?? 0),
      },
      invoices: {
        total:          Number(invoiceStats?.totalInvoices  ?? 0),
        totalSaleValue,
        totalDiscount,
      },
      pendingPayouts: {
        count:     Number(pendingPayouts?.count     ?? 0),
        totalCash: Number(pendingPayouts?.totalCash ?? 0),
      },
      paidPayouts: {
        totalCash: totalPaidPayouts,
      },
      totalBalanceAmount,
      actualGrossPercent,
      theoreticalGrossPercent,
      branchBreakdown,
    })
  })
}
