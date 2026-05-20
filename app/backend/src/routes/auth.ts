import type { FastifyInstance } from 'fastify'
import { z } from 'zod/v4'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { users } from '../db/schema.js'
import { hashPassword, verifyPassword, generateTotpSecret, verifyTotp, generateTotpQR } from '../lib/auth.js'
import { writeAudit } from '../lib/audit.js'

const MAX_FAILED_ATTEMPTS = 5

export async function authRoutes(app: FastifyInstance) {

  // POST /api/auth/login
  app.post('/login', async (req, reply) => {
    const body = z.object({
      username: z.string().min(1),
      password: z.string().min(1),
    }).parse(req.body)

    const [user] = await db.select().from(users).where(eq(users.username, body.username)).limit(1)

    const ip = req.ip

    if (!user || !user.active) {
      await writeAudit({ action: 'login_failed', metadata: { username: body.username, reason: 'user_not_found' }, ipAddress: ip })
      return reply.status(401).send({ error: 'Invalid credentials' })
    }

    if (user.lockedAt) {
      await writeAudit({ action: 'login_failed', userId: user.userId, userRole: user.role, metadata: { reason: 'account_locked' }, ipAddress: ip })
      return reply.status(403).send({ error: 'Account locked. Contact your administrator.' })
    }

    const valid = await verifyPassword(body.password, user.passwordHash)

    if (!valid) {
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
      return reply.status(401).send({ error: 'Invalid credentials' })
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

  // POST /api/auth/verify-2fa
  app.post('/verify-2fa', async (req, reply) => {
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

    const valid = verifyTotp(body.totpCode, user.totpSecret)
    if (!valid) {
      await writeAudit({ userId: user.userId, userRole: user.role, action: '2fa_failed', ipAddress: req.ip })
      return reply.status(401).send({ error: 'Invalid 2FA code' })
    }

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
    reply.clearCookie('refreshToken')
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
  const expiresIn  = SESSION_EXPIRY[user.role as string] ?? '8h'
  const accessToken = await reply.jwtSign(
    { sub: user.userId, role: user.role, branchId: user.branchId },
    { expiresIn },
  )

  await db.update(users)
    .set({ failedLoginAttempts: 0, lockedAt: null, lastLoginAt: new Date() })
    .where(eq(users.userId, user.userId))

  await writeAudit({ userId: user.userId, userRole: user.role, action: 'login_success', ipAddress: ip })

  return reply.send({ accessToken, user: {
    userId:   user.userId,
    username: user.username,
    role:     user.role,
    branchId: user.branchId,
  }})
}
