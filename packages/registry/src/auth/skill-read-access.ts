import type { DatabaseSync } from '../db/sqlite-handle.js'
import type { Principal } from './middleware.js'
import { canAccessOrgAuthorPrisma } from '../lib/org-access.js'
import type { PrismaDb } from '../db/prisma-client.js'

/**
 * Fail-closed stand-in for residual dual-path callers outside U2.
 * Real sqlite ACL lives under tests/legacy-sqlite-auth-helpers; MySQL uses
 * {@link canReadSkillPrisma}.
 */
export function canReadSkill(
  _db: DatabaseSync,
  principal: Principal | null | undefined,
  _skillId: string,
  visibility: string,
): boolean {
  if (visibility === 'public') return true
  if (!principal) return false
  throw new Error('sqlite registry store removed; use canReadSkillPrisma')
}

/**
 * Single ACL predicate for skill reads (manifest, version bytes, sync/content).
 * Public skills are readable by anyone; private skills require a live grant.
 */
export async function canReadSkillPrisma(
  prisma: PrismaDb,
  principal: Principal | null | undefined,
  skillId: string,
  visibility: string,
): Promise<boolean> {
  if (visibility === 'public') return true
  if (!principal) return false

  if (principal.class === 'kit') {
    const row = await prisma.kit_skills.findUnique({
      where: { kit_id_skill_id: { kit_id: principal.kit_id, skill_id: skillId } },
      select: { skill_id: true },
    })
    return row != null
  }

  const userId = principal.user_id
  if (!userId) return false

  const authorUser = await prisma.users.findUnique({
    where: { id: userId },
    select: { handle: true },
  })
  if (authorUser?.handle) {
    const owned = await prisma.skills.findFirst({
      where: { id: skillId, author_id: authorUser.handle },
      select: { id: true },
    })
    if (owned) return true
  }

  const kitGrant = await prisma.kit_skills.findFirst({
    where: {
      skill_id: skillId,
      kits: {
        OR: [
          ...(authorUser?.handle ? [{ owner_id: authorUser.handle }] : []),
          // accepted_at guard (#472): a read-grant needs an ACCEPTED membership.
          // kit_members.accepted_at is nullable and every other consumer filters
          // it; without this, any future path inserting a null-accepted row
          // would silently grant read. Live writes all set accepted_at today, so
          // this is defense-in-depth against that regression.
          { kit_members: { some: { user_id: userId, accepted_at: { not: null } } } },
        ],
      },
    },
    select: { skill_id: true },
  })
  if (kitGrant) return true

  const skill = await prisma.skills.findUnique({
    where: { id: skillId },
    select: { author_id: true },
  })
  if (skill && (await canAccessOrgAuthorPrisma(prisma, skill.author_id, userId))) {
    return true
  }

  // No subscription grant. A kit subscription only ever legitimately conveys
  // PUBLIC skills, and those already returned true at the top of this function.
  // Reaching here means the skill is private, so a subscription must NOT grant
  // read: otherwise privatizing a skill (or a kit) still leaks it to prior
  // public-kit subscribers and every future private version (#461). Private-kit
  // access is granted through the kit_members / org branches above. This matches
  // sync-manifest.ts, which already excludes subscription-sourced private skills
  // from the sync manifest.
  return false
}
