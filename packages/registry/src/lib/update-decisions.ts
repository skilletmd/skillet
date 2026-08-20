// Update-decision writes and version resolution for the MySQL/Prisma path (U4).
import type { SkillId } from '@skillet/protocol/skill-id'
import { newId } from '../db/index.js'
import type { PrismaClient } from '@prisma/client'
import type { PrismaDb } from '../db/prisma-client.js'
import { runPrismaTransaction } from '../db/prisma-client.js'
import { pendingTargetsPrisma } from './pending-update-targets.js'
import { formatVersionLabel } from '../semver-classify.js'

export type DecisionSource = 'cli' | 'web' | 'desktop' | 'auto'

export async function upsertDecisionPrisma(
  prisma: PrismaDb,
  userId: string,
  skillId: SkillId,
  versionHash: string,
  state: 'approved' | 'rejected',
  source: DecisionSource,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  await prisma.update_decisions.upsert({
    where: {
      user_id_skill_id_version_hash: {
        user_id: userId,
        skill_id: skillId,
        version_hash: versionHash,
      },
    },
    create: {
      id: newId(),
      user_id: userId,
      skill_id: skillId,
      version_hash: versionHash,
      state,
      source,
      decided_at: now,
    },
    update: {
      state,
      source,
      decided_at: now,
    },
  })
}

export async function bumpUserAttentionPrisma(
  prisma: PrismaDb,
  userId: string,
): Promise<void> {
  if (!userId) return
  await prisma.users.update({
    where: { id: userId },
    data: { attention_seq: { increment: 1 } },
  })
}

export async function resolveVersionHashPrisma(
  prisma: PrismaDb,
  skillId: SkillId,
  versionHash: string,
): Promise<string | null> {
  const row = await prisma.skill_versions.findFirst({
    where: {
      skill_id: skillId,
      OR: [{ hash: versionHash }, { hash: `sha256:${versionHash}` }],
    },
    select: { hash: true },
  })
  return row?.hash ?? null
}

export async function accountUpdateModePrisma(
  prisma: PrismaDb,
  userId: string,
): Promise<'auto' | 'manual'> {
  const row = await prisma.users.findUnique({
    where: { id: userId },
    select: { update_mode: true },
  })
  return row?.update_mode === 'auto' ? 'auto' : 'manual'
}

export async function listDecisionsPrisma(prisma: PrismaDb, userId: string) {
  return prisma.update_decisions.findMany({
    where: { user_id: userId },
    orderBy: { decided_at: 'desc' },
    select: {
      skill_id: true,
      version_hash: true,
      state: true,
      source: true,
      decided_at: true,
    },
  })
}

export async function versionLabelOfPrisma(
  prisma: PrismaDb,
  skillId: SkillId,
  hash: string,
): Promise<string | null> {
  const row = await prisma.skill_versions.findFirst({
    where: {
      skill_id: skillId,
      OR: [{ hash }, { hash: `sha256:${hash}` }],
    },
    select: { major: true, minor: true, patch: true },
  })
  return row ? formatVersionLabel(row) : null
}

/**
 * Semver label of the version immediately BEFORE `hash` (same `(published_at,
 * hash)` ordering as {@link versionOrdinalPrisma}), or null if `hash` is the
 * first version. Powers the from-side of the Updates "vX → vY" range so both
 * sides read as semver instead of mixing a bare ordinal with a label.
 */
export async function priorVersionLabelPrisma(
  prisma: PrismaDb,
  skillId: SkillId,
  hash: string,
): Promise<string | null> {
  const target = await prisma.skill_versions.findFirst({
    where: { skill_id: skillId, OR: [{ hash }, { hash: `sha256:${hash}` }] },
    select: { published_at: true, hash: true },
  })
  if (!target) return null
  const prior = await prisma.skill_versions.findFirst({
    where: {
      skill_id: skillId,
      OR: [
        { published_at: { lt: target.published_at } },
        { published_at: target.published_at, hash: { lt: target.hash } },
      ],
    },
    orderBy: [{ published_at: 'desc' }, { hash: 'desc' }],
    select: { major: true, minor: true, patch: true },
  })
  return prior ? formatVersionLabel(prior) : null
}

/** Decide all pending targets atomically. */
export async function decideAllPendingPrisma(
  prisma: PrismaClient,
  userId: string,
  state: 'approved' | 'rejected',
  source: DecisionSource,
): Promise<number> {
  const targets = await pendingTargetsPrisma(prisma, userId)
  await runPrismaTransaction(prisma, async (tx) => {
    for (const t of targets) {
      await upsertDecisionPrisma(tx, userId, t.skill_id, t.to_hash, state, source)
    }
  })
  if (targets.length > 0) await bumpUserAttentionPrisma(prisma, userId)
  return targets.length
}
