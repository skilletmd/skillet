// One machine converges to one device row (design R8: one row per machine, one
// shared credential). When a pairing or migration collapses a machine's rows,
// the survivor must inherit the losers' per-device state instead of dropping it
// so skill edits and materializations recorded under one row vanish when it is
// deleted. `mergeDeviceIntoPrisma` is the single source of that carry so the
// pair-claim sweep (claimPairCodePrisma) and characterization cannot drift apart.

import type { Prisma } from '@prisma/client'
import type { PrismaDb } from '../db/prisma-client.js'

type TxClient = Prisma.TransactionClient

function parseKinds(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string' && x.length > 0)
      : []
  } catch {
    return []
  }
}

/** Fold `loserId` into `winnerId` within the CALLER's transaction, then delete the loser. */
export async function mergeDeviceIntoPrisma(
  tx: PrismaDb | TxClient,
  winnerId: string,
  loserId: string,
  now: number,
): Promise<void> {
  const loserMats = await tx.device_skill_materializations.findMany({
    where: { device_id: loserId },
  })
  for (const mat of loserMats) {
    const existing = await tx.device_skill_materializations.findUnique({
      where: {
        device_id_skill_slug_runtime: {
          device_id: winnerId,
          skill_slug: mat.skill_slug,
          runtime: mat.runtime,
        },
      },
    })
    if (!existing) {
      await tx.device_skill_materializations.create({
        data: {
          device_id: winnerId,
          skill_slug: mat.skill_slug,
          runtime: mat.runtime,
          status: mat.status,
          reported_at: mat.reported_at,
        },
      })
    } else if (mat.reported_at > existing.reported_at) {
      await tx.device_skill_materializations.update({
        where: {
          device_id_skill_slug_runtime: {
            device_id: winnerId,
            skill_slug: mat.skill_slug,
            runtime: mat.runtime,
          },
        },
        data: { status: mat.status, reported_at: mat.reported_at },
      })
    }
  }
  await tx.device_skill_materializations.deleteMany({ where: { device_id: loserId } })

  const loserEdits = await tx.device_skill_edits.findMany({ where: { device_id: loserId } })
  for (const edit of loserEdits) {
    const conflict = await tx.device_skill_edits.findFirst({
      where: { device_id: winnerId, skill_id: edit.skill_id },
      select: { device_id: true },
    })
    if (conflict) continue
    await tx.device_skill_edits.update({
      where: {
        device_id_skill_id: { device_id: loserId, skill_id: edit.skill_id },
      },
      data: { device_id: winnerId },
    })
  }

  const loser = await tx.devices.findUnique({
    where: { id: loserId },
    select: { client_kinds: true },
  })
  if (loser) {
    const winner = await tx.devices.findUnique({
      where: { id: winnerId },
      select: { client_kinds: true },
    })
    const merged = [
      ...new Set([...parseKinds(winner?.client_kinds ?? null), ...parseKinds(loser.client_kinds)]),
    ]
    await tx.devices.update({
      where: { id: winnerId },
      data: { client_kinds: JSON.stringify(merged) },
    })
  }

  await tx.sessions.updateMany({
    where: { device_id: loserId, revoked_at: null },
    data: { revoked_at: now },
  })
  await tx.devices.delete({ where: { id: loserId } })
}
