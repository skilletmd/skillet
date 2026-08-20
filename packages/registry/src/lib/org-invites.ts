// Org invite lookups for the MySQL/Prisma path (U4 remainder).
// Mirrors leaf reads/writes from routes/orgs.ts without wiring routes yet.
import type { PrismaDb } from '../db/prisma-client.js'

export interface OrgInviteRow {
  id: string
  org_id: string
  handle: string | null
  email: string | null
  role: string
  invited_by: string
  redeemed_at: number | null
}

export interface PendingInviteForUserRow {
  invite_id: string
  org_slug: string
  org_name: string
  role: string
  invited_at: number
  invited_by_handle: string | null
}

/**
 * Prisma async counterpart of `verifiedEmailForHandle` in routes/orgs.ts.
 * Returns the most-recently-added verified email for a handle, or null.
 */
export async function verifiedEmailForHandlePrisma(
  prisma: PrismaDb,
  handle: string,
): Promise<string | null> {
  const row = await prisma.user_identities.findFirst({
    where: {
      email: { not: null },
      email_verified: 1,
      users: { handle },
    },
    orderBy: { created_at: 'desc' },
    select: { email: true },
  })
  return row?.email ?? null
}

/** True when an unredeemed invite already exists for the same org + identifier. */
export async function hasDuplicatePendingInvitePrisma(
  prisma: PrismaDb,
  orgId: string,
  handle: string | null,
  email: string | null,
): Promise<boolean> {
  const row = await prisma.organization_invites.findFirst({
    where: {
      org_id: orgId,
      redeemed_at: null,
      OR: [
        ...(handle != null ? [{ handle }] : []),
        ...(email != null ? [{ email }] : []),
      ],
    },
    select: { id: true },
  })
  return row != null
}

/** Load one invite by id scoped to an org (accept path). */
export async function findOrgInvitePrisma(
  prisma: PrismaDb,
  inviteId: string,
  orgId: string,
): Promise<OrgInviteRow | null> {
  return prisma.organization_invites.findFirst({
    where: { id: inviteId, org_id: orgId },
    select: {
      id: true,
      org_id: true,
      handle: true,
      email: true,
      role: true,
      invited_by: true,
      redeemed_at: true,
    },
  })
}

/** Membership row for duplicate-member checks on invite create. */
export async function findOrganizationMemberPrisma(
  prisma: PrismaDb,
  orgId: string,
  userId: string,
): Promise<{ accepted_at: number | null } | null> {
  return prisma.organization_members.findUnique({
    where: { org_id_user_id: { org_id: orgId, user_id: userId } },
    select: { accepted_at: true },
  })
}

/**
 * Pending invites addressed to a user (GET /api/v1/orgs/invites).
 * Excludes orgs the user has already joined.
 */
export async function listPendingInvitesForUserPrisma(
  prisma: PrismaDb,
  userId: string,
  handle: string | null,
): Promise<PendingInviteForUserRow[]> {
  const identities = await prisma.user_identities.findMany({
    where: { user_id: userId, email: { not: null } },
    select: { email: true },
  })
  const emailSet = new Set(
    identities
      .map((row) => row.email?.toLowerCase())
      .filter((email): email is string => typeof email === 'string' && email.length > 0),
  )

  const joinedOrgIds = new Set(
    (
      await prisma.organization_members.findMany({
        where: { user_id: userId, accepted_at: { not: null } },
        select: { org_id: true },
      })
    ).map((row) => row.org_id),
  )

  const invites = await prisma.organization_invites.findMany({
    where: { redeemed_at: null },
    orderBy: { created_at: 'asc' },
    select: {
      id: true,
      org_id: true,
      handle: true,
      email: true,
      role: true,
      created_at: true,
      invited_by: true,
      organizations: { select: { slug: true, name: true } },
    },
  })

  const matched = invites.filter((invite) => {
    if (joinedOrgIds.has(invite.org_id)) return false
    if (handle != null && invite.handle === handle) return true
    if (invite.email != null && emailSet.has(invite.email.toLowerCase())) return true
    return false
  })

  const inviterIds = [...new Set(matched.map((row) => row.invited_by))]
  const inviters =
    inviterIds.length > 0
      ? await prisma.users.findMany({
          where: { id: { in: inviterIds } },
          select: { id: true, handle: true },
        })
      : []
  const inviterHandleById = new Map(inviters.map((row) => [row.id, row.handle]))

  return matched.map((invite) => ({
    invite_id: invite.id,
    org_slug: invite.organizations.slug,
    org_name: invite.organizations.name,
    role: invite.role,
    invited_at: invite.created_at,
    invited_by_handle: inviterHandleById.get(invite.invited_by) ?? null,
  }))
}
