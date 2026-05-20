import type { SettingsPayload, MilestoneConfig } from '../types/settings.js'

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------

export type TierLevel = 'gold' | 'platinum' | 'diamond'

export interface DiscountResult {
  discountRate:   number   // the rate that was applied
  discountAmount: number   // ₹ value of discount
  netValue:       number   // invoice_value - discount_amount
  rateSource:     'tier' | 'custom_member' | 'invoice_override'
}

export interface LedgerEntry {
  entryType:       'base_earn' | 'lump_sum_bonus' | 'band_boost'
  points:          number
  milestoneNumber: number | null
  note:            string
}

export interface PointsResult {
  entries:     LedgerEntry[]   // rows to insert into points_ledger
  totalPoints: number          // sum of all entries
}

// ---------------------------------------------------------------------------
// DISCOUNT CALCULATION
// Priority: invoice_override > custom_member > tier
// ---------------------------------------------------------------------------

export function calculateDiscount(
  invoiceValue:        number,
  pointsTier:          TierLevel,
  settings:            SettingsPayload,
  customDiscountRate?: number | null,
  overrideRate?:       number | null,
): DiscountResult {
  let rate:       number
  let rateSource: DiscountResult['rateSource']

  if (overrideRate != null && overrideRate > 0) {
    rate       = overrideRate
    rateSource = 'invoice_override'
  } else if (customDiscountRate != null && customDiscountRate > 0) {
    rate       = customDiscountRate
    rateSource = 'custom_member'
  } else {
    rate       = settings.discountTiers[pointsTier].discountRate
    rateSource = 'tier'
  }

  const discountAmount = round2(invoiceValue * rate)
  const netValue       = round2(invoiceValue - discountAmount)

  return { discountRate: rate, discountAmount, netValue, rateSource }
}

// ---------------------------------------------------------------------------
// POINTS CALCULATION
//
// Rules (confirmed from Excel settings sheet):
//   1. base_earn  = FLOOR(invoice_value / 1000) * tier_multiplier
//   2. On the invoice where cumulative points FIRST cross a milestone:
//        - lump_sum_bonus fires (once ever for that milestone)
//        - band_boost does NOT fire on the crossing invoice
//   3. On FUTURE invoices where cum_before >= milestone threshold:
//        - band_boost fires on the portion of base_pts within each band
// ---------------------------------------------------------------------------

export function calculatePoints(
  invoiceValue:   number,
  pointsTier:     TierLevel,
  cumBefore:      number,   // member's ytd_points BEFORE this invoice
  settings:       SettingsPayload,
): PointsResult {
  const tierConfig = settings.pointsTiers[pointsTier]
  const entries:    LedgerEntry[] = []

  // 1. Base points
  const basePoints = Math.floor((invoiceValue / 1000) * tierConfig.multiplier)
  entries.push({
    entryType:       'base_earn',
    points:          basePoints,
    milestoneNumber: null,
    note:            `Base: ₹${invoiceValue} ÷ 1000 × ${tierConfig.multiplier}`,
  })

  // 2. Band boosts — calculated independently per milestone using cumBefore + basePoints.
  //    Boosts do NOT cascade into each other's calculation (matches Excel formula).
  let totalBoost = 0
  for (const milestone of settings.milestones) {
    const nextThreshold = getNextMilestoneThreshold(milestone, settings.milestones)
    const boostPts = computeBandBoost(cumBefore, basePoints, milestone.threshold, nextThreshold, milestone.boostRate)
    if (boostPts > 0) {
      entries.push({
        entryType:       'band_boost',
        points:          boostPts,
        milestoneNumber: milestone.number,
        note:            `Milestone ${milestone.number} band boost ${milestone.boostRate * 100}%`,
      })
      totalBoost += boostPts
    }
  }

  // 3. Lump sums — crossing check uses cumBefore + (base + boosts) together.
  //    This means a boost from a lower milestone can push the cumulative over a higher
  //    milestone threshold within the same invoice (matches Excel I-column formula).
  const ptsEarned = basePoints + totalBoost
  for (const milestone of settings.milestones) {
    const crossesNow = cumBefore < milestone.threshold && (cumBefore + ptsEarned) >= milestone.threshold
    if (crossesNow) {
      entries.push({
        entryType:       'lump_sum_bonus',
        points:          milestone.lumpSum,
        milestoneNumber: milestone.number,
        note:            `Milestone ${milestone.number} crossed — lump sum`,
      })
    }
  }

  const totalPoints = entries.reduce((sum, e) => sum + e.points, 0)
  return { entries, totalPoints }
}

// ---------------------------------------------------------------------------
// ANNUAL REVIEW — TIER UPGRADE / HOLD / DOWNGRADE
//
// Rules (confirmed):
//   - Upgrade: one step only (gold→platinum or platinum→diamond)
//   - Hold: ytd_sale_value >= current threshold but below next
//   - Downgrade: one step only (diamond→platinum, platinum→gold, gold stays gold)
//   - Applies independently to discount_tier and points_tier
// ---------------------------------------------------------------------------

export function reviewTier(
  currentTier:  TierLevel,
  ytdSaleValue: number,
  tierType:     'discount' | 'points',
  settings:     SettingsPayload,
): { newTier: TierLevel; change: 'upgrade' | 'hold' | 'downgrade' } {
  const thresholds           = settings.discountTiers
  const order: TierLevel[]   = ['gold', 'platinum', 'diamond']
  const currentIndex         = order.indexOf(currentTier)

  // Find the highest tier the member's YTD sales qualify for — skip in both directions
  const newTier = [...order]
    .filter(tier => ytdSaleValue >= thresholds[tier].threshold)
    .pop() ?? 'gold' as TierLevel

  const newIndex = order.indexOf(newTier)

  if (newIndex > currentIndex) return { newTier, change: 'upgrade' }
  if (newIndex < currentIndex) return { newTier, change: 'downgrade' }
  return { newTier: currentTier, change: 'hold' }
}

// ---------------------------------------------------------------------------
// PAYOUT CALCULATION
// ---------------------------------------------------------------------------

export function calculatePayout(
  pointsToRedeem: number,
  pointsTier:     TierLevel,
  settings:       SettingsPayload,
): { cashValue: number; redemptionRate: number } {
  const redemptionRate = settings.pointsTiers[pointsTier].redemptionRate
  const cashValue      = round2(pointsToRedeem * redemptionRate)
  return { cashValue, redemptionRate }
}

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

function computeBandBoost(
  cumBefore:     number,
  basePoints:    number,
  milestoneThreshold: number,
  nextThreshold:  number | null,
  boostRate:      number,
): number {
  const bandStart = Math.max(cumBefore, milestoneThreshold)
  const bandEnd   = nextThreshold != null
    ? Math.min(cumBefore + basePoints, nextThreshold)
    : cumBefore + basePoints

  const portionInBand = Math.max(0, bandEnd - bandStart)
  return Math.round(portionInBand * boostRate)
}

function getNextMilestoneThreshold(
  current:    MilestoneConfig,
  milestones: MilestoneConfig[],
): number | null {
  const next = milestones.find(m => m.threshold > current.threshold)
  return next ? next.threshold : null
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
