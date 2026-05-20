-- =============================================================================
-- LOYALTY PROGRAMME — DATABASE SCHEMA
-- Engine: PostgreSQL (AWS RDS)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- EXTENSIONS
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- ENUMS
-- ---------------------------------------------------------------------------

CREATE TYPE member_type     AS ENUM ('engineer', 'contractor', 'tile_layer', 'architect');
CREATE TYPE tier_level      AS ENUM ('gold', 'platinum', 'diamond');
CREATE TYPE tier_type       AS ENUM ('discount', 'points');
CREATE TYPE rate_source     AS ENUM ('tier', 'custom_member', 'invoice_override');
CREATE TYPE invoice_status  AS ENUM ('confirmed', 'voided');
CREATE TYPE ledger_entry    AS ENUM ('base_earn', 'lump_sum_bonus', 'band_boost', 'redemption', 'reversal');
CREATE TYPE payout_status   AS ENUM ('pending', 'confirmed', 'paid');
CREATE TYPE user_role       AS ENUM ('super_admin', 'branch_admin', 'user');
CREATE TYPE tier_change     AS ENUM ('initial', 'annual_review');

-- ---------------------------------------------------------------------------
-- BRANCHES
-- ---------------------------------------------------------------------------

CREATE TABLE branches (
    branch_id   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(100) NOT NULL,
    location    VARCHAR(200),
    active      BOOLEAN     NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- SETTINGS VERSIONS  (INSERT-only — UPDATE + DELETE revoked on app_user)
-- Every save of the settings panel creates one immutable row.
-- Every business record pins to the version active at creation time.
-- ---------------------------------------------------------------------------

CREATE TABLE settings_versions (
    version_id  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    valid_from  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by  UUID        NOT NULL,   -- references users.user_id (FK added later)
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Full settings snapshot stored as JSON.
    -- Structure:
    -- {
    --   "discount_tiers": {
    --     "gold":     { "threshold": 1000000, "discount_rate": 0.08 },
    --     "platinum": { "threshold": 3000000, "discount_rate": 0.10 },
    --     "diamond":  { "threshold": 5000000, "discount_rate": 0.12 }
    --   },
    --   "points_tiers": {
    --     "gold":     { "threshold": 3000000, "multiplier": 1.0, "redemption_rate": 1.00 },
    --     "platinum": { "threshold": 7000000, "multiplier": 1.5, "redemption_rate": 1.25 },
    --     "diamond":  { "threshold": 7100000, "multiplier": 2.0, "redemption_rate": 1.70 }
    --   },
    --   "base_earn_rate": 1,
    --   "milestones": [
    --     { "number": 1, "threshold": 2000,  "lump_sum": 100, "boost_rate": 0.05 },
    --     { "number": 2, "threshold": 5000,  "lump_sum": 200, "boost_rate": 0.10 },
    --     { "number": 3, "threshold": 10000, "lump_sum": 300, "boost_rate": 0.15 }
    --   ]
    -- }
    payload     JSONB       NOT NULL
);

-- ---------------------------------------------------------------------------
-- USERS  (system users — super admin, branch admins, branch staff)
-- ---------------------------------------------------------------------------

CREATE TABLE users (
    user_id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    username                VARCHAR(50) NOT NULL UNIQUE,
    password_hash           VARCHAR(255) NOT NULL,       -- bcrypt, cost 12
    role                    user_role   NOT NULL,
    branch_id               UUID        REFERENCES branches(branch_id),  -- NULL for super_admin
    totp_secret             VARCHAR(255),                -- NULL for role=user (no 2FA)
    totp_verified           BOOLEAN     NOT NULL DEFAULT false,
    active                  BOOLEAN     NOT NULL DEFAULT true,
    failed_login_attempts   INT         NOT NULL DEFAULT 0,
    locked_at               TIMESTAMPTZ,                 -- set when attempts reach 5
    last_login_at           TIMESTAMPTZ,
    created_by              UUID        REFERENCES users(user_id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT branch_required_for_non_superadmin
        CHECK (role = 'super_admin' OR branch_id IS NOT NULL),

    CONSTRAINT totp_required_for_admins
        CHECK (role = 'user' OR totp_secret IS NOT NULL)
);

-- FK from settings_versions back to users (added after users table exists)
ALTER TABLE settings_versions
    ADD CONSTRAINT fk_settings_versions_created_by
    FOREIGN KEY (created_by) REFERENCES users(user_id);

-- ---------------------------------------------------------------------------
-- MEMBERS  (engineers, contractors, tile layers, architects)
-- ---------------------------------------------------------------------------

CREATE TABLE members (
    member_id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name                    VARCHAR(200) NOT NULL,
    phone                   VARCHAR(20)  NOT NULL,
    type                    member_type  NOT NULL,
    branch_id               UUID         NOT NULL REFERENCES branches(branch_id),

    -- Two independent tiers, both start at gold, both locked for the year
    discount_tier           tier_level   NOT NULL DEFAULT 'gold',
    points_tier             tier_level   NOT NULL DEFAULT 'gold',

    -- Custom discount rate (super admin only). NULL = use tier rate.
    custom_discount_rate    DECIMAL(5,4),
    custom_rate_set_by      UUID         REFERENCES users(user_id),
    custom_rate_set_at      TIMESTAMPTZ,

    -- Running YTD totals — reset to 0 on Jan 1 after annual review
    ytd_sale_value          DECIMAL(15,2) NOT NULL DEFAULT 0,
    ytd_points              INT           NOT NULL DEFAULT 0,

    active                  BOOLEAN      NOT NULL DEFAULT true,
    joined_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    created_by              UUID         REFERENCES users(user_id),
    created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- INVOICES
-- ---------------------------------------------------------------------------

CREATE TABLE invoices (
    invoice_id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number          VARCHAR(50)  NOT NULL UNIQUE,
    member_id               UUID         NOT NULL REFERENCES members(member_id),
    branch_id               UUID         NOT NULL REFERENCES branches(branch_id),

    invoice_value           DECIMAL(15,2) NOT NULL,
    discount_rate_applied   DECIMAL(5,4)  NOT NULL,  -- the rate actually used
    discount_amount         DECIMAL(15,2) NOT NULL,
    net_invoice_value       DECIMAL(15,2) NOT NULL,  -- invoice_value - discount_amount

    -- Which rule provided the discount rate (priority: override > custom > tier)
    rate_source             rate_source   NOT NULL,

    -- Populated only when rate_source = 'invoice_override'
    override_discount_rate  DECIMAL(5,4),
    override_reason         TEXT,
    override_by             UUID          REFERENCES users(user_id),

    -- Snapshot of settings active at confirmation — never changes after this
    settings_version_id     UUID          NOT NULL REFERENCES settings_versions(version_id),

    status                  invoice_status NOT NULL DEFAULT 'confirmed',
    voided_by               UUID          REFERENCES users(user_id),
    voided_at               TIMESTAMPTZ,
    void_reason             TEXT,

    confirmed_by            UUID          NOT NULL REFERENCES users(user_id),
    confirmed_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT override_fields_required
        CHECK (
            rate_source != 'invoice_override'
            OR (override_discount_rate IS NOT NULL AND override_reason IS NOT NULL)
        )
);

-- ---------------------------------------------------------------------------
-- POINTS LEDGER
-- Every points movement is a row — never updated, only appended.
--
-- entry_type rules:
--   base_earn       — fires on every confirmed invoice
--   lump_sum_bonus  — fires once when cumulative points first cross a milestone
--   band_boost      — fires on invoices AFTER a milestone is crossed (not the crossing invoice)
--   redemption      — member redeems points for cash (negative points value)
--   reversal        — invoice voided; negates original entries for that invoice
-- ---------------------------------------------------------------------------

CREATE TABLE points_ledger (
    ledger_id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id           UUID        NOT NULL REFERENCES members(member_id),
    invoice_id          UUID        REFERENCES invoices(invoice_id),  -- NULL for manual/system entries
    entry_type          ledger_entry NOT NULL,
    points              INT         NOT NULL,   -- positive = earn, negative = redemption/reversal
    milestone_number    INT         CHECK (milestone_number IN (1, 2, 3)),  -- for lump_sum_bonus and band_boost
    settings_version_id UUID        NOT NULL REFERENCES settings_versions(version_id),
    note                TEXT,
    created_by          UUID        REFERENCES users(user_id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT milestone_required_for_bonus
        CHECK (
            entry_type NOT IN ('lump_sum_bonus', 'band_boost')
            OR milestone_number IS NOT NULL
        )
);

-- ---------------------------------------------------------------------------
-- PAYOUTS  (cash redemption of points)
-- ---------------------------------------------------------------------------

CREATE TABLE payouts (
    payout_id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id               UUID         NOT NULL REFERENCES members(member_id),
    points_redeemed         INT          NOT NULL CHECK (points_redeemed > 0),
    cash_value              DECIMAL(15,2) NOT NULL,
    redemption_rate_applied DECIMAL(8,4)  NOT NULL,  -- rate at time of redemption
    settings_version_id     UUID          NOT NULL REFERENCES settings_versions(version_id),

    status                  payout_status NOT NULL DEFAULT 'pending',
    confirmed_by            UUID          REFERENCES users(user_id),
    confirmed_at            TIMESTAMPTZ,
    paid_by                 UUID          REFERENCES users(user_id),
    paid_at                 TIMESTAMPTZ,

    created_by              UUID          NOT NULL REFERENCES users(user_id),
    created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- TIER HISTORY  (append-only — one row per tier change per member)
-- ---------------------------------------------------------------------------

CREATE TABLE tier_history (
    history_id      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id       UUID        NOT NULL REFERENCES members(member_id),
    tier_type       tier_type   NOT NULL,   -- 'discount' or 'points'
    old_tier        tier_level  NOT NULL,
    new_tier        tier_level  NOT NULL,
    effective_date  DATE        NOT NULL,
    reason          tier_change NOT NULL,
    review_year     INT         NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- YEARLY SNAPSHOTS
-- Archived before annual reset. Idempotent — UNIQUE(member_id, year).
-- ---------------------------------------------------------------------------

CREATE TABLE yearly_snapshots (
    snapshot_id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id           UUID         NOT NULL REFERENCES members(member_id),
    year                INT          NOT NULL,
    ytd_sale_value      DECIMAL(15,2) NOT NULL,
    discount_tier       tier_level   NOT NULL,
    points_tier         tier_level   NOT NULL,
    ytd_points_earned   INT          NOT NULL,
    ytd_redemptions     DECIMAL(15,2) NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    UNIQUE (member_id, year)
);

-- ---------------------------------------------------------------------------
-- AUDIT LOG  (INSERT-only — UPDATE + DELETE revoked on app_user)
-- ---------------------------------------------------------------------------

CREATE TABLE audit_log (
    log_id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        REFERENCES users(user_id),   -- NULL for system-triggered actions
    user_role       user_role,
    action          VARCHAR(100) NOT NULL,
    entity_type     VARCHAR(50),
    entity_id       UUID,
    old_value       JSONB,
    new_value       JSONB,
    ip_address      INET,
    metadata        JSONB,       -- any extra context (e.g. branch_id, review_year)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- INDEXES
-- =============================================================================

-- Members
CREATE INDEX idx_members_branch_id   ON members(branch_id);
CREATE INDEX idx_members_active      ON members(active) WHERE active = true;
CREATE INDEX idx_members_phone       ON members(phone);

-- Invoices
CREATE INDEX idx_invoices_member_id      ON invoices(member_id);
CREATE INDEX idx_invoices_branch_id      ON invoices(branch_id);
CREATE INDEX idx_invoices_confirmed_at   ON invoices(confirmed_at);
CREATE INDEX idx_invoices_status         ON invoices(status);

-- Points ledger
CREATE INDEX idx_ledger_member_id    ON points_ledger(member_id);
CREATE INDEX idx_ledger_invoice_id   ON points_ledger(invoice_id);
CREATE INDEX idx_ledger_created_at   ON points_ledger(created_at);
CREATE INDEX idx_ledger_entry_type   ON points_ledger(entry_type);

-- Payouts
CREATE INDEX idx_payouts_member_id   ON payouts(member_id);
CREATE INDEX idx_payouts_status      ON payouts(status);

-- Tier history
CREATE INDEX idx_tier_history_member_id  ON tier_history(member_id);
CREATE INDEX idx_tier_history_year       ON tier_history(review_year);

-- Yearly snapshots
CREATE INDEX idx_snapshots_year      ON yearly_snapshots(year);

-- Audit log
CREATE INDEX idx_audit_user_id       ON audit_log(user_id);
CREATE INDEX idx_audit_created_at    ON audit_log(created_at);
CREATE INDEX idx_audit_entity        ON audit_log(entity_type, entity_id);

-- =============================================================================
-- ROW LEVEL SECURITY (RLS)
-- Enforces branch isolation at the DB level.
-- The app connects as one of two roles:
--   app_user        — branch-scoped (branch admins + regular users)
--   app_super_admin — unrestricted (super admin)
-- =============================================================================

ALTER TABLE members         ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices        ENABLE ROW LEVEL SECURITY;
ALTER TABLE points_ledger   ENABLE ROW LEVEL SECURITY;
ALTER TABLE payouts         ENABLE ROW LEVEL SECURITY;

-- app_super_admin sees everything
CREATE POLICY super_admin_all_members       ON members       TO app_super_admin USING (true);
CREATE POLICY super_admin_all_invoices      ON invoices      TO app_super_admin USING (true);
CREATE POLICY super_admin_all_ledger        ON points_ledger TO app_super_admin USING (true);
CREATE POLICY super_admin_all_payouts       ON payouts       TO app_super_admin USING (true);

-- app_user only sees their own branch
-- current_setting('app.current_branch_id') is set per-session by the API on login
CREATE POLICY branch_scoped_members
    ON members FOR ALL TO app_user
    USING (branch_id = current_setting('app.current_branch_id')::UUID);

CREATE POLICY branch_scoped_invoices
    ON invoices FOR ALL TO app_user
    USING (branch_id = current_setting('app.current_branch_id')::UUID);

CREATE POLICY branch_scoped_ledger
    ON points_ledger FOR ALL TO app_user
    USING (
        member_id IN (
            SELECT member_id FROM members
            WHERE branch_id = current_setting('app.current_branch_id')::UUID
        )
    );

CREATE POLICY branch_scoped_payouts
    ON payouts FOR ALL TO app_user
    USING (
        member_id IN (
            SELECT member_id FROM members
            WHERE branch_id = current_setting('app.current_branch_id')::UUID
        )
    );

-- =============================================================================
-- INSERT-ONLY ENFORCEMENT
-- Revoke UPDATE and DELETE on tamper-proof tables for the app DB user.
-- Even a bug in application code cannot modify these rows.
-- =============================================================================

REVOKE UPDATE, DELETE ON audit_log          FROM app_user;
REVOKE UPDATE, DELETE ON settings_versions  FROM app_user;
REVOKE UPDATE, DELETE ON audit_log          FROM app_super_admin;
REVOKE UPDATE, DELETE ON settings_versions  FROM app_super_admin;
