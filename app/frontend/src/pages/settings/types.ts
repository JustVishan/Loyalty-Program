export interface SettingsPayload {
  discountTiers: {
    gold:     { threshold: number; discountRate: number }
    platinum: { threshold: number; discountRate: number }
    diamond:  { threshold: number; discountRate: number }
  }
  pointsTiers: {
    gold:     { multiplier: number; redemptionRate: number }
    platinum: { multiplier: number; redemptionRate: number }
    diamond:  { multiplier: number; redemptionRate: number }
  }
  baseEarnRate: number
  milestones: Array<{
    number: 1 | 2 | 3
    threshold: number
    lumpSum: number
    boostRate: number
  }>
}
