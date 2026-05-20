export type UserRole    = 'super_admin' | 'branch_admin' | 'user'
export type TierLevel   = 'gold' | 'platinum' | 'diamond'
export type MemberType  = 'engineer' | 'contractor' | 'tile_layer' | 'architect'
export type PayoutStatus = 'pending' | 'confirmed' | 'paid'

export interface AuthUser {
  userId:   string
  username: string
  role:     UserRole
  branchId: string | null
}

export interface Branch {
  branchId: string
  name:     string
  location: string | null
  active:   boolean
}

export interface Member {
  memberId:           string
  name:               string
  phone:              string
  type:               MemberType
  branchId:           string
  discountTier:       TierLevel
  pointsTier:         TierLevel
  ytdSaleValue:       string
  ytdPoints:          number
  active:             boolean
  joinedAt:           string
  customDiscountRate: string | null
  pointsCashValue?:   number
}

export interface Invoice {
  invoiceId:           string
  invoiceNumber:       string
  memberId:            string
  branchId:            string
  invoiceValue:        string
  discountRateApplied: string
  discountAmount:      string
  netInvoiceValue:     string
  rateSource:          'tier' | 'custom_member' | 'invoice_override'
  status:              'confirmed' | 'voided'
  confirmedAt:         string
  overrideReason:      string | null
}

export interface Payout {
  payoutId:              string
  memberId:              string
  memberName:            string
  memberPhone:           string
  pointsRedeemed:        number
  cashValue:             string
  redemptionRateApplied: string
  status:                PayoutStatus
  confirmedAt:           string | null
  paidAt:                string | null
  createdAt:             string
}

export interface DashboardStats {
  members: {
    total: number; gold: number; platinum: number; diamond: number
  }
  invoices: {
    total: number; totalSaleValue: number; totalDiscount: number
  }
  pendingPayouts: {
    count: number; totalCash: number
  }
  paidPayouts: {
    totalCash: number
  }
  totalBalanceAmount:      number
  actualGrossPercent:      number
  theoreticalGrossPercent: number
  branchBreakdown: Array<{
    branchId: string; branchName: string; members: number; ytdSales: number
  }> | null
}
