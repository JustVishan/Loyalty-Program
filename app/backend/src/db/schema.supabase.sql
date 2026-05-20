-- =============================================================================
-- LOYALTY PROGRAMME — SUPABASE SCHEMA (POC)
-- =============================================================================
-- This is the POC version for Supabase.
-- Differences from production (schema.sql):
--   - No custom DB roles (app_user / app_super_admin)
--   - RLS disabled — add back on migration to AWS RDS
--   - No REVOKE statements — enforced on AWS RDS
--   - Connect via Drizzle using Supabase direct connection string
--   - Do NOT use Supabase Auth — we use our own JWT + bcrypt + TOTP
-- =============================================================================

-- ---------------------------------------------------------------------------
-- EXTENSIONS
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

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
    branch_id   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(100) NOT NULL,
    location    VARCHAR(200),
    active      BOOLEAN      NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- SETTINGS VERSIONS
-- INSERT-only in production. Every settings save creates one immutable row.
-- Every business record pins to the version active at creation time.
-- ---------------------------------------------------------------------------

CREATE TABLE settings_versions (
    version_id  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    valid_from  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by  UUID        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Full settings snapshot. Structure:
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
-- USERS
-- ---------------------------------------------------------------------------

CREATE TABLE users (
    user_id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    username                VARCHAR(50)  NOT NULL UNIQUE,
    password_hash           VARCHAR(255) NOT NULL,
    role                    user_role    NOT NULL,
    branch_id               UUID         REFERENCES branches(branch_id),
    totp_secret             VARCHAR(255),
    totp_verified           BOOLEAN      NOT NULL DEFAULT false,
    active                  BOOLEAN      NOT NULL DEFAULT true,
    failed_login_attempts   INT          NOT NULL DEFAULT 0,
    locked_at               TIMESTAMPTZ,
    last_login_at           TIMESTAMPTZ,
    created_by              UUID         REFERENCES users(user_id),
    created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT branch_required_for_non_superadmin
        CHECK (role = 'super_admin' OR branch_id IS NOT NULL),

    CONSTRAINT totp_required_for_admins
        CHECK (role = 'user' OR totp_secret IS NOT NULL)
);

ALTER TABLE settings_versions
    ADD CONSTRAINT fk_settings_versions_created_by
    FOREIGN KEY (created_by) REFERENCES users(user_id);

-- ---------------------------------------------------------------------------
-- MEMBERS
-- ---------------------------------------------------------------------------

CREATE TABLE members (
    member_id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    name                    VARCHAR(200)  NOT NULL,
    phone                   VARCHAR(20)   NOT NULL,
    type                    member_type   NOT NULL,
    branch_id               UUID          NOT NULL REFERENCES branches(branch_id),
    discount_tier           tier_level    NOT NULL DEFAULT 'gold',
    points_tier             tier_level    NOT NULL DEFAULT 'gold',
    custom_discount_rate    DECIMAL(5,4),
    custom_rate_set_by      UUID          REFERENCES users(user_id),
    custom_rate_set_at      TIMESTAMPTZ,
    ytd_sale_value          DECIMAL(15,2) NOT NULL DEFAULT 0,
    ytd_points              INT           NOT NULL DEFAULT 0,
    active                  BOOLEAN       NOT NULL DEFAULT true,
    joined_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    created_by              UUID          REFERENCES users(user_id),
    created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- INVOICES
-- ---------------------------------------------------------------------------

CREATE TABLE invoices (
    invoice_id              UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number          VARCHAR(50)    NOT NULL UNIQUE,
    member_id               UUID           NOT NULL REFERENCES members(member_id),
    branch_id               UUID           NOT NULL REFERENCES branches(branch_id),
    invoice_value           DECIMAL(15,2)  NOT NULL,
    discount_rate_applied   DECIMAL(5,4)   NOT NULL,
    discount_amount         DECIMAL(15,2)  NOT NULL,
    net_invoice_value       DECIMAL(15,2)  NOT NULL,
    rate_source             rate_source    NOT NULL,
    override_discount_rate  DECIMAL(5,4),
    override_reason         TEXT,
    override_by             UUID           REFERENCES users(user_id),
    settings_version_id     UUID           NOT NULL REFERENCES settings_versions(version_id),
    status                  invoice_status NOT NULL DEFAULT 'confirmed',
    voided_by               UUID           REFERENCES users(user_id),
    voided_at               TIMESTAMPTZ,
    void_reason             TEXT,
    confirmed_by            UUID           NOT NULL REFERENCES users(user_id),
    confirmed_at            TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    created_at              TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

    CONSTRAINT override_fields_required
        CHECK (
            rate_source != 'invoice_override'
            OR (override_discount_rate IS NOT NULL AND override_reason IS NOT NULL)
        )
);

-- ---------------------------------------------------------------------------
-- POINTS LEDGER
-- entry_type rules:
--   base_earn      — every confirmed invoice
--   lump_sum_bonus — fires once when cumulative points first cross a milestone
--   band_boost     — fires on invoices AFTER crossing a milestone (not the crossing one)
--   redemption     — member redeems points for cash (negative value)
--   reversal       — invoice voided, negates original entries (negative value)
-- ---------------------------------------------------------------------------

CREATE TABLE points_ledger (
    ledger_id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id           UUID         NOT NULL REFERENCES members(member_id),
    invoice_id          UUID         REFERENCES invoices(invoice_id),
    entry_type          ledger_entry NOT NULL,
    points              INT          NOT NULL,
    milestone_number    INT          CHECK (milestone_number IN (1, 2, 3)),
    settings_version_id UUID         NOT NULL REFERENCES settings_versions(version_id),
    note                TEXT,
    created_by          UUID         REFERENCES users(user_id),
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT milestone_required_for_bonus
        CHECK (
            entry_type NOT IN ('lump_sum_bonus', 'band_boost')
            OR milestone_number IS NOT NULL
        )
);

-- ---------------------------------------------------------------------------
-- PAYOUTS
-- ---------------------------------------------------------------------------

CREATE TABLE payouts (
    payout_id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id               UUID          NOT NULL REFERENCES members(member_id),
    points_redeemed         INT           NOT NULL CHECK (points_redeemed > 0),
    cash_value              DECIMAL(15,2) NOT NULL,
    redemption_rate_applied DECIMAL(8,4)  NOT NULL,
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
-- TIER HISTORY
-- ---------------------------------------------------------------------------

CREATE TABLE tier_history (
    history_id      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id       UUID        NOT NULL REFERENCES members(member_id),
    tier_type       tier_type   NOT NULL,
    old_tier        tier_level  NOT NULL,
    new_tier        tier_level  NOT NULL,
    effective_date  DATE        NOT NULL,
    reason          tier_change NOT NULL,
    review_year     INT         NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- YEARLY SNAPSHOTS
-- ---------------------------------------------------------------------------

CREATE TABLE yearly_snapshots (
    snapshot_id         UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id           UUID          NOT NULL REFERENCES members(member_id),
    year                INT           NOT NULL,
    ytd_sale_value      DECIMAL(15,2) NOT NULL,
    discount_tier       tier_level    NOT NULL,
    points_tier         tier_level    NOT NULL,
    ytd_points_earned   INT           NOT NULL,
    ytd_redemptions     DECIMAL(15,2) NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    UNIQUE (member_id, year)
);

-- ---------------------------------------------------------------------------
-- AUDIT LOG
-- INSERT-only enforced in production via REVOKE on AWS RDS.
-- For POC, manually avoid any UPDATE/DELETE on this table.
-- ---------------------------------------------------------------------------

CREATE TABLE audit_log (
    log_id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID         REFERENCES users(user_id),
    user_role       user_role,
    action          VARCHAR(100) NOT NULL,
    entity_type     VARCHAR(50),
    entity_id       UUID,
    old_value       JSONB,
    new_value       JSONB,
    ip_address      INET,
    metadata        JSONB,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- INDEXES
-- =============================================================================

CREATE INDEX idx_members_branch_id       ON members(branch_id);
CREATE INDEX idx_members_active          ON members(active) WHERE active = true;
CREATE INDEX idx_members_phone           ON members(phone);

CREATE INDEX idx_invoices_member_id      ON invoices(member_id);
CREATE INDEX idx_invoices_branch_id      ON invoices(branch_id);
CREATE INDEX idx_invoices_confirmed_at   ON invoices(confirmed_at);
CREATE INDEX idx_invoices_status         ON invoices(status);

CREATE INDEX idx_ledger_member_id        ON points_ledger(member_id);
CREATE INDEX idx_ledger_invoice_id       ON points_ledger(invoice_id);
CREATE INDEX idx_ledger_created_at       ON points_ledger(created_at);
CREATE INDEX idx_ledger_entry_type       ON points_ledger(entry_type);

CREATE INDEX idx_payouts_member_id       ON payouts(member_id);
CREATE INDEX idx_payouts_status          ON payouts(status);

CREATE INDEX idx_tier_history_member_id  ON tier_history(member_id);
CREATE INDEX idx_tier_history_year       ON tier_history(review_year);

CREATE INDEX idx_snapshots_year          ON yearly_snapshots(year);

CREATE INDEX idx_audit_user_id           ON audit_log(user_id);
CREATE INDEX idx_audit_created_at        ON audit_log(created_at);
CREATE INDEX idx_audit_entity            ON audit_log(entity_type, entity_id);

-- =============================================================================
-- PRODUCTION MIGRATION CHECKLIST (Supabase → AWS RDS)
-- =============================================================================
-- 1. pg_dump from Supabase
-- 2. pg_restore into RDS
-- 3. CREATE ROLE app_user LOGIN PASSWORD '...';
-- 4. CREATE ROLE app_super_admin LOGIN PASSWORD '...';
-- 5. GRANT SELECT, INSERT, UPDATE, DELETE ON all tables TO app_user (except below)
-- 6. REVOKE UPDATE, DELETE ON audit_log FROM app_user, app_super_admin
-- 7. REVOKE UPDATE, DELETE ON settings_versions FROM app_user, app_super_admin
-- 8. Enable RLS on members, invoices, points_ledger, payouts
-- 9. Apply RLS policies from schema.sql
-- 10. Move connection string to AWS Secrets Manager
-- 11. Run restore drill — verify all data intact
-- =============================================================================
