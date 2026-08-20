import { createHash } from 'node:crypto'
import type { DatabaseSync } from '../db/sqlite-handle.js'
import type { Principal } from '../auth/middleware.js'
import type { PrismaClient } from '@prisma/client'
import type { PrismaDb } from '../db/prisma-client.js'
import { bumpAttentionForHandlePrisma } from '../lib/attention.js'
import { followSubjectPrisma } from '../lib/follow-graph.js'

export type SkillInstallInstallerKind = 'user' | 'device' | 'kit_key' | 'anonymous'

export interface SkillInstallAttestation {
  installer_kind: SkillInstallInstallerKind
  installer_id: string
}

const SQLITE_REMOVED = 'sqlite registry store removed; use the *Prisma counterpart'

/** Map a resolved bearer principal to a stable dedupe key for install counting. */
export function installerAttestation(principal: Principal): SkillInstallAttestation {
  if (principal.class === 'session') {
    return { installer_kind: 'user', installer_id: principal.user_id }
  }
  if (principal.class === 'device') {
    return { installer_kind: 'device', installer_id: principal.device_id }
  }
  if (principal.class === 'kit') {
    return { installer_kind: 'kit_key', installer_id: principal.kit_key_id }
  }
  // mcp: the link is personal, so dedupe installs against the owning user.
  return { installer_kind: 'user', installer_id: principal.user_id }
}

/** One anonymous install metric per client IP per skill per UTC day. */
function anonymousInstallerId(clientIp: string, skillId: string): string {
  const day = Math.floor(Date.now() / 1000 / 86_400)
  return createHash('sha256')
    .update(`${clientIp}\0${skillId}\0${day}`)
    .digest('hex')
    .slice(0, 32)
}

/**
 * Fail-closed stand-in for residual dual-path callers outside U4 (skills.ts).
 * Characterization uses tests/legacy-sqlite-skill-install.ts.
 * MySQL uses {@link recordSkillInstallPrisma}.
 */
export function recordSkillInstall(
  _db: DatabaseSync,
  _skillId: string,
  _principal: Principal | undefined,
  _clientIp = 'unknown',
): { recorded: boolean } {
  throw new Error(`${SQLITE_REMOVED}: recordSkillInstallPrisma`)
}

/** Prisma async counterpart of {@link recordSkillInstall}. */
export async function recordSkillInstallPrisma(
  prisma: PrismaDb,
  skillId: string,
  principal: Principal | undefined,
  clientIp = 'unknown',
): Promise<{ recorded: boolean }> {
  const { installer_kind, installer_id } = principal
    ? installerAttestation(principal)
    : {
        installer_kind: 'anonymous' as const,
        installer_id: anonymousInstallerId(clientIp, skillId),
      }
  const now = Math.floor(Date.now() / 1000)
  try {
    await prisma.skill_installers.create({
      data: {
        skill_id: skillId,
        installer_kind,
        installer_id,
        installed_at: now,
      },
    })
  } catch (err: unknown) {
    // Unique PK (skill_id, installer_kind, installer_id) → already recorded.
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === 'P2002'
    ) {
      return { recorded: false }
    }
    throw err
  }
  await prisma.skills.update({
    where: { id: skillId },
    data: { install_count: { increment: 1 } },
  })
  if (installer_kind === 'user') {
    const skill = await prisma.skills.findUnique({
      where: { id: skillId },
      select: { author_id: true },
    })
    const actor = await prisma.users.findUnique({
      where: { id: installer_id },
      select: { handle: true },
    })
    if (skill && actor?.handle) {
      await bumpAttentionForHandlePrisma(prisma, skill.author_id)
    }
  }
  return { recorded: true }
}

/**
 * Fail-closed stand-in for residual dual-path callers outside U4 (skills.ts).
 * MySQL uses {@link autoFollowAuthorOnInstallPrisma}.
 */
export function autoFollowAuthorOnInstall(
  _db: DatabaseSync,
  _principal: Principal | undefined,
  _authorHandle: string,
): { followed: boolean } {
  throw new Error(`${SQLITE_REMOVED}: autoFollowAuthorOnInstallPrisma`)
}

/** Prisma async counterpart of {@link autoFollowAuthorOnInstall}. */
export async function autoFollowAuthorOnInstallPrisma(
  prisma: PrismaClient,
  principal: Principal | undefined,
  authorHandle: string,
): Promise<{ followed: boolean }> {
  const userId =
    principal?.class === 'session'
      ? principal.user_id
      : principal?.class === 'device'
        ? principal.user_id
        : null
  if (!userId) return { followed: false }

  const self = await prisma.users.findFirst({
    where: { id: userId, handle: authorHandle },
    select: { id: true },
  })
  if (self) return { followed: false }

  const author = await prisma.authors.findUnique({
    where: { id: authorHandle },
    select: { id: true },
  })
  if (!author) return { followed: false }

  try {
    const followed = await followSubjectPrisma(prisma, userId, 'author', authorHandle)
    return { followed }
  } catch {
    return { followed: false }
  }
}
