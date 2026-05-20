import type { FastifyInstance } from 'fastify'
import { z } from 'zod/v4'
import { desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { settingsVersions } from '../db/schema.js'
import { writeAudit } from '../lib/audit.js'
import { DEFAULT_SETTINGS, type SettingsPayload } from '../types/settings.js'

const MilestoneSchema = z.object({
  number:    z.union([z.literal(1), z.literal(2), z.literal(3)]),
  threshold: z.number().positive(),
  lumpSum:   z.number().int().nonnegative(),
  boostRate: z.number().min(0).max(1),
})

const TierConfigSchema = z.object({
  threshold:    z.number().positive(),
  discountRate: z.number().min(0).max(1),
})

const PointsTierConfigSchema = z.object({
  multiplier:     z.number().positive(),
  redemptionRate: z.number().positive(),
})

const SettingsSchema = z.object({
  discountTiers: z.object({
    gold:     TierConfigSchema,
    platinum: TierConfigSchema,
    diamond:  TierConfigSchema,
  }),
  pointsTiers: z.object({
    gold:     PointsTierConfigSchema,
    platinum: PointsTierConfigSchema,
    diamond:  PointsTierConfigSchema,
  }),
  baseEarnRate: z.number().positive(),
  milestones:   z.array(MilestoneSchema).length(3),
})

export async function settingsRoutes(app: FastifyInstance) {

  // GET /api/settings  — returns latest active settings
  app.get('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const [latest] = await db.select().from(settingsVersions)
      .orderBy(desc(settingsVersions.validFrom)).limit(1)

    if (!latest) return reply.send({ settings: DEFAULT_SETTINGS, versionId: null })
    return reply.send({ settings: latest.payload, versionId: latest.versionId, validFrom: latest.validFrom })
  })

  // GET /api/settings/history  — all versions (super admin only)
  app.get('/history', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = (req as any).user
    if (user.role !== 'super_admin') return reply.status(403).send({ error: 'Super admin only' })

    const history = await db.select().from(settingsVersions).orderBy(desc(settingsVersions.validFrom))
    return reply.send(history)
  })

  // POST /api/settings  — save new settings version (super admin only)
  app.post('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = (req as any).user
    if (user.role !== 'super_admin') return reply.status(403).send({ error: 'Super admin only' })

    const newSettings = SettingsSchema.parse(req.body) as SettingsPayload

    // Get current settings for audit diff
    const [current] = await db.select().from(settingsVersions)
      .orderBy(desc(settingsVersions.validFrom)).limit(1)

    const [version] = await db.insert(settingsVersions).values({
      payload:   newSettings,
      createdBy: user.sub,
    }).returning()

    await writeAudit({
      userId: user.sub, userRole: user.role,
      action: 'settings_changed',
      entityType: 'settings_version', entityId: version.versionId,
      oldValue: current?.payload,
      newValue: newSettings,
      ipAddress: req.ip,
    })

    return reply.status(201).send({ versionId: version.versionId, validFrom: version.validFrom, settings: newSettings })
  })
}
