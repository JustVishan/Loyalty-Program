import 'dotenv/config'
import Fastify from 'fastify'
import fjwt from '@fastify/jwt'
import fcookie from '@fastify/cookie'
import fcors from '@fastify/cors'
import fhelmet from '@fastify/helmet'
import { ZodError } from 'zod/v4'
import { authRoutes } from './routes/auth.js'
import { memberRoutes } from './routes/members.js'
import { invoiceRoutes } from './routes/invoices.js'
import { payoutRoutes } from './routes/payouts.js'
import { settingsRoutes } from './routes/settings.js'
import { dashboardRoutes } from './routes/dashboard.js'
import { branchRoutes } from './routes/branches.js'

const app = Fastify({ logger: true })

// ---------------------------------------------------------------------------
// PLUGINS
// ---------------------------------------------------------------------------

await app.register(fhelmet)
const corsOrigins = (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(',').map(o => o.trim())
await app.register(fcors, {
  origin:      corsOrigins.length === 1 ? corsOrigins[0] : corsOrigins,
  credentials: true,
})
await app.register(fcookie)
await app.register(fjwt, { secret: process.env.JWT_SECRET! })

// Global error handler — turns ZodError into 400, everything else stays 500
app.setErrorHandler((err: any, _req, reply) => {
  if (err instanceof ZodError) {
    const first = err.issues[0]
    return reply.status(400).send({ error: first ? `${first.path.join('.')}: ${first.message}` : 'Validation error' })
  }
  // FK violation on users table means the JWT references a deleted user
  if (err?.cause?.message?.includes('users_user_id_fk')) {
    return reply.status(401).send({ error: 'Session invalid — please log in again' })
  }
  app.log.error(err)
  reply.status(err.statusCode ?? 500).send({ error: err.message ?? 'Internal server error' })
})

// Decorate authenticate — used as onRequest hook on protected routes
app.decorate('authenticate', async (req: any, reply: any) => {
  try {
    await req.jwtVerify()
  } catch {
    reply.status(401).send({ error: 'Unauthorized' })
  }
})

// ---------------------------------------------------------------------------
// ROUTES
// ---------------------------------------------------------------------------

app.register(authRoutes,      { prefix: '/api/auth' })
app.register(branchRoutes,    { prefix: '/api/branches' })
app.register(memberRoutes,    { prefix: '/api/members' })
app.register(invoiceRoutes,   { prefix: '/api/invoices' })
app.register(payoutRoutes,    { prefix: '/api/payouts' })
app.register(settingsRoutes,  { prefix: '/api/settings' })
app.register(dashboardRoutes, { prefix: '/api/dashboard' })

app.get('/api/health', async () => ({ status: 'ok', time: new Date().toISOString() }))

// ---------------------------------------------------------------------------
// START
// ---------------------------------------------------------------------------

try {
  const port = Number(process.env.PORT ?? 3000)
  await app.listen({ port, host: '0.0.0.0' })
  console.log(`RewardHub API running on port ${port}`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
