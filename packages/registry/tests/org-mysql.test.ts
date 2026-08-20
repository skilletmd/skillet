// U4 remainder: org membership + invite Prisma helpers against MySQL.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import type { PrismaClient } from '@prisma/client'
import {
  canAccessOrgAuthorPrisma,
  canAdminOrgAuthorPrisma,
  canManageSkillPrisma,
  ensureOrgAuthorRowPrisma,
  getOrgBySlugPrisma,
  handleOrSlugTakenPrisma,
  isOrgAdminPrisma,
  isOrgMemberPrisma,
} from '../src/lib/org-access.js'
import {
  findOrgInvitePrisma,
  findOrganizationMemberPrisma,
  hasDuplicatePendingInvitePrisma,
  listPendingInvitesForUserPrisma,
  verifiedEmailForHandlePrisma,
} from '../src/lib/org-invites.js'
import { newId } from '../src/db/index.js'
import { addSkillVersionPrisma } from './helpers.js'
import {
  ensureMysqlMigrated,
  freshMysqlPrisma,
  resetMysqlRegistry,
  mysqlTestsEnabled
} from './mysql-test-env.js'

const hasDatabaseUrl = mysqlTestsEnabled()

describe('org mysql (U4 remainder)', { skip: !hasDatabaseUrl }, () => {
  let prisma: PrismaClient

  before(async () => {
    await ensureMysqlMigrated()
    prisma = await freshMysqlPrisma()
  })

  after(async () => {
    await prisma?.$disconnect()
  })

  async function reset(): Promise<void> {
    await resetMysqlRegistry(prisma)
  }

  async function seedOrgFixture(): Promise<{
    orgId: string
    orgSlug: string
    ownerId: string
    adminId: string
    memberId: string
    outsiderId: string
  }> {
    const orgSlug = 'acme-corp'
    const orgId = newId()
    const ownerId = newId()
    const adminId = newId()
    const memberId = newId()
    const outsiderId = newId()

    await prisma.users.createMany({
      data: [
        { id: ownerId, handle: 'owner-user' },
        { id: adminId, handle: 'admin-user' },
        { id: memberId, handle: 'member-user' },
        { id: outsiderId, handle: 'outsider-user' },
      ],
    })
    await prisma.organizations.create({
      data: { id: orgId, slug: orgSlug, name: 'Acme Corp', owner_user_id: ownerId },
    })
    await prisma.organization_members.createMany({
      data: [
        { org_id: orgId, user_id: ownerId, role: 'owner', accepted_at: 1000 },
        { org_id: orgId, user_id: adminId, role: 'admin', accepted_at: 1001 },
        { org_id: orgId, user_id: memberId, role: 'member', accepted_at: 1002 },
      ],
    })
    await ensureOrgAuthorRowPrisma(prisma, orgSlug, 'Acme Corp')

    return { orgId, orgSlug, ownerId, adminId, memberId, outsiderId }
  }

  it('membership helpers distinguish owner, admin, member, and outsider', async () => {
    await reset()
    const { orgId, orgSlug, ownerId, adminId, memberId, outsiderId } = await seedOrgFixture()

    const org = await getOrgBySlugPrisma(prisma, orgSlug)
    assert.ok(org)
    assert.equal(org.owner_user_id, ownerId)

    assert.equal(await isOrgAdminPrisma(prisma, orgId, ownerId, org.owner_user_id), true)
    assert.equal(await isOrgAdminPrisma(prisma, orgId, adminId, org.owner_user_id), true)
    assert.equal(await isOrgAdminPrisma(prisma, orgId, memberId, org.owner_user_id), false)
    assert.equal(await isOrgAdminPrisma(prisma, orgId, outsiderId, org.owner_user_id), false)

    assert.equal(await isOrgMemberPrisma(prisma, orgId, memberId, org.owner_user_id), true)
    assert.equal(await isOrgMemberPrisma(prisma, orgId, outsiderId, org.owner_user_id), false)

    assert.equal(await canAdminOrgAuthorPrisma(prisma, orgSlug, adminId), true)
    assert.equal(await canAdminOrgAuthorPrisma(prisma, orgSlug, memberId), false)
    assert.equal(await canAccessOrgAuthorPrisma(prisma, orgSlug, memberId), true)
    assert.equal(await canAccessOrgAuthorPrisma(prisma, orgSlug, outsiderId), false)
  })

  it('handleOrSlugTakenPrisma blocks org slugs and user handles', async () => {
    await reset()
    const { orgSlug } = await seedOrgFixture()
    await prisma.users.create({ data: { id: newId(), handle: 'solo-dev' } })

    assert.equal(await handleOrSlugTakenPrisma(prisma, orgSlug), true)
    assert.equal(await handleOrSlugTakenPrisma(prisma, 'solo-dev'), true)
    assert.equal(await handleOrSlugTakenPrisma(prisma, 'free-name'), false)
  })

  it('canManageSkillPrisma authorizes org admins for org-owned skills only', async () => {
    await reset()
    const { orgSlug, adminId, memberId } = await seedOrgFixture()
    await addSkillVersionPrisma(prisma, orgSlug, 'widget', 'sha256:org-skill', 1000)

    assert.equal(await canManageSkillPrisma(prisma, `${orgSlug}:widget`, adminId), true)
    assert.equal(await canManageSkillPrisma(prisma, `${orgSlug}:widget`, memberId), false)

    await addSkillVersionPrisma(prisma, 'owner-user', 'personal', 'sha256:personal', 1000)
    assert.equal(await canManageSkillPrisma(prisma, 'owner-user:personal', adminId), false)
  })

  it('invite helpers resolve verified email, duplicates, and pending lists', async () => {
    await reset()
    const { orgId, orgSlug, ownerId, memberId, outsiderId } = await seedOrgFixture()
    const inviteeId = newId()
    await prisma.users.create({ data: { id: inviteeId, handle: 'invitee' } })
    await prisma.user_identities.create({
      data: {
        user_id: inviteeId,
        provider: 'email',
        provider_subject_id: 'invitee@example.com',
        email: 'invitee@example.com',
        email_verified: 1,
      },
    })

    assert.equal(await verifiedEmailForHandlePrisma(prisma, 'invitee'), 'invitee@example.com')

    const inviteId = newId()
    await prisma.organization_invites.create({
      data: {
        id: inviteId,
        org_id: orgId,
        handle: 'invitee',
        role: 'member',
        invited_by: ownerId,
      },
    })

    assert.equal(await hasDuplicatePendingInvitePrisma(prisma, orgId, 'invitee', null), true)
    assert.equal(await hasDuplicatePendingInvitePrisma(prisma, orgId, 'other', null), false)

    const invite = await findOrgInvitePrisma(prisma, inviteId, orgId)
    assert.ok(invite)
    assert.equal(invite.handle, 'invitee')
    assert.equal(invite.redeemed_at, null)

    const memberRow = await findOrganizationMemberPrisma(prisma, orgId, memberId)
    assert.ok(memberRow)
    assert.equal(memberRow.accepted_at, 1002)
    assert.equal(await findOrganizationMemberPrisma(prisma, orgId, outsiderId), null)

    const pending = await listPendingInvitesForUserPrisma(prisma, inviteeId, 'invitee')
    assert.equal(pending.length, 1)
    assert.equal(pending[0]?.org_slug, orgSlug)
    assert.equal(pending[0]?.invite_id, inviteId)

    await prisma.organization_members.create({
      data: { org_id: orgId, user_id: inviteeId, role: 'member', accepted_at: 2000 },
    })
    const afterJoin = await listPendingInvitesForUserPrisma(prisma, inviteeId, 'invitee')
    assert.equal(afterJoin.length, 0)
  })
})
