// Proposal leaf reads/writes for the MySQL/Prisma path (U4 remainder).
// Mirrors auth + CRUD helpers from routes/proposals.ts without wiring routes.
import type { PrismaDb } from '../db/prisma-client.js'
import {
  canAccessOrgAuthorPrisma,
  isOrgSlugPrisma,
} from './org-access.js'

export interface ProposalSummaryRow {
  id: string
  skill_id: string
  base_hash: string | null
  proposed_hash: string
  state: string
  proposer_author_id: string
  created_at: number
  decided_by: string | null
  decided_at: number | null
  decision_note: string | null
}

export interface ProposalDetailRow extends ProposalSummaryRow {
  signature_alg: string | null
  signature_key_id: string | null
  signature_b64: string | null
  author_key_id: string | null
}

export interface CreateProposalInput {
  proposalId: string
  skillId: string
  baseHash: string | null
  proposedHash: string
  proposerHandle: string
  signatureAlg: string
  signatureKeyId: string
  signatureB64: string
  authorKeyId: string
  files: Array<{ path: string; blobHash: string }>
}

export interface ProposalSkillRow {
  id: string
  latest_hash: string | null
  author_id: string
}

export interface ProposalFileRow {
  path: string
  blob_hash: string
}

/** Prisma async counterpart of `isSkillOwner` in routes/proposals.ts. */
export async function isSkillOwnerPrisma(
  prisma: PrismaDb,
  skillId: string,
  userId: string,
): Promise<boolean> {
  const skill = await prisma.skills.findUnique({
    where: { id: skillId },
    select: { author_id: true },
  })
  if (!skill) return false
  const user = await prisma.users.findFirst({
    where: { id: userId, handle: skill.author_id },
    select: { id: true },
  })
  return user != null
}

/** Collect org ids where a user is owner or accepted member. */
async function userOrgIdsPrisma(prisma: PrismaDb, userId: string): Promise<string[]> {
  const owned = await prisma.organizations.findMany({
    where: { owner_user_id: userId },
    select: { id: true },
  })
  const member = await prisma.organization_members.findMany({
    where: { user_id: userId, accepted_at: { not: null } },
    select: { org_id: true },
  })
  return [...owned.map((row) => row.id), ...member.map((row) => row.org_id)]
}

/** Prisma async counterpart of `sharesTeamWithOwner` in routes/proposals.ts. */
export async function sharesTeamWithOwnerPrisma(
  prisma: PrismaDb,
  ownerHandle: string,
  userId: string,
): Promise<boolean> {
  const owner = await prisma.users.findFirst({
    where: { handle: ownerHandle },
    select: { id: true },
  })
  if (!owner || owner.id === userId) return false

  const ownerOrgs = await userOrgIdsPrisma(prisma, owner.id)
  if (ownerOrgs.length === 0) return false

  const proposerOrgs = new Set(await userOrgIdsPrisma(prisma, userId))
  return ownerOrgs.some((orgId) => proposerOrgs.has(orgId))
}

/** Prisma async counterpart of `canProposeToSkill` in routes/proposals.ts. */
export async function canProposeToSkillPrisma(
  prisma: PrismaDb,
  skillId: string,
  userId: string,
): Promise<boolean> {
  if (await isSkillOwnerPrisma(prisma, skillId, userId)) return true

  const skill = await prisma.skills.findUnique({
    where: { id: skillId },
    select: { author_id: true },
  })
  if (!skill) return false

  if (await isOrgSlugPrisma(prisma, skill.author_id)) {
    return canAccessOrgAuthorPrisma(prisma, skill.author_id, userId)
  }
  return sharesTeamWithOwnerPrisma(prisma, skill.author_id, userId)
}

/** We load the skill fields used across proposal routes. */
export async function findProposalSkillPrisma(
  prisma: PrismaDb,
  skillId: string,
): Promise<ProposalSkillRow | null> {
  return prisma.skills.findUnique({
    where: { id: skillId },
    select: { id: true, latest_hash: true, author_id: true },
  })
}

/** List proposals for a skill (GET list leaf). */
export async function listProposalsForSkillPrisma(
  prisma: PrismaDb,
  skillId: string,
): Promise<ProposalSummaryRow[]> {
  return prisma.skill_proposals.findMany({
    where: { skill_id: skillId },
    orderBy: { created_at: 'desc' },
    select: {
      id: true,
      skill_id: true,
      base_hash: true,
      proposed_hash: true,
      state: true,
      proposer_author_id: true,
      created_at: true,
      decided_by: true,
      decided_at: true,
      decision_note: true,
    },
  })
}

/** Load one proposal scoped to a skill (detail/decision leaf). */
export async function findProposalPrisma(
  prisma: PrismaDb,
  proposalId: string,
  skillId: string,
): Promise<ProposalDetailRow | null> {
  return prisma.skill_proposals.findFirst({
    where: { id: proposalId, skill_id: skillId },
    select: {
      id: true,
      skill_id: true,
      base_hash: true,
      proposed_hash: true,
      state: true,
      proposer_author_id: true,
      signature_alg: true,
      signature_key_id: true,
      signature_b64: true,
      author_key_id: true,
      created_at: true,
      decided_by: true,
      decided_at: true,
      decision_note: true,
    },
  })
}

/** We load the file manifest for a proposal. */
export async function listProposalFilesPrisma(
  prisma: PrismaDb,
  proposalId: string,
): Promise<ProposalFileRow[]> {
  return prisma.proposal_files.findMany({
    where: { proposal_id: proposalId },
    orderBy: { path: 'asc' },
    select: { path: true, blob_hash: true },
  })
}

/** We load a published version manifest for proposal diffing and name locking. */
export async function listVersionFilesPrisma(
  prisma: PrismaDb,
  skillId: string,
  versionHash: string,
): Promise<ProposalFileRow[]> {
  return prisma.skill_version_files.findMany({
    where: { skill_id: skillId, version_hash: versionHash },
    orderBy: { path: 'asc' },
    select: { path: true, blob_hash: true },
  })
}

/** We read the public key projection shown in proposal detail. */
export async function findProposalAuthorKeyPrisma(
  prisma: PrismaDb,
  handle: string,
): Promise<{ author_key_id: string | null; author_public_key: string | null }> {
  return (
    (await prisma.users.findFirst({
      where: { handle },
      select: { author_key_id: true, author_public_key: true },
    })) ?? { author_key_id: null, author_public_key: null }
  )
}

/** We read the persisted proposal scan without falling back to sqlite. */
export async function getProposalScanPrisma(
  prisma: PrismaDb,
  proposalId: string,
): Promise<{ status: string; findings_json: string; scanned_at: number | null } | null> {
  return prisma.proposal_scans.findUnique({
    where: { proposal_id: proposalId },
    select: { status: true, findings_json: true, scanned_at: true },
  })
}

/** We persist an in-process proposal scan result. */
export async function updateProposalScanPrisma(
  prisma: PrismaDb,
  proposalId: string,
  status: string,
  findingsJson: string,
  scannedAt: number,
): Promise<void> {
  await prisma.proposal_scans.upsert({
    where: { proposal_id: proposalId },
    create: {
      proposal_id: proposalId,
      status,
      findings_json: findingsJson,
      scanned_at: scannedAt,
    },
    update: { status, findings_json: findingsJson, scanned_at: scannedAt },
  })
}

/**
 * Create a pending proposal + file rows. Caller must ensure blob rows exist for
 * FK safety on proposal_files.
 */
export async function createProposalPrisma(
  prisma: PrismaDb,
  input: CreateProposalInput,
): Promise<void> {
  await prisma.authors.createMany({
    data: [{ id: input.proposerHandle, name: input.proposerHandle }],
    skipDuplicates: true,
  })

  await prisma.skill_proposals.create({
    data: {
      id: input.proposalId,
      skill_id: input.skillId,
      base_hash: input.baseHash,
      proposed_hash: input.proposedHash,
      proposer_author_id: input.proposerHandle,
      signature_alg: input.signatureAlg,
      signature_key_id: input.signatureKeyId,
      signature_b64: input.signatureB64,
      author_key_id: input.authorKeyId,
    },
  })

  if (input.files.length > 0) {
    await prisma.proposal_files.createMany({
      data: input.files.map((file) => ({
        proposal_id: input.proposalId,
        path: file.path,
        blob_hash: file.blobHash,
      })),
    })
  }

  await prisma.proposal_scans.create({
    data: {
      proposal_id: input.proposalId,
      status: 'pending',
      findings_json: '[]',
    },
  })
}

/** Set proposal state on request_changes / reject / approve (non-mint path). */
export async function updateProposalDecisionPrisma(
  prisma: PrismaDb,
  proposalId: string,
  state: string,
  decidedBy: string,
  decidedAt: number,
  note: string | null,
): Promise<void> {
  await prisma.skill_proposals.update({
    where: { id: proposalId },
    data: {
      state,
      decided_by: decidedBy,
      decided_at: decidedAt,
      decision_note: note,
    },
  })
}
