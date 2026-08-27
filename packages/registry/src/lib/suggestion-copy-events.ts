import type { PrismaDb } from '../db/prisma-client.js'

const HANDLE_RE = /^[a-z0-9][a-z0-9._-]{0,64}$/i
const SKILL_ID_RE = /^[a-z0-9][a-z0-9._-]{0,64}:[a-z0-9][a-z0-9._/-]{0,200}$/i

/**
 * Record a copy of a suggested invocation (plan 004 U2).
 *
 * Aggregate-by-construction, matching `emitSummonEvent`: bumps a per-(author,
 * skill, day) tally with no per-visitor row, no client id, and no IP. The
 * visitor being counted is the logged-out stranger who followed a shared
 * profile link, so there is deliberately nothing here to identify.
 *
 * Call fire-and-forget from the request path so a sink hiccup can never slow or
 * fail the response — and, more importantly, never make a copy look like it
 * failed when the text is already on the clipboard.
 *
 * This is a reading in its own right, not the head of a funnel. Once the line
 * is copied it leaves the site, and a pasted line is indistinguishable from a
 * typed one, so nothing joins this to the summon it may eventually produce.
 */
export async function emitSuggestionCopyEvent(opts: {
  prisma: PrismaDb
  /** The profile the line was copied from. */
  authorId: string
  /** `author:slug` of the skill the line was derived from. */
  skillId: string
}): Promise<void> {
  const day = Math.floor(Date.now() / 86_400_000) // unix day number
  await opts.prisma.suggestion_copy_counts.upsert({
    where: {
      author_id_skill_id_day: { author_id: opts.authorId, skill_id: opts.skillId, day },
    },
    create: { author_id: opts.authorId, skill_id: opts.skillId, day, count: 1 },
    update: { count: { increment: 1 } },
  })
}

/**
 * Whether a copy report is well-formed enough to store.
 *
 * The endpoint is anonymous and unauthenticated, so the only defence against
 * junk rows is the shape of what it accepts. A malformed report is dropped
 * rather than stored under a coerced key, because a bad row here is
 * indistinguishable from a real copy once it lands.
 */
export function isRecordableCopy(authorId: unknown, skillId: unknown): boolean {
  if (typeof authorId !== 'string' || typeof skillId !== 'string') return false
  if (!HANDLE_RE.test(authorId) || !SKILL_ID_RE.test(skillId)) return false
  // The skill must belong to the profile it was copied from. Without this an
  // anonymous caller could attribute copies to any author they liked.
  return skillId.slice(0, skillId.indexOf(':')).toLowerCase() === authorId.toLowerCase()
}

/** Copies of this author's suggestions, summed across skills and days. */
export async function copyCountForAuthorPrisma(
  prisma: PrismaDb,
  authorId: string,
): Promise<number> {
  const rows = await prisma.suggestion_copy_counts.aggregate({
    where: { author_id: authorId },
    _sum: { count: true },
  })
  return rows._sum.count ?? 0
}
