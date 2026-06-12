import type { FastifyInstance } from 'fastify'
import { z } from 'zod/v4'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { users } from '../db/schema.js'
import { hashPassword, verifyPassword, generateTotpSecret, verifyTotp, generateTotpQR } from '../lib/auth.js'
import { writeAudit } from '../lib/audit.js'

const MAX_FAILED_ATTEMPTS = 5
const MAX_2FA_ATTEMPTS    = 5

// Dummy hash — ensures bcrypt always runs (~100ms) even when username doesn't exist,
// preventing timing-based username enumeration.
const DUMMY_HASH = '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtGMnNIzB/2ixcFFlAuTRr.xgfJu'

// TOTP replay cache — prevents reuse of a code within the 90-second TOTP window.
const usedTotpCodes = new Map<string, number>()
function markTotpUsed(userId: string, code: string) {
  usedTotpCodes.set(`${userId}:${code}`, Date.now())
  const cutoff = Date.now() - 90_000
  for (const [k, ts] of usedTotpCodes) if (ts < cutoff) usedTotpCodes.delete(k)
}
function isTotpUsed(userId: string, code: string): boolean {
  const ts = usedTotpCodes.get(`${userId}:${code}`)
  return ts !== undefined && (Date.now() - ts) < 90_000
}

export async function authRoutes(app: FastifyInstance) {

  // POST /api/auth/login  — 10 attempts per minute per IP
  app.post('/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = z.object({
      username: z.string().min(1),
      password: z.string().min(1),
    }).parse(req.body)

    const [user] = await db.select().from(users).where(eq(users.username, body.username)).limit(1)

    const ip = req.ip

    // Always run bcrypt regardless of whether user exists — prevents timing-based username enumeration
    const valid = await verifyPassword(body.password, user?.passwordHash ?? DUMMY_HASH)

    if (!user || !user.active || !valid) {
      if (user && user.active && !valid) {
        // Valid user, wrong password — track attempt and maybe lock
        const newAttempts = user.failedLoginAttempts + 1
        const shouldLock  = newAttempts >= MAX_FAILED_ATTEMPTS
        await db.update(users)
          .set({ failedLoginAttempts: newAttempts, lockedAt: shouldLock ? new Date() : null })
          .where(eq(users.userId, user.userId))
        await writeAudit({
          userId: user.userId, userRole: user.role,
          action: 'login_failed',
          metadata: { reason: 'wrong_password', attempts: newAttempts, locked: shouldLock },
          ipAddress: ip,
        })
        if (shouldLock) return reply.status(403).send({ error: 'Account locked after too many failed attempts.' })
      } else {
        await writeAudit({ action: 'login_failed', metadata: { username: body.username, reason: 'user_not_found' }, ipAddress: ip })
      }
      return reply.status(401).send({ error: 'Invalid credentials' })
    }

    if (user.lockedAt) {
      await writeAudit({ action: 'login_failed', userId: user.userId, userRole: user.role, metadata: { reason: 'account_locked' }, ipAddress: ip })
      return reply.status(403).send({ error: 'Account locked. Contact your administrator.' })
    }

    // Password correct — check 2FA requirement
    const requires2FA = user.role === 'super_admin' || user.role === 'branch_admin'

    if (requires2FA && user.totpVerified) {
      // Issue a short-lived pre-auth token — user must complete 2FA
      const preAuthToken = await reply.jwtSign(
        { sub: user.userId, step: 'pre_auth' },
        { expiresIn: '5m' },
      )
      return reply.send({ requires2FA: true, preAuthToken })
    }

    // No 2FA needed — issue full session token
    return issueSession(app, reply, user, ip)
  })

  // POST /api/auth/verify-2fa  — 10 attempts per 5 minutes per IP
  app.post('/verify-2fa', { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } }, async (req, reply) => {
    const body = z.object({
      preAuthToken: z.string(),
      totpCode:     z.string().length(6),
    }).parse(req.body)

    let payload: any
    try {
      payload = app.jwt.verify(body.preAuthToken)
    } catch {
      return reply.status(401).send({ error: 'Invalid or expired token' })
    }

    if (payload.step !== 'pre_auth') {
      return reply.status(401).send({ error: 'Invalid token step' })
    }

    const [user] = await db.select().from(users).where(eq(users.userId, payload.sub)).limit(1)
    if (!user || !user.totpSecret) return reply.status(401).send({ error: 'Invalid session' })

    if (user.lockedAt) return reply.status(403).send({ error: 'Account locked. Contact your administrator.' })

    // Replay check — reject code that was already used within its 90-second window
    if (isTotpUsed(user.userId, body.totpCode)) {
      return reply.status(401).send({ error: 'Code already used — wait for the next code' })
    }

    const valid = verifyTotp(body.totpCode, user.totpSecret)
    if (!valid) {
      const newAttempts = user.failedLoginAttempts + 1
      const shouldLock  = newAttempts >= MAX_2FA_ATTEMPTS
      await db.update(users)
        .set({ failedLoginAttempts: newAttempts, lockedAt: shouldLock ? new Date() : null })
        .where(eq(users.userId, user.userId))
      await writeAudit({ userId: user.userId, userRole: user.role, action: '2fa_failed', metadata: { attempts: newAttempts, locked: shouldLock }, ipAddress: req.ip })
      if (shouldLock) return reply.status(403).send({ error: 'Account locked after too many failed 2FA attempts.' })
      return reply.status(401).send({ error: 'Invalid 2FA code' })
    }

    markTotpUsed(user.userId, body.totpCode)
    await writeAudit({ userId: user.userId, userRole: user.role, action: '2fa_verified', ipAddress: req.ip })
    return issueSession(app, reply, user, req.ip)
  })

  // POST /api/auth/setup-2fa  (first-time 2FA setup for admins)
  app.post('/setup-2fa', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = (req as any).user
    if (user.role === 'user') return reply.status(403).send({ error: 'Not required for this role' })

    const [dbUser] = await db.select({ username: users.username })
      .from(users).where(eq(users.userId, user.sub)).limit(1)
    if (!dbUser) return reply.status(404).send({ error: 'User not found' })

    const secret = generateTotpSecret()
    const qrCode = await generateTotpQR(dbUser.username, secret)

    await db.update(users)
      .set({ totpSecret: secret, totpVerified: false })
      .where(eq(users.userId, user.sub))

    return reply.send({ secret, qrCode })
  })

  // POST /api/auth/confirm-2fa-setup
  app.post('/confirm-2fa-setup', { onRequest: [app.authenticate] }, async (req, reply) => {
    const body = z.object({ totpCode: z.string().length(6) }).parse(req.body)
    const user = (req as any).user

    const [dbUser] = await db.select().from(users).where(eq(users.userId, user.sub)).limit(1)
    if (!dbUser?.totpSecret) return reply.status(400).send({ error: 'No pending 2FA setup' })

    const valid = verifyTotp(body.totpCode, dbUser.totpSecret)
    if (!valid) return reply.status(400).send({ error: 'Invalid code — try again' })

    await db.update(users).set({ totpVerified: true }).where(eq(users.userId, user.sub))
    await writeAudit({ userId: user.sub, userRole: user.role, action: '2fa_setup_confirmed', ipAddress: req.ip })

    return reply.send({ success: true })
  })

  // POST /api/auth/logout
  app.post('/logout', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = (req as any).user
    await writeAudit({ userId: user.sub, userRole: user.role, action: 'logout', ipAddress: req.ip })
    reply.clearCookie('accessToken', { path: '/' })
    return reply.send({ success: true })
  })

  // GET /api/auth/me
  app.get('/me', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = (req as any).user
    const [dbUser] = await db.select({
      userId:   users.userId,
      username: users.username,
      role:     users.role,
      branchId: users.branchId,
    }).from(users).where(eq(users.userId, user.sub)).limit(1)

    if (!dbUser) return reply.status(404).send({ error: 'User not found' })
    return reply.send(dbUser)
  })
}

// ---------------------------------------------------------------------------
// Role-based session expiry
// Tighten these for production; keep long during testing
// ---------------------------------------------------------------------------
const SESSION_EXPIRY: Record<string, string> = {
  super_admin:   '8h',
  branch_admin:  '8h',
  user:          '8h',
}

// ---------------------------------------------------------------------------
// Helper — issue access token + set refresh cookie
// ---------------------------------------------------------------------------
async function issueSession(app: FastifyInstance, reply: any, user: any, ip: string) {
  const expiresIn   = SESSION_EXPIRY[user.role as string] ?? '8h'
  const accessToken = await reply.jwtSign(
    { sub: user.userId, role: user.role, branchId: user.branchId },
    { expiresIn },
  )

  const isProduction = process.env.NODE_ENV === 'production'
  reply.setCookie('accessToken', accessToken, {
    httpOnly: true,
    secure:   isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path:     '/',
    maxAge:   8 * 60 * 60, // 8 hours in seconds
  })

  await db.update(users)
    .set({ failedLoginAttempts: 0, lockedAt: null, lastLoginAt: new Date() })
    .where(eq(users.userId, user.userId))

  await writeAudit({ userId: user.userId, userRole: user.role, action: 'login_success', ipAddress: ip })

  return reply.send({ user: {
    userId:   user.userId,
    username: user.username,
    role:     user.role,
    branchId: user.branchId,
  }})
}
