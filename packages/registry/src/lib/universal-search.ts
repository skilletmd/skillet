// Universal search candidates for the MySQL/Prisma path (U4).
//
// Every group runs the same two-pass candidacy: ask SQL for rows matching all
// of the query's words, and only when that yields nothing fall back to rows
// matching any of them. Normalization, tokenization, and scoring live in
// search-match.ts, where they are pure and hermetically tested.
import type { Principal } from '../auth/middleware.js'
import { canReadSkillPrisma } from '../auth/skill-read-access.js'
import type { PrismaDb } from '../db/prisma-client.js'
import { getOrgBySlugPrisma, isOrgMemberPrisma } from './org-access.js'
import { buildMatcher, matchScore, tokenClauses, type QueryMatcher } from './search-match.js'
import { suspendedAuthorHandlesPrisma } from './suspension.js'

const CANDIDATE_CAP = 200

// 'route-skill' = the /skillet router's kit search; 'summon-fallback' = the
// router's cross-author search when a summoned handle has no fitting skill.
const KNOWN_SEARCH_SOURCES = new Set<string>(['route-skill', 'summon-fallback'])

interface Scored {
  score: number
  tiebreak: number
  item: Record<string, unknown>
}

/**
 * Run `score` over the every-token candidacy pass, then over the any-token pass
 * when the first found nothing a caller may actually see.
 *
 * The fallback triggers on empty rather than underfull: padding a good exact
 * match with weaker any-word results would bury it on every multi-word query.
 * The trigger is *surviving* results, so a pass whose only row fails an access
 * check still falls through rather than answering empty.
 */
async function twoPassCandidates<C extends string>(
  matcher: QueryMatcher,
  columns: readonly C[],
  score: (where: Record<string, unknown>) => Promise<Scored[]>,
): Promise<Scored[]> {
  const clauses = tokenClauses(matcher, columns)
  if (clauses.length === 0) return []

  const everyToken = await score({ AND: clauses })
  if (everyToken.length > 0 || clauses.length === 1) return everyToken

  return score({ OR: clauses.flatMap((clause) => clause.OR) })
}

function rankAndSlice(scored: Scored[], limit: number): Record<string, unknown>[] {
  scored.sort((a, b) => b.score - a.score || b.tiebreak - a.tiebreak)
  return scored.slice(0, limit).map((s) => ({ ...s.item, score: s.score }))
}

/** Best-effort known-client search attribution (UTC calendar day). */
export async function recordSearchSourcePrisma(
  prisma: PrismaDb,
  rawMarker: unknown,
): Promise<void> {
  if (typeof rawMarker !== 'string' || !KNOWN_SEARCH_SOURCES.has(rawMarker)) return
  try {
    const day = new Date().toISOString().slice(0, 10)
    await prisma.search_source_counts.upsert({
      where: { day_source: { day, source: rawMarker } },
      create: { day, source: rawMarker, count: 1 },
      update: { count: { increment: 1 } },
    })
  } catch {
    // Counting is best-effort.
  }
}

async function canReadKitPrisma(
  prisma: PrismaDb,
  kitRow: { id: string; owner_id: string; visibility: string },
  principal: Principal | null | undefined,
): Promise<boolean> {
  if (kitRow.visibility === 'public') return true
  if (!principal) return false
  if (principal.class === 'kit') return principal.kit_id === kitRow.id

  const userId = principal.user_id
  if (!userId) return false

  const org = await getOrgBySlugPrisma(prisma, kitRow.owner_id)
  if (principal.class === 'session') {
    if (org) {
      if (await isOrgMemberPrisma(prisma, org.id, userId, org.owner_user_id)) return true
    } else if (principal.handle && kitRow.owner_id === principal.handle) {
      return true
    }
    const member = await prisma.kit_members.findUnique({
      where: { kit_id_user_id: { kit_id: kitRow.id, user_id: userId } },
      select: { user_id: true },
    })
    if (member) return true
    const sub = await prisma.kit_subscriptions.findFirst({
      where: { user_id: userId, kind: 'kit', kit_id: kitRow.id },
      select: { id: true },
    })
    return sub != null
  }

  if (principal.class === 'device' && principal.user_id) {
    if (org) {
      if (await isOrgMemberPrisma(prisma, org.id, userId, org.owner_user_id)) return true
    } else {
      const u = await prisma.users.findUnique({
        where: { id: userId },
        select: { handle: true },
      })
      if (u?.handle && kitRow.owner_id === u.handle) return true
    }
    const member = await prisma.kit_members.findUnique({
      where: { kit_id_user_id: { kit_id: kitRow.id, user_id: userId } },
      select: { user_id: true },
    })
    return member != null
  }
  return false
}

const SKILL_COLUMNS = ['slug', 'description', 'author_id'] as const

export async function searchSkillsPrisma(
  prisma: PrismaDb,
  q: string,
  principal: Principal | null | undefined,
  limit: number,
): Promise<Record<string, unknown>[]> {
  const matcher = buildMatcher(q)
  const suspended = new Set(await suspendedAuthorHandlesPrisma(prisma))

  const scorePass = async (where: Record<string, unknown>): Promise<Scored[]> => {
    const rows = await prisma.skills.findMany({
      where: {
        latest_hash: { not: null },
        deprecated_at: null,
        moderation_status: 'none',
        ...where,
      },
      orderBy: [{ install_count: 'desc' }, { created_at: 'desc' }],
      take: CANDIDATE_CAP,
      select: {
        id: true,
        author_id: true,
        slug: true,
        description: true,
        install_count: true,
        visibility: true,
        category: true,
      },
    })

    const scored: Scored[] = []
    for (const row of rows) {
      if (suspended.has(row.author_id)) continue
      if (!(await canReadSkillPrisma(prisma, principal, row.id, row.visibility))) continue
      const score = matchScore(matcher, [row.slug, row.author_id], [row.description])
      if (score === null) continue
      scored.push({
        score,
        tiebreak: row.install_count,
        item: {
          type: 'skill',
          skill_id: row.id,
          author: row.author_id,
          slug: row.slug,
          description: row.description,
          install_count: row.install_count,
          visibility: row.visibility,
          category: row.category ?? null,
          url: `/${row.author_id}/${row.slug}`,
        },
      })
    }
    return scored
  }

  return rankAndSlice(await twoPassCandidates(matcher, SKILL_COLUMNS, scorePass), limit)
}

const KIT_COLUMNS = ['name', 'description'] as const

export async function searchKitsPrisma(
  prisma: PrismaDb,
  q: string,
  principal: Principal | null | undefined,
  limit: number,
): Promise<Record<string, unknown>[]> {
  const matcher = buildMatcher(q)
  const suspended = new Set(await suspendedAuthorHandlesPrisma(prisma))

  const scorePass = async (where: Record<string, unknown>): Promise<Scored[]> => {
    const rows = await prisma.kits.findMany({
      where: { moderation_status: 'none', ...where },
      orderBy: { created_at: 'desc' },
      take: CANDIDATE_CAP,
      select: {
        id: true,
        owner_id: true,
        name: true,
        description: true,
        visibility: true,
        created_at: true,
        _count: { select: { kit_members: true } },
      },
    })

    const scored: Scored[] = []
    for (const row of rows) {
      if (suspended.has(row.owner_id)) continue
      if (!(await canReadKitPrisma(prisma, row, principal))) continue
      const score = matchScore(matcher, [row.name], [row.description])
      if (score === null) continue
      scored.push({
        score,
        tiebreak: row._count.kit_members,
        item: {
          type: 'kit',
          kit_id: row.id,
          owner: row.owner_id,
          name: row.name,
          description: row.description,
          visibility: row.visibility === 'private' ? 'private' : 'public',
          url: `/kits/${row.id}`,
        },
      })
    }
    return scored
  }

  const items = rankAndSlice(await twoPassCandidates(matcher, KIT_COLUMNS, scorePass), limit)
  for (const item of items) {
    const cats = await prisma.kit_skills.findMany({
      where: { kit_id: item.kit_id as string },
      orderBy: { added_at: 'asc' },
      select: { skills: { select: { category: true, visibility: true } } },
    })
    // Only public members contribute a visible category (a now-private member
    // must not leak its category here, #461).
    item.skill_categories = cats
      .filter((c) => c.skills.visibility === 'public')
      .map((c) => c.skills.category ?? null)
  }
  return items
}

const AUTHOR_COLUMNS = ['id', 'name', 'bio'] as const

export async function searchAuthorsPrisma(
  prisma: PrismaDb,
  q: string,
  limit: number,
): Promise<Record<string, unknown>[]> {
  const matcher = buildMatcher(q)
  const orgSlugs = (
    await prisma.organizations.findMany({ select: { slug: true } })
  ).map((o) => o.slug)
  const suspended = await suspendedAuthorHandlesPrisma(prisma)
  const exclude = [...new Set([...orgSlugs, ...suspended])]

  const scorePass = async (where: Record<string, unknown>): Promise<Scored[]> => {
    const rows = await prisma.authors.findMany({
      where: {
        ...(exclude.length > 0 ? { id: { notIn: exclude } } : {}),
        ...where,
      },
      orderBy: { created_at: 'desc' },
      take: CANDIDATE_CAP,
      select: {
        id: true,
        name: true,
        avatar_url: true,
        bio: true,
        created_at: true,
      },
    })

    const scored: Scored[] = []
    for (const row of rows) {
      const score = matchScore(matcher, [row.id, row.name], [row.bio])
      if (score === null) continue
      scored.push({
        score,
        tiebreak: row.created_at,
        item: {
          type: 'author',
          username: row.id,
          name: row.name,
          avatar_url: row.avatar_url,
          url: `/${row.id}`,
        },
      })
    }
    return scored
  }

  return rankAndSlice(await twoPassCandidates(matcher, AUTHOR_COLUMNS, scorePass), limit)
}

const TEAM_COLUMNS = ['slug', 'name'] as const

export async function searchTeamsPrisma(
  prisma: PrismaDb,
  q: string,
  limit: number,
): Promise<Record<string, unknown>[]> {
  const matcher = buildMatcher(q)

  const scorePass = async (where: Record<string, unknown>): Promise<Scored[]> => {
    const rows = await prisma.organizations.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: CANDIDATE_CAP,
      select: { slug: true, name: true, created_at: true },
    })

    const scored: Scored[] = []
    for (const row of rows) {
      const score = matchScore(matcher, [row.slug, row.name], [])
      if (score === null) continue
      scored.push({
        score,
        tiebreak: row.created_at,
        item: {
          type: 'team',
          slug: row.slug,
          name: row.name,
          url: `/orgs/${row.slug}`,
        },
      })
    }
    return scored
  }

  return rankAndSlice(await twoPassCandidates(matcher, TEAM_COLUMNS, scorePass), limit)
}
