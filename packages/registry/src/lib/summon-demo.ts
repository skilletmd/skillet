import type { PrismaDb } from '../db/prisma-client.js'
import { parseSummonSuggestionSet } from '@skillet/protocol'

/** One author the homepage hero can honestly depict. */
export interface SummonDemoPerson {
  handle: string
  name: string
  avatar_url: string | null
  /** The task phrase, from the author's own stored suggestion. */
  task: string
  /** Slug of the skill the phrase was derived from, for the reply link. */
  slug: string
}

/**
 * Authors the homepage hero can depict without making something up.
 *
 * The hero is a scripted agent conversation. Hardcoded, it can claim things an
 * author does not actually do — the current script shows @antfu answering "set
 * up my tooling" while his kit produces no confident line at all. Driving it
 * from stored suggestions makes every depicted claim one the author's published
 * work supports.
 *
 * Eligibility is a filter, not a fallback chain: an author qualifies with a
 * non-empty stored set, an avatar, and a suggestion whose skill is still
 * public. Anything missing excludes them rather than being patched at render
 * time, because per-field fallbacks are how a demo ends up misrepresenting a
 * real person.
 */
export async function summonDemoPeoplePrisma(
  prisma: PrismaDb,
  limit = 5,
): Promise<SummonDemoPerson[]> {
  const authors = await prisma.authors.findMany({
    where: {
      suggestions: { not: null },
      avatar_url: { not: null },
    },
    select: { id: true, name: true, avatar_url: true, suggestions: true },
  })

  const out: SummonDemoPerson[] = []
  for (const author of authors) {
    const set = parseSummonSuggestionSet(author.suggestions)
    const first = set?.suggestions[0]
    if (!first) continue // stored-but-empty: the kit had nothing confident to say

    const slug = first.ref.slice(first.ref.indexOf('/') + 1)
    if (!slug || slug === first.ref) continue

    // The skill behind the line has to still be reachable, or the reply links
    // into a 404 on the most-visited page on the site.
    const skill = await prisma.skills.findFirst({
      where: {
        author_id: author.id,
        slug,
        visibility: 'public',
        moderation_status: { not: 'unlisted' },
      },
      select: { install_count: true },
    })
    if (!skill) continue

    out.push({
      handle: author.id,
      name: author.name,
      avatar_url: author.avatar_url,
      task: first.task,
      slug,
    })
    if (out.length >= limit * 3) break // enough to rank without walking everyone
  }

  // Deterministic order so the hero does not reshuffle between renders.
  return out.sort((a, b) => (a.handle < b.handle ? -1 : 1)).slice(0, limit)
}
