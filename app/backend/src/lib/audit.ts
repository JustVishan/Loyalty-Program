import { db } from '../db/index.js'
import { auditLog } from '../db/schema.js'
import type { userRoleEnum } from '../db/schema.js'

type UserRole = typeof userRoleEnum.enumValues[number]

interface AuditParams {
  userId?:    string | null
  userRole?:  UserRole | null
  action:     string
  entityType?: string
  entityId?:  string
  oldValue?:  unknown
  newValue?:  unknown
  ipAddress?: string
  metadata?:  unknown
}

export async function writeAudit(params: AuditParams) {
  await db.insert(auditLog).values({
    userId:     params.userId    ?? null,
    userRole:   params.userRole  ?? null,
    action:     params.action,
    entityType: params.entityType,
    entityId:   params.entityId,
    oldValue:   params.oldValue  as any,
    newValue:   params.newValue  as any,
    ipAddress:  params.ipAddress,
    metadata:   params.metadata  as any,
  })
}
