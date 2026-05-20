import 'dotenv/config'
import { db } from '../index.js'
import { branches, users, settingsVersions, auditLog, pointsLedger, payouts, invoices, members, tierHistory, yearlySnapshots } from '../schema.js'
import { hashPassword, generateTotpSecret } from '../../lib/auth.js'
import { DEFAULT_SETTINGS } from '../../types/settings.js'

async function seed() {
  console.log('Seeding database...')

  // Clear existing data (order matters — FK dependencies)
  await db.delete(auditLog)
  await db.delete(pointsLedger)
  await db.delete(payouts)
  await db.delete(invoices)
  await db.delete(tierHistory)
  await db.delete(yearlySnapshots)
  await db.delete(members)
  await db.delete(settingsVersions)
  await db.delete(users)
  await db.delete(branches)
  console.log('Cleared existing data')

  // Branches
  const branchRows = await db.insert(branches).values([
    { name: 'Head Office',    location: 'Mumbai' },
    { name: 'North Branch',   location: 'Delhi' },
    { name: 'South Branch',   location: 'Bangalore' },
    { name: 'East Branch',    location: 'Kolkata' },
    { name: 'West Branch',    location: 'Ahmedabad' },
  ]).returning()
  console.log(`Created ${branchRows.length} branches`)

  // Super admin (no branch restriction)
  const passwordHash = await hashPassword('Admin@1234')
  const [superAdmin] = await db.insert(users).values({
    username:     'superadmin',
    passwordHash,
    role:         'super_admin',
    branchId:     null,
    totpSecret:   generateTotpSecret(), // satisfies DB constraint; 2FA not yet verified
    totpVerified: false,
  }).returning()
  console.log(`Created super admin: superadmin / Admin@1234`)

  // Branch admin for head office
  const branchAdminHash = await hashPassword('Branch@1234')
  await db.insert(users).values({
    username:     'headoffice.admin',
    passwordHash: branchAdminHash,
    role:         'branch_admin',
    branchId:     branchRows[0].branchId,
    totpSecret:   generateTotpSecret(),
    totpVerified: false,
    createdBy:    superAdmin.userId,
  })
  console.log(`Created branch admin: headoffice.admin / Branch@1234`)

  // Initial settings version (super admin as creator)
  const [sv] = await db.insert(settingsVersions).values({
    createdBy: superAdmin.userId,
    payload:   DEFAULT_SETTINGS,
  }).returning()
  console.log(`Created initial settings version: ${sv.versionId}`)

  console.log('\nSeed complete!')
  console.log('─────────────────────────────────────')
  console.log('Super admin login:  superadmin / Admin@1234')
  console.log('Branch admin login: headoffice.admin / Branch@1234')
  console.log('NOTE: 2FA is NOT set up for these seed accounts.')
  console.log('      Log in → Settings → Set up 2FA before enabling in production.')
  process.exit(0)
}

seed().catch(err => {
  console.error(err)
  process.exit(1)
})
