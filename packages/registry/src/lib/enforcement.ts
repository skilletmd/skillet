// Skill-level moderation enforcement.
//
// The single source of truth for enforcement is `skills.moderation_status`
// (`none | unlisted | quarantined`). Admin actions flip that column AND append
// an append-only audit row to `skill_moderation_actions` in one transaction, so
// the flag and its public explanation can never drift apart.
//
// Sqlite dual-path bodies were removed in U5. Residual callers get fail-closed
// stubs; characterization uses tests/legacy-sqlite-enforcement.ts. MySQL uses
// *Prisma.
import type { PrismaClient } from '@prisma/client'
import type { DatabaseSync } from '../db/sqlite-handle.js'
import { randomUUID } from 'node:crypto'
import { runPrismaTransaction } from '../db/prisma-client.js'

export type ModerationStatus = 'none' | 'unlisted' | 'quarantined'
export type ModerationAction = 'quarantine' | 'unquarantine' | 'unlist' | 'relist'

/** Each action's resulting `moderation_status`. Reversals both return to `none`. */
const ACTION_TARGET: Record<ModerationAction, ModerationStatus> = {
  quarantine: 'quarantined',
  unquarantine: 'none',
  unlist: 'unlisted',
  relist: 'none',
}

export interface EnforcementResult {
  skillId: string
  action: ModerationAction
  status: ModerationStatus
  actionId: string
}

const SQLITE_REMOVED = 'sqlite registry store removed; use the *Prisma counterpart'

/**
 * Flip `skills.moderation_status` for `action` and append the matching audit
 * row, atomically. Fail-closed stand-in; characterization uses
 * tests/legacy-sqlite-enforcement.ts.
 */
export function applyModerationAction(
  _db: DatabaseSync,
  _args: {
    skillId: string
    action: ModerationAction
    actedBy: string
    publicReason?: string | null
  },
): EnforcementResult | null {
  throw new Error(`${SQLITE_REMOVED}: applyModerationActionPrisma`)
}

/** Prisma async counterpart of {@link applyModerationAction}. */
export async function applyModerationActionPrisma(
  prisma: PrismaClient,
  args: {
    skillId: string
    action: ModerationAction
    actedBy: string
    publicReason?: string | null
  },
): Promise<EnforcementResult | null> {
  const { skillId, action, actedBy } = args
  const publicReason = args.publicReason ?? null
  const target = ACTION_TARGET[action]

  const skill = await prisma.skills.findUnique({
    where: { id: skillId },
    select: { id: true },
  })
  if (!skill) return null

  const actionId = randomUUID()
  await runPrismaTransaction(prisma, async (tx) => {
    await tx.skills.update({
      where: { id: skillId },
      data: { moderation_status: target },
    })
    await tx.skill_moderation_actions.create({
      data: {
        id: actionId,
        skill_id: skillId,
        action,
        public_reason: publicReason,
        acted_by: actedBy,
      },
    })
  })

  return { skillId, action, status: target, actionId }
}

export function quarantineSkill(
  _db: DatabaseSync,
  _skillId: string,
  _actedBy: string,
  _publicReason?: string | null,
): EnforcementResult | null {
  throw new Error(`${SQLITE_REMOVED}: quarantineSkillPrisma`)
}

export function unquarantineSkill(
  _db: DatabaseSync,
  _skillId: string,
  _actedBy: string,
  _publicReason?: string | null,
): EnforcementResult | null {
  throw new Error(`${SQLITE_REMOVED}: unquarantineSkillPrisma`)
}

export function unlistSkill(
  _db: DatabaseSync,
  _skillId: string,
  _actedBy: string,
  _publicReason?: string | null,
): EnforcementResult | null {
  throw new Error(`${SQLITE_REMOVED}: unlistSkillPrisma`)
}

export function relistSkill(
  _db: DatabaseSync,
  _skillId: string,
  _actedBy: string,
  _publicReason?: string | null,
): EnforcementResult | null {
  throw new Error(`${SQLITE_REMOVED}: relistSkillPrisma`)
}

export async function quarantineSkillPrisma(
  prisma: PrismaClient,
  skillId: string,
  actedBy: string,
  publicReason?: string | null,
): Promise<EnforcementResult | null> {
  return applyModerationActionPrisma(prisma, {
    skillId,
    action: 'quarantine',
    actedBy,
    publicReason,
  })
}

export async function unquarantineSkillPrisma(
  prisma: PrismaClient,
  skillId: string,
  actedBy: string,
  publicReason?: string | null,
): Promise<EnforcementResult | null> {
  return applyModerationActionPrisma(prisma, {
    skillId,
    action: 'unquarantine',
    actedBy,
    publicReason,
  })
}

export async function unlistSkillPrisma(
  prisma: PrismaClient,
  skillId: string,
  actedBy: string,
  publicReason?: string | null,
): Promise<EnforcementResult | null> {
  return applyModerationActionPrisma(prisma, {
    skillId,
    action: 'unlist',
    actedBy,
    publicReason,
  })
}

export async function relistSkillPrisma(
  prisma: PrismaClient,
  skillId: string,
  actedBy: string,
  publicReason?: string | null,
): Promise<EnforcementResult | null> {
  return applyModerationActionPrisma(prisma, {
    skillId,
    action: 'relist',
    actedBy,
    publicReason,
  })
}

// --- Kit hiding ---------------------------------------------------------------

export type KitModerationStatus = 'none' | 'hidden'

/** Fail-closed stand-in; characterization uses tests/legacy-sqlite-enforcement.ts. */
export function hideKit(_db: DatabaseSync, _kitId: string, _actedBy: string): boolean {
  throw new Error(`${SQLITE_REMOVED}: hideKitPrisma`)
}

/** Fail-closed stand-in; characterization uses tests/legacy-sqlite-enforcement.ts. */
export function unhideKit(_db: DatabaseSync, _kitId: string, _actedBy: string): boolean {
  throw new Error(`${SQLITE_REMOVED}: unhideKitPrisma`)
}

/** Prisma async counterpart of {@link hideKit}. */
export async function hideKitPrisma(
  prisma: PrismaClient,
  kitId: string,
  _actedBy: string,
): Promise<boolean> {
  const kit = await prisma.kits.findUnique({ where: { id: kitId }, select: { id: true } })
  if (!kit) return false
  await prisma.kits.update({
    where: { id: kitId },
    data: { moderation_status: 'hidden' },
  })
  return true
}

/** Prisma async counterpart of {@link unhideKit}. */
export async function unhideKitPrisma(
  prisma: PrismaClient,
  kitId: string,
  _actedBy: string,
): Promise<boolean> {
  const kit = await prisma.kits.findUnique({ where: { id: kitId }, select: { id: true } })
  if (!kit) return false
  await prisma.kits.update({
    where: { id: kitId },
    data: { moderation_status: 'none' },
  })
  return true
}

// --- Author suspend / unsuspend (bulk hide) -----------------------------------

/** Fail-closed stand-in; characterization uses tests/legacy-sqlite-enforcement.ts. */
export function suspendAuthor(_db: DatabaseSync, _handle: string, _actedBy: string): boolean {
  throw new Error(`${SQLITE_REMOVED}: suspendAuthorPrisma`)
}

/** Fail-closed stand-in; characterization uses tests/legacy-sqlite-enforcement.ts. */
export function unsuspendAuthor(_db: DatabaseSync, _handle: string, _actedBy: string): boolean {
  throw new Error(`${SQLITE_REMOVED}: unsuspendAuthorPrisma`)
}

/** Prisma async counterpart of {@link suspendAuthor}. */
export async function suspendAuthorPrisma(
  prisma: PrismaClient,
  handle: string,
  _actedBy: string,
): Promise<boolean> {
  const user = await prisma.users.findFirst({
    where: { handle },
    select: { id: true },
  })
  if (!user) return false
  const now = Math.floor(Date.now() / 1000)
  await runPrismaTransaction(prisma, async (tx) => {
    await tx.users.update({
      where: { handle },
      data: { suspended_at: now },
    })
    await tx.skills.updateMany({
      where: { author_id: handle, moderation_status: 'none' },
      data: { moderation_status: 'unlisted' },
    })
    await tx.kits.updateMany({
      where: { owner_id: handle, moderation_status: 'none' },
      data: { moderation_status: 'hidden' },
    })
  })
  return true
}

/** Prisma async counterpart of {@link unsuspendAuthor}. */
export async function unsuspendAuthorPrisma(
  prisma: PrismaClient,
  handle: string,
  _actedBy: string,
): Promise<boolean> {
  const user = await prisma.users.findFirst({
    where: { handle },
    select: { id: true },
  })
  if (!user) return false
  await runPrismaTransaction(prisma, async (tx) => {
    await tx.users.update({
      where: { handle },
      data: { suspended_at: null },
    })
    await tx.skills.updateMany({
      where: { author_id: handle, moderation_status: 'unlisted' },
      data: { moderation_status: 'none' },
    })
    await tx.kits.updateMany({
      where: { owner_id: handle, moderation_status: 'hidden' },
      data: { moderation_status: 'none' },
    })
  })
  return true
}
