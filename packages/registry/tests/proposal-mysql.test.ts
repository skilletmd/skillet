// U4 remainder: proposal Prisma leaf helpers against MySQL.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import type { PrismaClient } from '@prisma/client'
import { newId } from '../src/db/index.js'
import {
  canProposeToSkillPrisma,
  createProposalPrisma,
  findProposalPrisma,
  isSkillOwnerPrisma,
  listProposalsForSkillPrisma,
  sharesTeamWithOwnerPrisma,
  updateProposalDecisionPrisma,
} from '../src/lib/proposal-access.js'
import { addSkillVersionPrisma } from './helpers.js'
import {
  ensureMysqlMigrated,
  freshMysqlPrisma,
  resetMysqlRegistry,
  mysqlTestsEnabled
} from './mysql-test-env.js'

const hasDatabaseUrl = mysqlTestsEnabled()

describe('proposal mysql (U4 remainder)', { skip: !hasDatabaseUrl }, () => {
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

  async function seedPersonalSkill(): Promise<{
    ownerId: string
    teammateId: string
    outsiderId: string
    skillId: string
    baseHash: string
  }> {
    const ownerId = newId()
    const teammateId = newId()
    const outsiderId = newId()
    const orgId = newId()
    const ownerHandle = 'skill-owner'
    const teammateHandle = 'teammate'
    const skillId = `${ownerHandle}:widget`
    const baseHash = 'sha256:base'

    await prisma.users.createMany({
      data: [
        { id: ownerId, handle: ownerHandle },
        { id: teammateId, handle: teammateHandle },
        { id: outsiderId, handle: 'stranger' },
      ],
    })
    await prisma.organizations.create({
      data: { id: orgId, slug: 'shared-team', name: 'Shared Team', owner_user_id: ownerId },
    })
    await prisma.organization_members.createMany({
      data: [
        { org_id: orgId, user_id: ownerId, role: 'owner', accepted_at: 1000 },
        { org_id: orgId, user_id: teammateId, role: 'member', accepted_at: 1001 },
      ],
    })
    await prisma.authors.createMany({
      data: [{ id: ownerHandle, name: ownerHandle }],
      skipDuplicates: true,
    })
    await addSkillVersionPrisma(prisma, ownerHandle, 'widget', baseHash, 1000)

    return { ownerId, teammateId, outsiderId, skillId, baseHash }
  }

  it('canProposeToSkillPrisma allows owner, teammate, and blocks strangers', async () => {
    await reset()
    const { ownerId, teammateId, outsiderId, skillId } = await seedPersonalSkill()

    assert.equal(await isSkillOwnerPrisma(prisma, skillId, ownerId), true)
    assert.equal(await isSkillOwnerPrisma(prisma, skillId, teammateId), false)
    assert.equal(await canProposeToSkillPrisma(prisma, skillId, ownerId), true)
    assert.equal(await canProposeToSkillPrisma(prisma, skillId, teammateId), true)
    assert.equal(await canProposeToSkillPrisma(prisma, skillId, outsiderId), false)
    assert.equal(
      await sharesTeamWithOwnerPrisma(prisma, 'skill-owner', teammateId),
      true,
    )
    assert.equal(
      await sharesTeamWithOwnerPrisma(prisma, 'skill-owner', outsiderId),
      false,
    )
  })

  it('createProposalPrisma + list/find helpers persist pending proposals', async () => {
    await reset()
    const { teammateId, skillId, baseHash } = await seedPersonalSkill()
    const proposalId = newId()
    const proposedHash = 'sha256:proposed'
    const blobHash = 'sha256:proposal-md'

    await prisma.blobs.create({ data: { hash: blobHash, size: 8 } })

    await createProposalPrisma(prisma, {
      proposalId,
      skillId,
      baseHash,
      proposedHash,
      proposerHandle: 'teammate',
      signatureAlg: 'ed25519',
      signatureKeyId: 'kid-propose',
      signatureB64: 'sig-propose',
      authorKeyId: 'primary-propose',
      files: [{ path: 'SKILL.md', blobHash }],
    })

    const listed = await listProposalsForSkillPrisma(prisma, skillId)
    assert.equal(listed.length, 1)
    assert.equal(listed[0]?.id, proposalId)
    assert.equal(listed[0]?.state, 'pending')
    assert.equal(listed[0]?.proposed_hash, proposedHash)

    const detail = await findProposalPrisma(prisma, proposalId, skillId)
    assert.ok(detail)
    assert.equal(detail.proposer_author_id, 'teammate')
    assert.equal(detail.signature_key_id, 'kid-propose')

    const scan = await prisma.proposal_scans.findUnique({ where: { proposal_id: proposalId } })
    assert.ok(scan)
    assert.equal(scan.status, 'pending')

    assert.equal(await canProposeToSkillPrisma(prisma, skillId, teammateId), true)
  })

  it('updateProposalDecisionPrisma records reject without minting a version', async () => {
    await reset()
    const { ownerId, skillId, baseHash } = await seedPersonalSkill()
    const proposalId = newId()

    await createProposalPrisma(prisma, {
      proposalId,
      skillId,
      baseHash,
      proposedHash: 'sha256:reject-me',
      proposerHandle: 'teammate',
      signatureAlg: 'ed25519',
      signatureKeyId: 'kid',
      signatureB64: 'sig',
      authorKeyId: 'primary',
      files: [],
    })

    const decidedAt = 1_700_000_100
    await updateProposalDecisionPrisma(
      prisma,
      proposalId,
      'rejected',
      'skill-owner',
      decidedAt,
      'Not now',
    )

    const row = await findProposalPrisma(prisma, proposalId, skillId)
    assert.ok(row)
    assert.equal(row.state, 'rejected')
    assert.equal(row.decided_by, 'skill-owner')
    assert.equal(row.decided_at, decidedAt)
    assert.equal(row.decision_note, 'Not now')

    const versions = await prisma.skill_versions.count({ where: { skill_id: skillId } })
    assert.equal(versions, 1)
    void ownerId
  })
})
