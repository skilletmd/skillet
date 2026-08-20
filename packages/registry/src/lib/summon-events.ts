import type { PrismaDb } from '../db/prisma-client.js'

const SLUG_RE = /^[a-z0-9][a-z0-9._/-]{0,200}$/i

/**
 * Record a summon (plan 012 U6). Aggregate-by-construction: bumps a
 * per-(skill, curating handle, day) tally. NO PII, no per-summoner row, no
 * `client_id`, no IP — there is nothing per-user to leak or de-anonymize.
 *
 * Call this fire-and-forget from the request path (`void emit(...).catch(...)`)
 * so a sink hiccup can never slow or fail the summon response.
 */
export async function emitSummonEvent(opts: {
  prisma: PrismaDb
  /** `author:slug` of the skill that was selected/applied. */
  skillId: string
  /** The handle the skill was summoned via (curator for saved picks); '' if absent. */
  viaHandle: string
}): Promise<void> {
  const bare = opts.viaHandle.replace(/^@/, '')
  const via = SLUG_RE.test(bare) ? bare : ''
  const day = Math.floor(Date.now() / 86_400_000) // unix day number
  await opts.prisma.skill_summon_counts.upsert({
    where: { skill_id_via_handle_day: { skill_id: opts.skillId, via_handle: via, day } },
    create: { skill_id: opts.skillId, via_handle: via, day, count: 1 },
    update: { count: { increment: 1 } },
  })
  // PostHog (deferred): when POSTHOG_KEY is configured, ALSO capture a
  // `skill.summoned` event here with { skill_ref, via_handle, runtime, authed }
  // for the internal metrics pipeline (reach/growth/funnels/uniques). The
  // aggregate above is the no-vendor fallback that powers the public number.
}

/** Per-skill "summoned N times" (public reach), SUMmed across handles + days. */
export async function summonCountsBySkillPrisma(
  prisma: PrismaDb,
  skillIds: string[],
): Promise<Map<string, number>> {
  if (skillIds.length === 0) return new Map()
  const rows = await prisma.skill_summon_counts.groupBy({
    by: ['skill_id'],
    where: { skill_id: { in: skillIds } },
    _sum: { count: true },
  })
  return new Map(rows.map((r) => [r.skill_id, r._sum.count ?? 0]))
}

/** Per-handle reach: total summons that went through @handle's kit (authored + curated). */
export async function handleReachPrisma(prisma: PrismaDb, handle: string): Promise<number> {
  const r = await prisma.skill_summon_counts.aggregate({
    where: { via_handle: handle },
    _sum: { count: true },
  })
  return r._sum.count ?? 0
}
