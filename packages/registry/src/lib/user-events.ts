// Activity-stream helpers for the MySQL/Prisma path (U4).
import type { PrismaClient } from '@prisma/client'
import { newId } from '../db/index.js'
import { runPrismaTransaction, type PrismaDb } from '../db/prisma-client.js'

export const MAX_EVENTS_PER_USER = 10000

/** True when the user has opted out of activity recording (private mode). */
export async function isActivityPrivatePrisma(
  prisma: PrismaDb,
  userId: string,
): Promise<boolean> {
  const row = await prisma.users.findUnique({
    where: { id: userId },
    select: { activity_private: true },
  })
  return row?.activity_private === 1
}

/**
 * Per-user ring buffer: keep only the most recent MAX_EVENTS_PER_USER rows.
 * We order by ts then id (MySQL has no rowid).
 */
export async function pruneUserEventsPrisma(prisma: PrismaDb, userId: string): Promise<void> {
  const keep = await prisma.events.findMany({
    where: { user_id: userId },
    orderBy: [{ ts: 'desc' }, { id: 'desc' }],
    take: MAX_EVENTS_PER_USER,
    select: { id: true },
  })
  if (keep.length < MAX_EVENTS_PER_USER) return
  await prisma.events.deleteMany({
    where: {
      user_id: userId,
      id: { notIn: keep.map((k) => k.id) },
    },
  })
}

export interface IngestEventRow {
  name: string
  initiator: string
  meta: Record<string, string | number | boolean> | null
  ts: number | null
}

export async function insertEventBatchPrisma(
  prisma: PrismaClient,
  userId: string,
  deviceId: string | null,
  rows: IngestEventRow[],
): Promise<void> {
  if (rows.length === 0) return
  const now = Math.floor(Date.now() / 1000)
  await runPrismaTransaction(prisma, async (tx) => {
    for (const r of rows) {
      await tx.events.create({
        data: {
          id: newId(),
          name: r.name,
          initiator: r.initiator,
          user_id: userId,
          device_id: deviceId,
          meta: r.meta ? JSON.stringify(r.meta) : null,
          ts: r.ts ?? now,
        },
      })
    }
    await pruneUserEventsPrisma(tx, userId)
  })
}

export async function listUserEventsPrisma(
  prisma: PrismaDb,
  userId: string,
  limit = 100,
): Promise<
  Array<{
    id: string
    name: string
    initiator: string
    device_id: string | null
    meta: string | null
    ts: number
  }>
> {
  return prisma.events.findMany({
    where: { user_id: userId },
    orderBy: { ts: 'desc' },
    take: limit,
    select: {
      id: true,
      name: true,
      initiator: true,
      device_id: true,
      meta: true,
      ts: true,
    },
  })
}

export async function clearUserEventsPrisma(
  prisma: PrismaDb,
  userId: string,
): Promise<number> {
  const result = await prisma.events.deleteMany({ where: { user_id: userId } })
  return result.count
}

export async function setActivityPrivatePrisma(
  prisma: PrismaDb,
  userId: string,
  priv: boolean,
): Promise<void> {
  await prisma.users.update({
    where: { id: userId },
    data: { activity_private: priv ? 1 : 0 },
  })
}

export async function listRouteUsageEventsPrisma(
  prisma: PrismaDb,
  userId: string,
): Promise<Array<{ name: string; meta: string | null; ts: number }>> {
  return prisma.events.findMany({
    where: {
      user_id: userId,
      name: { in: ['skill.route', 'skill.route.invoke'] },
    },
    select: { name: true, meta: true, ts: true },
  })
}

/** Resolve skill categories for `@author/slug` refs used in route-usage tallies. */
export async function categoriesForSkillRefsPrisma(
  prisma: PrismaDb,
  refs: string[],
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>()
  if (refs.length === 0) return out

  const pairs: Array<{ author_id: string; slug: string; ref: string }> = []
  for (const ref of refs) {
    const m = /^@?([^/]+)\/(.+)$/.exec(ref)
    if (!m?.[1] || !m[2]) continue
    pairs.push({ author_id: m[1], slug: m[2], ref: ref.startsWith('@') ? ref : `@${ref}` })
  }
  if (pairs.length === 0) return out

  const rows = await prisma.skills.findMany({
    where: {
      OR: pairs.map((p) => ({ author_id: p.author_id, slug: p.slug })),
    },
    select: { author_id: true, slug: true, category: true },
  })
  for (const r of rows) {
    out.set(`@${r.author_id}/${r.slug}`, r.category)
  }
  return out
}
