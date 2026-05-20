import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { branches } from '../db/schema.js'

export async function branchRoutes(app: FastifyInstance) {

  // GET /api/branches — returns all active branches (authenticated users only)
  app.get('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const rows = await db.select({
      branchId: branches.branchId,
      name:     branches.name,
      location: branches.location,
      active:   branches.active,
    }).from(branches).where(eq(branches.active, true)).orderBy(branches.name)

    return reply.send(rows)
  })
}
