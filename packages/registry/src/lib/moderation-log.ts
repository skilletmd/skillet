// Public moderation log reads for the MySQL/Prisma path (U4).
import type { PrismaDb } from '../db/prisma-client.js'

export interface ModerationLogEntry {
  author: string
  slug: string
  status: string
  public_reason: string | null
  acted_at: number | null
}

/**
 * Count of PUBLIC skills currently under non-none moderation enforcement.
 * The moderation log is a public transparency surface (#466): a private skill's
 * moderation status is not public business, so private rows are excluded from
 * both the count and the listing below.
 */
export async function countActiveModerationPrisma(prisma: PrismaDb): Promise<number> {
  return prisma.skills.count({
    where: { moderation_status: { not: 'none' }, visibility: 'public' },
  })
}

/**
 * Page of currently-enforced skills with the latest quarantine/unlist public
 * reason and most-recent action timestamp (matches GET /moderation).
 */
export async function listActiveModerationPrisma(
  prisma: PrismaDb,
  opts: { limit: number; offset: number },
): Promise<ModerationLogEntry[]> {
  const skills = await prisma.skills.findMany({
    where: { moderation_status: { not: 'none' }, visibility: 'public' },
    select: {
      id: true,
      author_id: true,
      slug: true,
      moderation_status: true,
    },
  })
  if (skills.length === 0) return []

  const skillIds = skills.map((s) => s.id)
  const actions = await prisma.skill_moderation_actions.findMany({
    where: { skill_id: { in: skillIds } },
    select: {
      skill_id: true,
      action: true,
      public_reason: true,
      created_at: true,
    },
    orderBy: { created_at: 'desc' },
  })

  const latestAnyAt = new Map<string, number>()
  const latestEnforceReason = new Map<string, string | null>()
  for (const a of actions) {
    if (!latestAnyAt.has(a.skill_id)) {
      latestAnyAt.set(a.skill_id, a.created_at)
    }
    if (
      (a.action === 'quarantine' || a.action === 'unlist') &&
      !latestEnforceReason.has(a.skill_id)
    ) {
      latestEnforceReason.set(a.skill_id, a.public_reason)
    }
  }

  const entries: ModerationLogEntry[] = skills.map((s) => ({
    author: s.author_id,
    slug: s.slug,
    status: s.moderation_status,
    public_reason: latestEnforceReason.get(s.id) ?? null,
    acted_at: latestAnyAt.get(s.id) ?? null,
  }))

  entries.sort((a, b) => {
    const at = b.acted_at ?? 0
    const bt = a.acted_at ?? 0
    if (at !== bt) return at - bt
    return a.slug.localeCompare(b.slug)
  })

  return entries.slice(opts.offset, opts.offset + opts.limit)
}
