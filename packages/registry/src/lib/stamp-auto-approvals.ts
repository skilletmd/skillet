/**
 * Prisma write-path helper for flipping account update mode to auto.
 * Mirrors {@link stampAutoApprovals} in approvals.ts.
 */
import type { SkillId } from '@skillet/protocol/skill-id'
import { newId } from '../db/index.js'
import type { PrismaDb } from '../db/prisma-client.js'
import { pendingTargetsPrisma } from './pending-update-targets.js'

async function upsertDecisionPrisma(
  prisma: PrismaDb,
  userId: string,
  skillId: SkillId,
  versionHash: string,
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
      state: 'approved',
      source: 'auto',
      decided_at: now,
    },
    update: {
      state: 'approved',
      source: 'auto',
      decided_at: now,
    },
  })
}

/** Bump attention_seq on the Prisma path; SSE fan-out stays sqlite until U6. */
async function bumpUserAttentionPrisma(prisma: PrismaDb, userId: string): Promise<void> {
  if (!userId) return
  await prisma.users.update({
    where: { id: userId },
    data: { attention_seq: { increment: 1 } },
  })
}

/** Stamp every currently-pending target as approved/source:auto. */
export async function stampAutoApprovalsPrisma(
  prisma: PrismaDb,
  userId: string,
): Promise<number> {
  const targets = await pendingTargetsPrisma(prisma, userId)
  for (const t of targets) {
    await upsertDecisionPrisma(prisma, userId, t.skill_id, t.to_hash)
  }
  if (targets.length > 0) await bumpUserAttentionPrisma(prisma, userId)
  return targets.length
}
