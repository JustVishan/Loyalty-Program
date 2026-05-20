export interface TierConfig {
  threshold:    number   // annual sale value in ₹
  discountRate: number   // e.g. 0.08 for 8%
}

export interface PointsTierConfig {
  multiplier:     number  // e.g. 1.5
  redemptionRate: number  // ₹ per point e.g. 1.25
  // threshold is shared with discountTiers — not stored separately
}

export interface MilestoneConfig {
  number:    1 | 2 | 3
  threshold: number   // cumulative points
  lumpSum:   number   // bonus points awarded once
  boostRate: number   // e.g. 0.05 for 5%
}

export interface SettingsPayload {
  discountTiers: {
    gold:     TierConfig
    platinum: TierConfig
    diamond:  TierConfig
  }
  pointsTiers: {
    gold:     PointsTierConfig
    platinum: PointsTierConfig
    diamond:  PointsTierConfig
  }
  baseEarnRate: number    // points per ₹1,000 (default: 1)
  milestones:  MilestoneConfig[]
}

export const DEFAULT_SETTINGS: SettingsPayload = {
  discountTiers: {
    gold:     { threshold: 1_000_000,  discountRate: 0.08 },
    platinum: { threshold: 3_000_000,  discountRate: 0.10 },
    diamond:  { threshold: 5_000_000,  discountRate: 0.12 },
  },
  pointsTiers: {
    gold:     { multiplier: 1.0, redemptionRate: 1.00 },
    platinum: { multiplier: 1.5, redemptionRate: 1.25 },
    diamond:  { multiplier: 2.0, redemptionRate: 1.70 },
  },
  baseEarnRate: 1,
  milestones: [
    { number: 1, threshold: 2_000,  lumpSum: 100, boostRate: 0.05 },
    { number: 2, threshold: 5_000,  lumpSum: 200, boostRate: 0.10 },
    { number: 3, threshold: 10_000, lumpSum: 300, boostRate: 0.15 },
  ],
}
