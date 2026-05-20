# Engineer & Contractor Loyalty Programme — Tech Stack & Security

**Version**: 1.0  
**Project**: LPS v4.0  
**Client**: Tile company — 5 branches (Madurai, Ramnad, Rajapalayam, Thoppur, Tenkasi)

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Frontend](#frontend)
3. [Backend](#backend)
4. [Database](#database)
5. [Backup Strategy](#backup-strategy)
6. [Queue & Workers](#queue--workers)
7. [Session Management](#session-management)
8. [File Storage](#file-storage)
9. [Secrets Management](#secrets-management)
10. [Monitoring & Logging](#monitoring--logging)
11. [Security](#security)
12. [Confirmed Business Rules](#confirmed-business-rules)
13. [Deployment](#deployment)

---

## Architecture Overview

```
Browser (React SPA)
       │
  CloudFront + S3
  (static hosting)
       │
       ▼
  ECS Fargate (API)
  Node.js + Fastify
       │
  ┌────┴────────────────────────┐
  ▼                             ▼
RDS PostgreSQL            ElastiCache Redis
(primary data store)      (sessions, token store)
       │
       ▼
    SQS Queue
       │
  ECS Workers
  (heavy jobs)
       │
       ▼
    S3 Bucket
  (report files)
```

**Cloud Provider**: AWS  
**Deployment style**: Containerized (Docker), managed via ECS Fargate — no server management

---

## Frontend

| Item | Choice | Reason |
|---|---|---|
| Framework | React + TypeScript | Component model fits the data-heavy dashboard; TypeScript catches type mismatches at compile time |
| Build tool | Vite | Fast local dev, optimized production bundles |
| UI components | Shadcn/UI | Pre-built data tables, forms, modals suited for admin tools |
| Data fetching | React Query (TanStack Query) | Caching, background refetch, mutation state handling |
| Hosting | AWS S3 + CloudFront | Static hosting, global CDN, cost-efficient |

**Device target**: Desktop browser first. Built with responsive layout so mobile support can be added later without redesign.

---

## Backend

| Item | Choice | Reason |
|---|---|---|
| Runtime | Node.js (LTS) | Consistent language (TypeScript) across frontend and backend |
| Language | TypeScript | Enforces no magic numbers; tier/rate type safety at compile time |
| Framework | Fastify | Schema-validated request/response, high performance, plugin ecosystem |
| ORM | Drizzle ORM | SQL-first, TypeScript-native — explicit queries, no hidden behaviour; easy raw SQL for complex calculations |
| Hosting | AWS ECS Fargate | Containerized, no server management, scales horizontally |
| Logging | Structured JSON → CloudWatch | Machine-parseable logs, searchable in AWS |

### Calculation Engine

All business logic (points, band boost, discount priority) lives as **pure, stateless TypeScript functions** — no side effects, no DB calls inside the core math. This makes them:

- Fully unit-testable in isolation
- Deterministic and reproducible
- Independent of framework changes

---

## Database

**Engine**: AWS RDS PostgreSQL (Multi-AZ for production)

| Feature | Usage |
|---|---|
| ACID transactions | Invoice confirmation + points ledger write are a single atomic transaction |
| Row-Level Security (RLS) | Branch data isolation enforced at DB level — app users physically cannot query other branches |
| Point-in-Time Recovery (PITR) | Built-in with RDS — financial data recovery |
| INSERT-only enforcement | `audit_log` and `settings_versions` tables: UPDATE and DELETE revoked at the DB role level |

### Key Tables

| Table | Notes |
|---|---|
| `members` | type ∈ {engineer, contractor, tile_layer, architect}; has **two separate tier fields**: `discount_tier` and `points_tier` |
| `invoices` | Uses `discount_tier` for discount calc; stores `settings_version_id` pinned at confirmation; `rate_source` ∈ {tier, custom_member, invoice_override} |
| `points_ledger` | Uses `points_tier` for multiplier; `entry_type` ∈ {base_earn, lump_sum_bonus, band_boost, redemption, reversal} |
| `payouts` | status ∈ {pending, confirmed, paid} |
| `tier_history` | Append-only; one row per tier per member — records both `discount_tier` and `points_tier` changes separately |
| `settings_versions` | INSERT-only at DB level; every save creates an immutable snapshot (JSON payload) |
| `yearly_snapshots` | UNIQUE(member_id, year); stores both `ytd_discount_tier` and `ytd_points_tier` before reset |
| `audit_log` | INSERT-only at DB level; 7-year retention |

### Parameter Versioning

Every time settings are saved, a new immutable `settings_version` row is created. Every invoice, ledger entry, and payout stores the `settings_version_id` active at the time of creation. **Changing rates today never alters historical records** — each record always reads its own pinned version.

---

## Backup Strategy

### What Gets Backed Up

| Data | Criticality | Approach |
|---|---|---|
| RDS PostgreSQL | 🔴 Critical | Full backup strategy below |
| Redis (ElastiCache) | 🟢 Not critical | Sessions only — users log back in |
| S3 reports | 🟡 Low | Regeneratable from DB data |
| Application code | 🟢 Not critical | Lives in git |

### Backup Schedule

| Type | Frequency | Retention | Managed By |
|---|---|---|---|
| Automated daily snapshot | Every day at 2 AM | 35 days then auto-deleted | RDS built-in |
| Transaction logs (PITR) | Continuous | 35 days | RDS built-in |
| Monthly snapshot | 1st of every month at 3 AM | Never expires | AWS Backup |
| Pre-annual-review snapshot | Manual — Dec 31 before review runs | Never expires | Manual trigger |
| Cross-region copy | Daily | 30 days | AWS Backup → Singapore |

### How Each Type Works

**Daily snapshots + PITR** — RDS takes a full snapshot every night and logs every write continuously throughout the day. Combined, this gives Point-in-Time Recovery — the database can be restored to any exact second within the last 35 days.

**Monthly snapshots** — managed by AWS Backup on a schedule. Runs on the 1st of every month at 3 AM. Never auto-deleted. After one year you have 12 permanent snapshots — one for each month-start. After five years, 60 snapshots covering the full history of the programme.

**Pre-annual-review snapshot** — taken manually on Dec 31 before the annual review runs. The monthly snapshot for January also runs on Jan 1 but may run after the review resets data. The manual Dec 31 snapshot guarantees a clean pre-reset copy exists regardless of timing.

```
Dec 31, 11:00 PM  →  Manual snapshot (pre-review)   ✅ kept forever
Jan  1,  2:00 AM  →  Daily snapshot  (auto)
Jan  1,  3:00 AM  →  Monthly snapshot (auto)         ✅ kept forever
Jan  1,  morning  →  Annual review runs
```

**Cross-region copy** — daily snapshots are copied to Singapore (`ap-southeast-1`) automatically via AWS Backup. If the Mumbai region goes down entirely, the database can be restored from Singapore. Maximum data loss in that scenario: 24 hours (since last snapshot copy).

### Storage Cost

Snapshot storage within the provisioned DB size is **free**. Snapshots are incremental — after the first full snapshot, only changed blocks are stored each day. For a loyalty programme DB (estimated 5-15GB), total backup storage stays well within the free tier for daily snapshots. Monthly snapshots cost minimal extra (~₹200-400/month).

### Restore Drill

Before going live, a restore drill must be completed:
1. Restore a backup to a temporary RDS instance
2. Verify data integrity — member records, invoices, points ledger
3. Delete the temporary instance

This confirms backups actually work before we depend on them in production.

---

## Confirmed Business Rules

These override anything ambiguous in the spec document. Source: Settings sheet of the Excel calculator + client confirmation.

### Two Independent Tiers Per Member

Each member has a **Discount tier** and a **Points tier** — evaluated and locked separately each year.

**Discount tier** thresholds (annual sale value):

| Tier | Threshold | Discount Rate |
|---|---|---|
| Gold | ≥ ₹10,00,000 | 8% |
| Platinum | ≥ ₹30,00,000 | 10% |
| Diamond | ≥ ₹50,00,000 | 12% |

**Points tier** thresholds (annual sale value):

| Tier | Threshold | Multiplier | Redemption Rate |
|---|---|---|---|
| Gold | ≥ ₹30,00,000 | 1× | ₹1.00/pt |
| Platinum | ≥ ₹70,00,000 | 1.5× | ₹1.25/pt |
| Diamond | ≥ ₹71,00,000 | 2× | ₹1.70/pt |

> ⚠️ **Needs client confirmation**: The Points tier Diamond threshold (₹71,00,000) is only ₹1L above Platinum (₹70,00,000) in the Excel — this looks like a placeholder. Confirm the intended Diamond threshold before going live.

A member can be in different tiers for each — e.g. Discount-Gold and Points-Platinum simultaneously. Both are reviewed independently at year-end.

### Annual Review — Upgrade/Downgrade Rules

Applies to **each tier independently**.

- **Upgrade**: One step only — Gold → Platinum, or Platinum → Diamond. Never skips a tier, even if the member's YTD sale value exceeds the next-next tier threshold.
- **Hold**: YTD sale value ≥ current tier threshold but below next tier → keep same tier.
- **Downgrade**: One step only — Diamond → Platinum, Platinum → Gold. Gold is the floor.
- **New member default**: All new members start at **Gold** on both tiers regardless of sale value. First upgrade can happen at Year 2 earliest.

### Band Boost Timing

The milestone band boost fires **only on invoices after** the threshold has been crossed — not on the invoice that crosses it.

On the **crossing invoice**: lump-sum bonus fires immediately, but **no band boost**.  
On **all subsequent invoices** that year: band boost % is applied to the portion of base points earned above each already-crossed milestone threshold.

```
entry_type on crossing invoice:   base_earn  +  lump_sum_bonus
entry_type on future invoices:    base_earn  +  band_boost  (if cum_before >= any milestone)
```

---

## Queue & Workers

**Queue**: AWS SQS  
**Workers**: ECS tasks running the same TypeScript codebase — no Lambda cold starts on financial logic

| Job | Trigger | Description |
|---|---|---|
| Pre-reset unredeemed points report | Before annual review | Generates a list of all members with unredeemed points balances so staff can call them and process cash payouts before reset |
| Annual review — dry-run | Super admin button | Previews per-member outcome (current tier / projected tier / YTD sale value) without writing anything |
| Annual review — live | Super admin sign-off after dry-run | Atomic sequence: Archive snapshots → Review tiers → Reset YTD + points → Dispatch notifications |
| Notification dispatch | Post annual review | Tier change notifications per member |
| Report generation | On-demand | PDF export of revenue impact, portfolio tracker, annual review summary |

### Annual Review — Step Order

```
Step 0  Pre-reset report     Generate unredeemed points list
                             Staff calls members, processes payouts in the app
                             Super admin confirms payouts reviewed

Step 1  Dry-run preview      Per-member: current tier / projected tier / YTD value
                             No data is written

Step 2  Super admin sign-off Explicit approval required before live run

Step 3  Live execution       Archive → Tier review → Reset → Notify
```

The live execution is **gated** — it cannot run until the super admin has signed off on both the pre-reset report review and the dry-run preview.

---

## Session Management

**Store**: AWS ElastiCache (Redis)

| Rule | Implementation |
|---|---|
| Single active session | New login invalidates the previous session token in Redis |
| 30-minute idle timeout | TTL updated on each request; session destroyed on expiry |
| JWT logout/lockout | Token blocklisted in Redis on logout or account lock |
| Refresh token | Stored in httpOnly cookie; 7-day expiry |
| Access token | Short-lived (15 minutes); sent in Authorization header |

---

## File Storage

**Service**: AWS S3

- Generated PDF reports (portfolio tracker, annual review summary, unredeemed points list)
- Files are **never served directly** through the API — access is via **presigned S3 URLs** with short expiry
- Private bucket — no public access

---

## Secrets Management

**Service**: AWS Secrets Manager

Secrets stored (never in code or `.env` files committed to the repo):

- Database credentials
- JWT signing secret
- Redis connection string
- 2FA issuer key
- Any third-party API keys (SMS/email provider for OTP)

Secrets are rotated on a schedule via Secrets Manager's automatic rotation.

---

## Monitoring & Logging

| Concern | Tool |
|---|---|
| Application logs | Structured JSON → AWS CloudWatch Logs |
| Metrics & alerts | AWS CloudWatch Metrics + Alarms |
| Error tracking | CloudWatch or integrate Sentry |
| DB performance | RDS Performance Insights |
| Uptime | CloudWatch Synthetics or AWS Health |

Every request logs: timestamp, user ID, role, branch ID, action, HTTP status, duration.

---

## Security

### 1. Authentication

| Rule | Detail |
|---|---|
| Password hashing | bcrypt, cost factor ≥ 12 — never stored plain, never logged |
| 2FA | TOTP (Google Authenticator compatible) — mandatory for Super Admin and Branch Admin |
| 2FA enforcement | Server-side API middleware rejects admin-role requests without a verified 2FA session — cannot be bypassed from the frontend |
| Regular users | Username + password only — no 2FA required |

### 2. Sessions

Every login issues two tokens:

| Token | Lifetime | Transport |
|---|---|---|
| Access token | 15 minutes | Authorization header |
| Refresh token | 7 days | httpOnly cookie (JavaScript cannot read it) |

Both backed by **Redis (ElastiCache)**:

| Rule | How it works |
|---|---|
| Single active session | New login immediately kills the previous session token in Redis — cannot be logged in from two devices |
| 30-minute idle timeout | Redis TTL resets on every request; go idle for 30 min and you are logged out |
| Instant lockout | When an account is locked, the active token is blocklisted in Redis immediately — user is kicked out mid-session, not just on next login |

### 3. Account Lockout

- Account locked after **5 consecutive failed logins**
- Failed counter resets on successful login
- Only Super Admin can unlock a locked account
- Every failed login and every unlock is written to the audit log

### 4. Role-Based Access Control (RBAC)

Enforced at the API level on every endpoint — not just the frontend.

| Action | Super Admin | Branch Admin | User |
|---|---|---|---|
| View dashboard & reports | All branches | Own branch | Own branch |
| Register / edit member | ✅ | ✅ | ✅ |
| Enter invoice | ✅ | ✅ | ✅ |
| Apply invoice-level discount override | ✅ | ✅ | ❌ |
| Void invoice | ✅ | ✅ | ❌ |
| Confirm / mark payout as paid | ✅ | ✅ | ❌ |
| Set member custom discount rate | ✅ | ❌ | ❌ |
| Change programme settings | ✅ | ❌ | ❌ |
| Run annual review | ✅ | ❌ | ❌ |
| Create / deactivate user accounts | ✅ | ❌ | ❌ |
| View audit log | ✅ | ❌ | ❌ |

### 5. Branch Data Isolation

- **PostgreSQL Row-Level Security (RLS)** — Branch Admins and Users are physically unable to query data from other branches at the DB level. Not an application filter — a database wall.
- Branch assignment is set at account creation; only Super Admin can change it.
- Super Admin is the only role with cross-branch visibility.

### 6. Sensitive Action Re-authentication

Two actions require the user to **re-enter their password** before the change is committed:

- Changing any programme setting (rates, thresholds, milestones)
- Setting a custom discount rate on a member

Implemented as a **short-lived server-side confirmation token** — the API endpoint that saves the change requires this token to be present and valid. A frontend prompt alone is not sufficient.

### 7. Audit Log

**INSERT-only table** — the DB app user has UPDATE and DELETE revoked at the database role level. Even a bug in application code cannot edit an audit row.

Events logged:

| Category | Events |
|---|---|
| Settings | Every parameter change — old value, new value, version created |
| Discount overrides | Member custom rate set / changed / removed; invoice-level override applied |
| Invoices | Confirmed, voided |
| Payouts | Confirmed, marked paid |
| Annual review | Dry-run executed, live review executed |
| Sessions | Login, logout, failed login, 2FA verification |
| Admin | Account created, deactivated, role changed, password reset, account unlocked |

Every row stores: `user_id`, `user_role`, `action`, `entity_type`, `entity_id`, `old_value`, `new_value`, `ip_address`, `timestamp`.

**Retention: 7 years.** Read access: Super Admin only.

### 8. Data Integrity — Tamper-proof Records

Two tables are INSERT-only at the DB role level (UPDATE + DELETE revoked):

- `audit_log` — historical record of all actions, can never be edited
- `settings_versions` — every settings save creates a new immutable snapshot; old versions can never be changed

Every invoice, points ledger entry, and payout is **pinned** to the `settings_version_id` active at creation time. Changing a rate today never alters any historical record — each record always calculates using its own pinned version.

### 9. Network & Infrastructure

| Concern | Implementation |
|---|---|
| Database | RDS in private VPC subnet — no public internet access; only the API can reach it |
| API | ECS Fargate behind an Application Load Balancer (ALB) — HTTPS only |
| HTTPS | TLS enforced on CloudFront and ALB; HTTP redirected to HTTPS |
| CORS | API accepts requests only from the CloudFront domain |
| S3 reports | Private bucket — no public access; files served via presigned URLs with short expiry |
| Secrets | AWS Secrets Manager — DB credentials, JWT secret, 2FA key; rotated on a schedule; nothing sensitive in code or committed env files |

### 10. Calculation Integrity

- All calculation logic lives in **pure, stateless functions** — no side effects, no DB calls inside the math, fully unit-testable in isolation
- **No hardcoded thresholds, rates, or bonus values** — enforced as a lint rule; a hardcoded number in calculation code is a build failure
- Mandatory automated test coverage:
  - Standard tier invoice (all three tiers, both discount and points tier)
  - All three milestone crossings — lump sum fires, no band boost on crossing invoice
  - Band boost fires correctly on the invoice AFTER crossing (not the crossing invoice)
  - Band boost spanning two already-crossed milestones on a single future invoice
  - One-step upgrade only: Gold member hitting Diamond threshold still goes to Platinum
  - One-step downgrade: Diamond → Platinum, not Gold
  - New member always starts at Gold on both tiers
  - Discount tier and Points tier reviewed independently (different thresholds)
  - Custom member discount rate override
  - Invoice-level discount override
  - Parameter versioning: change a rate, assert all pre-change invoices still calculate at the old rate

---

## Deployment

### Environments

| Environment | Purpose |
|---|---|
| `development` | Local dev — Docker Compose (Postgres + Redis locally) |
| `staging` | AWS — mirrors production, used for QA and client review |
| `production` | AWS — live system |

### Infrastructure

- **ECS Fargate** — API and worker containers, auto-scaling
- **RDS PostgreSQL Multi-AZ** — automatic failover, PITR enabled
- **ElastiCache Redis** — session store
- **SQS** — job queue (standard queue with dead-letter queue for failed jobs)
- **S3** — report file storage
- **CloudFront** — frontend CDN
- **ALB** — HTTPS load balancer for the API
- **VPC** — RDS and Redis in private subnets; only the ALB is internet-facing
- **Secrets Manager** — all credentials

### CI/CD

- TypeScript type check + lint (no hardcoded values rule) + unit tests must all pass before any deployment
- Database migrations run via Drizzle Migrate as part of the deployment pipeline — never manual SQL on production

---

*Document maintained alongside the codebase. Update this file when architecture decisions change.*
