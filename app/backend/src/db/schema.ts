import {
  pgTable, pgEnum, uuid, varchar, boolean, integer,
  decimal, text, timestamp, date, jsonb, inet, unique,
  check,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'

// ---------------------------------------------------------------------------
// ENUMS
// ---------------------------------------------------------------------------

export const memberTypeEnum    = pgEnum('member_type',    ['engineer', 'contractor', 'tile_layer', 'architect'])
export const tierLevelEnum     = pgEnum('tier_level',     ['gold', 'platinum', 'diamond'])
export const tierTypeEnum      = pgEnum('tier_type',      ['discount', 'points'])
export const rateSourceEnum    = pgEnum('rate_source',    ['tier', 'custom_member', 'invoice_override'])
export const invoiceStatusEnum = pgEnum('invoice_status', ['confirmed', 'voided'])
export const ledgerEntryEnum   = pgEnum('ledger_entry',   ['base_earn', 'lump_sum_bonus', 'band_boost', 'redemption', 'reversal'])
export const payoutStatusEnum  = pgEnum('payout_status',  ['pending', 'confirmed', 'paid'])
export const userRoleEnum      = pgEnum('user_role',      ['super_admin', 'branch_admin', 'user'])
export const tierChangeEnum    = pgEnum('tier_change',    ['initial', 'annual_review'])

// ---------------------------------------------------------------------------
// BRANCHES
// ---------------------------------------------------------------------------

export const branches = pgTable('branches', {
  branchId:  uuid('branch_id').primaryKey().defaultRandom(),
  name:      varchar('name', { length: 100 }).notNull(),
  location:  varchar('location', { length: 200 }),
  active:    boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ---------------------------------------------------------------------------
// SETTINGS VERSIONS  (insert-only)
// ---------------------------------------------------------------------------

export const settingsVersions = pgTable('settings_versions', {
  versionId: uuid('version_id').primaryKey().defaultRandom(),
  validFrom: timestamp('valid_from', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // Full settings snapshot. Shape defined in types/settings.ts
  payload:   jsonb('payload').notNull(),
})

// ---------------------------------------------------------------------------
// USERS
// ---------------------------------------------------------------------------

export const users = pgTable('users', {
  userId:               uuid('user_id').primaryKey().defaultRandom(),
  username:             varchar('username', { length: 50 }).notNull().unique(),
  passwordHash:         varchar('password_hash', { length: 255 }).notNull(),
  role:                 userRoleEnum('role').notNull(),
  branchId:             uuid('branch_id').references(() => branches.branchId),
  totpSecret:           varchar('totp_secret', { length: 255 }),
  totpVerified:         boolean('totp_verified').notNull().default(false),
  active:               boolean('active').notNull().default(true),
  failedLoginAttempts:  integer('failed_login_attempts').notNull().default(0),
  lockedAt:             timestamp('locked_at', { withTimezone: true }),
  lastLoginAt:          timestamp('last_login_at', { withTimezone: true }),
  createdBy:            uuid('created_by'),
  createdAt:            timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ---------------------------------------------------------------------------
// MEMBERS
// ---------------------------------------------------------------------------

export const members = pgTable('members', {
  memberId:           uuid('member_id').primaryKey().defaultRandom(),
  name:               varchar('name', { length: 200 }).notNull(),
  phone:              varchar('phone', { length: 20 }).notNull().unique(),
  type:               memberTypeEnum('type').notNull(),
  branchId:           uuid('branch_id').notNull().references(() => branches.branchId),
  discountTier:       tierLevelEnum('discount_tier').notNull().default('gold'),
  pointsTier:         tierLevelEnum('points_tier').notNull().default('gold'),
  customDiscountRate: decimal('custom_discount_rate', { precision: 5, scale: 4 }),
  customRateSetBy:    uuid('custom_rate_set_by').references(() => users.userId),
  customRateSetAt:    timestamp('custom_rate_set_at', { withTimezone: true }),
  ytdSaleValue:       decimal('ytd_sale_value', { precision: 15, scale: 2 }).notNull().default('0'),
  ytdPoints:          integer('ytd_points').notNull().default(0),
  active:             boolean('active').notNull().default(true),
  joinedAt:           timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy:          uuid('created_by').references(() => users.userId),
  createdAt:          timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ---------------------------------------------------------------------------
// INVOICES
// ---------------------------------------------------------------------------

export const invoices = pgTable('invoices', {
  invoiceId:            uuid('invoice_id').primaryKey().defaultRandom(),
  invoiceNumber:        varchar('invoice_number', { length: 50 }).notNull().unique(),
  memberId:             uuid('member_id').notNull().references(() => members.memberId),
  branchId:             uuid('branch_id').notNull().references(() => branches.branchId),
  invoiceValue:         decimal('invoice_value', { precision: 15, scale: 2 }).notNull(),
  discountRateApplied:  decimal('discount_rate_applied', { precision: 5, scale: 4 }).notNull(),
  discountAmount:       decimal('discount_amount', { precision: 15, scale: 2 }).notNull(),
  netInvoiceValue:      decimal('net_invoice_value', { precision: 15, scale: 2 }).notNull(),
  rateSource:           rateSourceEnum('rate_source').notNull(),
  overrideDiscountRate: decimal('override_discount_rate', { precision: 5, scale: 4 }),
  overrideReason:       text('override_reason'),
  overrideBy:           uuid('override_by').references(() => users.userId),
  settingsVersionId:    uuid('settings_version_id').notNull().references(() => settingsVersions.versionId),
  status:               invoiceStatusEnum('status').notNull().default('confirmed'),
  voidedBy:             uuid('voided_by').references(() => users.userId),
  voidedAt:             timestamp('voided_at', { withTimezone: true }),
  voidReason:           text('void_reason'),
  confirmedBy:          uuid('confirmed_by').notNull().references(() => users.userId),
  confirmedAt:          timestamp('confirmed_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt:            timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ---------------------------------------------------------------------------
// POINTS LEDGER  (insert-only)
// ---------------------------------------------------------------------------

export const pointsLedger = pgTable('points_ledger', {
  ledgerId:          uuid('ledger_id').primaryKey().defaultRandom(),
  memberId:          uuid('member_id').notNull().references(() => members.memberId),
  invoiceId:         uuid('invoice_id').references(() => invoices.invoiceId),
  entryType:         ledgerEntryEnum('entry_type').notNull(),
  points:            integer('points').notNull(),
  milestoneNumber:   integer('milestone_number'),
  settingsVersionId: uuid('settings_version_id').notNull().references(() => settingsVersions.versionId),
  note:              text('note'),
  createdBy:         uuid('created_by').references(() => users.userId),
  createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ---------------------------------------------------------------------------
// PAYOUTS
// ---------------------------------------------------------------------------

export const payouts = pgTable('payouts', {
  payoutId:              uuid('payout_id').primaryKey().defaultRandom(),
  memberId:              uuid('member_id').notNull().references(() => members.memberId),
  pointsRedeemed:        integer('points_redeemed').notNull(),
  cashValue:             decimal('cash_value', { precision: 15, scale: 2 }).notNull(),
  redemptionRateApplied: decimal('redemption_rate_applied', { precision: 8, scale: 4 }).notNull(),
  settingsVersionId:     uuid('settings_version_id').notNull().references(() => settingsVersions.versionId),
  status:                payoutStatusEnum('status').notNull().default('pending'),
  confirmedBy:           uuid('confirmed_by').references(() => users.userId),
  confirmedAt:           timestamp('confirmed_at', { withTimezone: true }),
  paidBy:                uuid('paid_by').references(() => users.userId),
  paidAt:                timestamp('paid_at', { withTimezone: true }),
  createdBy:             uuid('created_by').notNull().references(() => users.userId),
  createdAt:             timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ---------------------------------------------------------------------------
// TIER HISTORY  (append-only)
// ---------------------------------------------------------------------------

export const tierHistory = pgTable('tier_history', {
  historyId:     uuid('history_id').primaryKey().defaultRandom(),
  memberId:      uuid('member_id').notNull().references(() => members.memberId),
  tierType:      tierTypeEnum('tier_type').notNull(),
  oldTier:       tierLevelEnum('old_tier').notNull(),
  newTier:       tierLevelEnum('new_tier').notNull(),
  effectiveDate: date('effective_date').notNull(),
  reason:        tierChangeEnum('reason').notNull(),
  reviewYear:    integer('review_year').notNull(),
  createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ---------------------------------------------------------------------------
// YEARLY SNAPSHOTS
// ---------------------------------------------------------------------------

export const yearlySnapshots = pgTable('yearly_snapshots', {
  snapshotId:       uuid('snapshot_id').primaryKey().defaultRandom(),
  memberId:         uuid('member_id').notNull().references(() => members.memberId),
  year:             integer('year').notNull(),
  ytdSaleValue:     decimal('ytd_sale_value', { precision: 15, scale: 2 }).notNull(),
  discountTier:     tierLevelEnum('discount_tier').notNull(),
  pointsTier:       tierLevelEnum('points_tier').notNull(),
  ytdPointsEarned:  integer('ytd_points_earned').notNull(),
  ytdRedemptions:   decimal('ytd_redemptions', { precision: 15, scale: 2 }).notNull().default('0'),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique().on(t.memberId, t.year),
])

// ---------------------------------------------------------------------------
// AUDIT LOG  (insert-only)
// ---------------------------------------------------------------------------

export const auditLog = pgTable('audit_log', {
  logId:      uuid('log_id').primaryKey().defaultRandom(),
  userId:     uuid('user_id').references(() => users.userId),
  userRole:   userRoleEnum('user_role'),
  action:     varchar('action', { length: 100 }).notNull(),
  entityType: varchar('entity_type', { length: 50 }),
  entityId:   uuid('entity_id'),
  oldValue:   jsonb('old_value'),
  newValue:   jsonb('new_value'),
  ipAddress:  inet('ip_address'),
  metadata:   jsonb('metadata'),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ---------------------------------------------------------------------------
// RELATIONS
// ---------------------------------------------------------------------------

export const branchesRelations = relations(branches, ({ many }) => ({
  users:    many(users),
  members:  many(members),
  invoices: many(invoices),
}))

export const usersRelations = relations(users, ({ one }) => ({
  branch: one(branches, { fields: [users.branchId], references: [branches.branchId] }),
}))

export const membersRelations = relations(members, ({ one, many }) => ({
  branch:          one(branches, { fields: [members.branchId], references: [branches.branchId] }),
  invoices:        many(invoices),
  pointsLedger:    many(pointsLedger),
  payouts:         many(payouts),
  tierHistory:     many(tierHistory),
  yearlySnapshots: many(yearlySnapshots),
}))

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  member:          one(members,          { fields: [invoices.memberId],          references: [members.memberId] }),
  branch:          one(branches,         { fields: [invoices.branchId],          references: [branches.branchId] }),
  settingsVersion: one(settingsVersions, { fields: [invoices.settingsVersionId], references: [settingsVersions.versionId] }),
  pointsLedger:    many(pointsLedger),
}))

export const pointsLedgerRelations = relations(pointsLedger, ({ one }) => ({
  member:          one(members,          { fields: [pointsLedger.memberId],          references: [members.memberId] }),
  invoice:         one(invoices,         { fields: [pointsLedger.invoiceId],         references: [invoices.invoiceId] }),
  settingsVersion: one(settingsVersions, { fields: [pointsLedger.settingsVersionId], references: [settingsVersions.versionId] }),
}))

export const payoutsRelations = relations(payouts, ({ one }) => ({
  member:          one(members,          { fields: [payouts.memberId],          references: [members.memberId] }),
  settingsVersion: one(settingsVersions, { fields: [payouts.settingsVersionId], references: [settingsVersions.versionId] }),
}))

export const tierHistoryRelations = relations(tierHistory, ({ one }) => ({
  member: one(members, { fields: [tierHistory.memberId], references: [members.memberId] }),
}))

export const yearlySnapshotsRelations = relations(yearlySnapshots, ({ one }) => ({
  member: one(members, { fields: [yearlySnapshots.memberId], references: [members.memberId] }),
}))
