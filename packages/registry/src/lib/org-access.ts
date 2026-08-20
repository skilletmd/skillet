/**
 * Shared org membership checks for org-owned skills.
 *
 * Sqlite dual-path bodies were removed in U4. Residual callers outside this
 * unit (skills / proposals / sync / brand-grant) get fail-closed stubs;
 * characterization uses tests/legacy-sqlite-org-access.ts. MySQL uses *Prisma.
 */
import type { DatabaseSync } from '../db/sqlite-handle.js'
import type { PrismaDb } from '../db/prisma-client.js'

export interface OrgRow {
  id: string
  slug: string
  name: string
  // Nullable since migration 037: an unclaimed brand org has no owner yet.
  owner_user_id: string | null
}

export interface KitPrincipal {
  user_id: string
  handle: string | null
}

const SQLITE_REMOVED = 'sqlite registry store removed; use the *Prisma counterpart'

/** Fail-closed stand-in for residual dual-path callers outside U4. */
export function getOrgBySlug(_db: DatabaseSync, _slug: string): OrgRow | undefined {
  throw new Error(`${SQLITE_REMOVED}: getOrgBySlugPrisma`)
}

/** Fail-closed stand-in for residual dual-path callers outside U4. */
export function isOrgSlug(_db: DatabaseSync, _slug: string): boolean {
  throw new Error(`${SQLITE_REMOVED}: isOrgSlugPrisma`)
}

/**
 * Global handle/slug uniqueness: a name is taken if it is any user's handle OR
 * any organization's slug. User handles and org slugs share the authors.id
 * namespace and are resolved as interchangeable owner identifiers, so a name
 * must be unique across BOTH to keep authorization unambiguous. Pass
 * `excludeUserId` on the claim path so a user re-claiming
 * their own handle is not blocked by their own row.
 *
 * Fail-closed stand-in for residual dual-path callers outside U4.
 */
export function handleOrSlugTaken(
  _db: DatabaseSync,
  _name: string,
  _excludeUserId?: string,
): boolean {
  throw new Error(`${SQLITE_REMOVED}: handleOrSlugTakenPrisma`)
}

/** Prisma async counterpart of {@link handleOrSlugTaken} (U4 wave 1). */
export async function handleOrSlugTakenPrisma(
  prisma: PrismaDb,
  name: string,
  excludeUserId?: string,
): Promise<boolean> {
  const user = await prisma.users.findFirst({
    where: excludeUserId
      ? { handle: name, id: { not: excludeUserId } }
      : { handle: name },
    select: { id: true },
  })
  if (user) return true
  const org = await prisma.organizations.findFirst({
    where: { slug: name },
    select: { id: true },
  })
  return org != null
}

/** Fail-closed stand-in for residual dual-path callers outside U4. */
export function isOrgAdmin(
  _db: DatabaseSync,
  _orgId: string,
  _userId: string,
  _ownerUserId: string | null,
): boolean {
  throw new Error(`${SQLITE_REMOVED}: isOrgAdminPrisma`)
}

/** Fail-closed stand-in for residual dual-path callers outside U4. */
export function isOrgMember(
  _db: DatabaseSync,
  _orgId: string,
  _userId: string,
  _ownerUserId: string | null,
): boolean {
  throw new Error(`${SQLITE_REMOVED}: isOrgMemberPrisma`)
}

/** Fail-closed stand-in for residual dual-path callers outside U4. */
export function canAdminOrgAuthor(_db: DatabaseSync, _orgSlug: string, _userId: string): boolean {
  throw new Error(`${SQLITE_REMOVED}: canAdminOrgAuthorPrisma`)
}

/** Fail-closed stand-in for residual dual-path callers outside U4. */
export function canAccessOrgAuthor(_db: DatabaseSync, _orgSlug: string, _userId: string): boolean {
  throw new Error(`${SQLITE_REMOVED}: canAccessOrgAuthorPrisma`)
}

/**
 * Personal owner or current org admin may manage a skill.
 *
 * Note: original-creator (`created_by_user_id`) does NOT grant management of an
 * org-owned skill. A member who first published an org skill but was later
 * removed or demoted must lose management access: authorization is the org's
 * *current* admin set, not who created the artifact. Personal skills are still
 * authorized by the author_id == caller's handle check below.
 *
 * Fail-closed stand-in for residual dual-path callers outside U4.
 */
export function canManageSkill(_db: DatabaseSync, _skillId: string, _userId: string): boolean {
  throw new Error(`${SQLITE_REMOVED}: canManageSkillPrisma`)
}

/**
 * Who may manage a kit's members and agent keys.
 *
 * Fail-closed stand-in for residual dual-path callers outside U4.
 */
export function canManageKit(_db: DatabaseSync, _kitOwnerId: string, _p: KitPrincipal): boolean {
  throw new Error(`${SQLITE_REMOVED}: canManageKitPrisma`)
}

/**
 * Who may read a kit's member roster.
 *
 * Fail-closed stand-in for residual dual-path callers outside U4.
 */
export function canViewKitMembers(
  _db: DatabaseSync,
  _kitId: string,
  _kitOwnerId: string,
  _p: KitPrincipal,
): boolean {
  throw new Error(`${SQLITE_REMOVED}: canViewKitMembersPrisma`)
}

/** Fail-closed stand-in for residual dual-path callers outside U4. */
export function ensureOrgAuthorRow(_db: DatabaseSync, _slug: string, _name: string): void {
  throw new Error(`${SQLITE_REMOVED}: ensureOrgAuthorRowPrisma`)
}

/** Prisma async counterpart of {@link getOrgBySlug} (U4 remainder). */
export async function getOrgBySlugPrisma(
  prisma: PrismaDb,
  slug: string,
): Promise<OrgRow | null> {
  return prisma.organizations.findFirst({
    where: { slug },
    select: { id: true, slug: true, name: true, owner_user_id: true },
  })
}

/** Prisma async counterpart of {@link isOrgSlug} (U4 remainder). */
export async function isOrgSlugPrisma(prisma: PrismaDb, slug: string): Promise<boolean> {
  return (await getOrgBySlugPrisma(prisma, slug)) != null
}

/** Prisma async counterpart of {@link isOrgAdmin} (U4 remainder). */
export async function isOrgAdminPrisma(
  prisma: PrismaDb,
  orgId: string,
  userId: string,
  ownerUserId: string | null,
): Promise<boolean> {
  if (ownerUserId !== null && userId === ownerUserId) return true
  const row = await prisma.organization_members.findUnique({
    where: { org_id_user_id: { org_id: orgId, user_id: userId } },
    select: { role: true, accepted_at: true },
  })
  return row?.accepted_at != null && (row.role === 'owner' || row.role === 'admin')
}

/** Prisma async counterpart of {@link isOrgMember} (U4 remainder). */
export async function isOrgMemberPrisma(
  prisma: PrismaDb,
  orgId: string,
  userId: string,
  ownerUserId: string | null,
): Promise<boolean> {
  if (ownerUserId !== null && userId === ownerUserId) return true
  const row = await prisma.organization_members.findUnique({
    where: { org_id_user_id: { org_id: orgId, user_id: userId } },
    select: { accepted_at: true },
  })
  return row?.accepted_at != null
}

/** Prisma async counterpart of {@link canAdminOrgAuthor} (U4 remainder). */
export async function canAdminOrgAuthorPrisma(
  prisma: PrismaDb,
  orgSlug: string,
  userId: string,
): Promise<boolean> {
  const org = await getOrgBySlugPrisma(prisma, orgSlug)
  if (!org) return false
  return isOrgAdminPrisma(prisma, org.id, userId, org.owner_user_id)
}

/** Prisma async counterpart of {@link canAccessOrgAuthor} (U4 remainder). */
export async function canAccessOrgAuthorPrisma(
  prisma: PrismaDb,
  orgSlug: string,
  userId: string,
): Promise<boolean> {
  const org = await getOrgBySlugPrisma(prisma, orgSlug)
  if (!org) return false
  return isOrgMemberPrisma(prisma, org.id, userId, org.owner_user_id)
}

/** Prisma async counterpart of {@link canManageSkill} (U4 remainder). */
export async function canManageSkillPrisma(
  prisma: PrismaDb,
  skillId: string,
  userId: string,
): Promise<boolean> {
  const skill = await prisma.skills.findUnique({
    where: { id: skillId },
    select: { author_id: true },
  })
  if (!skill) return false

  const org = await getOrgBySlugPrisma(prisma, skill.author_id)
  if (org) return isOrgAdminPrisma(prisma, org.id, userId, org.owner_user_id)

  const personal = await prisma.users.findFirst({
    where: { handle: skill.author_id, id: userId },
    select: { id: true },
  })
  return personal != null
}

/** Prisma async counterpart of {@link canManageKit} (U4 remainder). */
export async function canManageKitPrisma(
  prisma: PrismaDb,
  kitOwnerId: string,
  p: KitPrincipal,
): Promise<boolean> {
  const org = await getOrgBySlugPrisma(prisma, kitOwnerId)
  if (org) return isOrgAdminPrisma(prisma, org.id, p.user_id, org.owner_user_id)
  return !!p.handle && kitOwnerId === p.handle
}

/** Prisma async counterpart of {@link canViewKitMembers} (U4 remainder). */
export async function canViewKitMembersPrisma(
  prisma: PrismaDb,
  kitId: string,
  kitOwnerId: string,
  p: KitPrincipal,
): Promise<boolean> {
  const org = await getOrgBySlugPrisma(prisma, kitOwnerId)
  if (org) {
    if (await isOrgMemberPrisma(prisma, org.id, p.user_id, org.owner_user_id)) return true
  } else if (!!p.handle && kitOwnerId === p.handle) {
    return true
  }
  const row = await prisma.kit_members.findUnique({
    where: { kit_id_user_id: { kit_id: kitId, user_id: p.user_id } },
    select: { kit_id: true },
  })
  return row != null
}

/** Prisma async counterpart of {@link ensureOrgAuthorRow} (U4 remainder). */
export async function ensureOrgAuthorRowPrisma(
  prisma: PrismaDb,
  slug: string,
  name: string,
): Promise<void> {
  await prisma.authors.createMany({
    data: [{ id: slug, name }],
    skipDuplicates: true,
  })
}
