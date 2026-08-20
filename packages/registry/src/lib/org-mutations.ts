// Org create / invite / membership writes for the MySQL/Prisma path (U4).
import type { PrismaClient } from '@prisma/client'
import type { PrismaDb } from '../db/prisma-client.js'
import { runPrismaTransaction } from '../db/prisma-client.js'
import { ensureOrgAuthorRowPrisma } from './org-access.js'
import { baselineOrgMemberKitsPrisma } from './kit-mutations.js'
import type { OrgInviteRow } from './org-invites.js'
import type { SkillSummaryRow } from '../routes/skill-summary.js'

export interface OrgMemberListRow {
  user_id: string
  handle: string | null
  role: string
  invited_at: number
  accepted_at: number | null
}

export interface OrgPendingInviteRow {
  id: string
  handle: string | null
  email: string | null
  role: string
  created_at: number
}

export interface CallerOrgRow {
  id: string
  slug: string
  name: string
  role: string
}

/** Create org + owner membership + authors row in one transaction. */
export async function createOrganizationPrisma(
  prisma: PrismaClient,
  args: { orgId: string; slug: string; name: string; ownerUserId: string },
): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  await runPrismaTransaction(prisma, async (tx) => {
    await tx.organizations.create({
      data: {
        id: args.orgId,
        slug: args.slug,
        name: args.name,
        owner_user_id: args.ownerUserId,
      },
    })
    await tx.organization_members.create({
      data: {
        org_id: args.orgId,
        user_id: args.ownerUserId,
        role: 'owner',
        accepted_at: now,
      },
    })
    await ensureOrgAuthorRowPrisma(tx, args.slug, args.name)
  })
}

export async function findUserIdByHandlePrisma(
  prisma: PrismaDb,
  handle: string,
): Promise<string | null> {
  const row = await prisma.users.findFirst({
    where: { handle },
    select: { id: true },
  })
  return row?.id ?? null
}

export async function createOrgInvitePrisma(
  prisma: PrismaDb,
  args: {
    inviteId: string
    orgId: string
    handle: string | null
    email: string | null
    role: string
    invitedBy: string
  },
): Promise<void> {
  await prisma.organization_invites.create({
    data: {
      id: args.inviteId,
      org_id: args.orgId,
      handle: args.handle,
      email: args.email,
      role: args.role,
      invited_by: args.invitedBy,
    },
  })
}

export async function listOrgMembersPrisma(
  prisma: PrismaDb,
  orgId: string,
): Promise<OrgMemberListRow[]> {
  const rows = await prisma.organization_members.findMany({
    where: { org_id: orgId, accepted_at: { not: null } },
    orderBy: { invited_at: 'asc' },
    select: {
      user_id: true,
      role: true,
      invited_at: true,
      accepted_at: true,
      users_organization_members_user_idTousers: { select: { handle: true } },
    },
  })
  return rows.map((row) => ({
    user_id: row.user_id,
    handle: row.users_organization_members_user_idTousers.handle,
    role: row.role,
    invited_at: row.invited_at,
    accepted_at: row.accepted_at,
  }))
}

export async function listOrgPendingInvitesPrisma(
  prisma: PrismaDb,
  orgId: string,
): Promise<OrgPendingInviteRow[]> {
  return prisma.organization_invites.findMany({
    where: { org_id: orgId, redeemed_at: null },
    orderBy: { created_at: 'asc' },
    select: {
      id: true,
      handle: true,
      email: true,
      role: true,
      created_at: true,
    },
  })
}

export async function removeOrgMemberPrisma(
  prisma: PrismaDb,
  orgId: string,
  userId: string,
): Promise<boolean> {
  const result = await prisma.organization_members.deleteMany({
    where: { org_id: orgId, user_id: userId },
  })
  return result.count > 0
}

export async function revokeOrgInvitePrisma(
  prisma: PrismaDb,
  orgId: string,
  inviteId: string,
): Promise<boolean> {
  const result = await prisma.organization_invites.deleteMany({
    where: { org_id: orgId, id: inviteId, redeemed_at: null },
  })
  return result.count > 0
}

export async function updateOrgMemberRolePrisma(
  prisma: PrismaDb,
  orgId: string,
  userId: string,
  role: string,
): Promise<boolean> {
  const result = await prisma.organization_members.updateMany({
    where: { org_id: orgId, user_id: userId, accepted_at: { not: null } },
    data: { role },
  })
  return result.count > 0
}

/** Redeem invite: upsert accepted membership + stamp redeemed_at. */
export async function acceptOrgInvitePrisma(
  prisma: PrismaClient,
  args: {
    orgId: string
    userId: string
    invite: OrgInviteRow
  },
): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  await runPrismaTransaction(prisma, async (tx) => {
    const existing = await tx.organization_members.findUnique({
      where: {
        org_id_user_id: { org_id: args.orgId, user_id: args.userId },
      },
      select: { accepted_at: true },
    })

    if (!existing) {
      await tx.organization_members.create({
        data: {
          org_id: args.orgId,
          user_id: args.userId,
          role: args.invite.role,
          invited_by: args.invite.invited_by,
          accepted_at: now,
        },
      })
    } else if (existing.accepted_at == null) {
      await tx.organization_members.update({
        where: {
          org_id_user_id: { org_id: args.orgId, user_id: args.userId },
        },
        data: { role: args.invite.role, accepted_at: now },
      })
    }

    await tx.organization_invites.update({
      where: { id: args.invite.id },
      data: { redeemed_at: now },
    })
  })

  // Join = consent: baseline the team's kits' current versions as approved, so the
  // new member syncs them silently and only future versions queue on /updates.
  // Best-effort and idempotent — runs after the membership is committed.
  await baselineOrgMemberKitsPrisma(prisma, args.orgId, args.userId)
}

export async function listCallerOrgsPrisma(
  prisma: PrismaDb,
  userId: string,
): Promise<CallerOrgRow[]> {
  const rows = await prisma.organization_members.findMany({
    where: { user_id: userId, accepted_at: { not: null } },
    orderBy: { invited_at: 'asc' },
    select: {
      role: true,
      organizations: { select: { id: true, slug: true, name: true } },
    },
  })
  return rows.map((row) => ({
    id: row.organizations.id,
    slug: row.organizations.slug,
    name: row.organizations.name,
    role: row.role,
  }))
}

/**
 * Org-owned skill summaries for GET /api/v1/orgs/:orgSlug/skills.
 * Matches SKILL_SUMMARY_SELECT shape via in-process joins.
 */
export async function listOrgSkillSummariesPrisma(
  prisma: PrismaDb,
  orgSlug: string,
): Promise<SkillSummaryRow[]> {
  const skills = await prisma.skills.findMany({
    where: { author_id: orgSlug, latest_hash: { not: null } },
    orderBy: { created_at: 'desc' },
    select: {
      id: true,
      author_id: true,
      slug: true,
      description: true,
      visibility: true,
      latest_hash: true,
      install_count: true,
      created_at: true,
      category: true,
      moderation_status: true,
    },
  })
  if (skills.length === 0) return []

  const skillIds = skills.map((s) => s.id)
  const latestHashes = skills
    .map((s) => s.latest_hash)
    .filter((h): h is string => typeof h === 'string' && h.length > 0)

  const [versionCounts, latestVersions, scanRows, authorUser] = await Promise.all([
    prisma.skill_versions.groupBy({
      by: ['skill_id'],
      where: { skill_id: { in: skillIds } },
      _count: { _all: true },
    }),
    prisma.skill_versions.findMany({
      where: { hash: { in: latestHashes } },
      select: {
        skill_id: true,
        hash: true,
        major: true,
        minor: true,
        patch: true,
        signature_b64: true,
        signature_key_id: true,
      },
    }),
    prisma.skill_version_scans.findMany({
      where: { skill_version_id: { in: latestHashes } },
      select: { skill_version_id: true, status: true },
    }),
    prisma.users.findFirst({
      where: { handle: orgSlug },
      select: { author_key_id: true },
    }),
  ])

  const countBySkill = new Map(versionCounts.map((r) => [r.skill_id, r._count._all]))
  const versionByHash = new Map(latestVersions.map((v) => [v.hash, v]))
  const scanByHash = new Map(scanRows.map((s) => [s.skill_version_id, s.status]))
  const registeredKeyId = authorUser?.author_key_id ?? null

  return skills.map((s) => {
    const latest = s.latest_hash ? versionByHash.get(s.latest_hash) : undefined
    return {
      author_id: s.author_id,
      slug: s.slug,
      skill_id: s.id,
      description: s.description,
      visibility: (s.visibility === 'public' ? 'public' : 'private') as 'private' | 'public',
      latest_hash: s.latest_hash,
      version: countBySkill.get(s.id) ?? 0,
      latest_major: latest?.major ?? null,
      latest_minor: latest?.minor ?? null,
      latest_patch: latest?.patch ?? null,
      install_count: s.install_count,
      created_at: s.created_at,
      signature_b64: latest?.signature_b64 ?? null,
      signature_key_id: latest?.signature_key_id ?? null,
      registered_key_id: registeredKeyId,
      scan_status: s.latest_hash ? (scanByHash.get(s.latest_hash) ?? null) : null,
      moderation_status: s.moderation_status,
      category: s.category,
    }
  })
}
