// Universal search candidates for the MySQL/Prisma path (U4).
import type { Principal } from '../auth/middleware.js'
import { canReadSkillPrisma } from '../auth/skill-read-access.js'
import type { PrismaDb } from '../db/prisma-client.js'
import { getOrgBySlugPrisma, isOrgMemberPrisma } from './org-access.js'
import { suspendedAuthorHandlesPrisma } from './suspension.js'

const CANDIDATE_CAP = 200
const SCORE_EXACT = 1.0
const SCORE_PREFIX = 0.75
const SCORE_NAME = 0.5
const SCORE_DESC = 0.25

// 'route-skill' = the /skillet router's kit search; 'summon-fallback' = the
// router's cross-author search when a summoned handle has no fitting skill.
const KNOWN_SEARCH_SOURCES = new Set<string>(['route-skill', 'summon-fallback'])

function matchScore(
  q: string,
  primary: (string | null)[],
  secondary: (string | null)[],
): number | null {
  const prim = primary.filter((v): v is string => !!v).map((v) => v.toLowerCase())
  if (prim.some((v) => v === q)) return SCORE_EXACT
  if (prim.some((v) => v.startsWith(q))) return SCORE_PREFIX
  if (prim.some((v) => v.includes(q))) return SCORE_NAME
  const sec = secondary.filter((v): v is string => !!v).map((v) => v.toLowerCase())
  if (sec.some((v) => v.includes(q))) return SCORE_DESC
  return null
}

interface Scored {
  score: number
  tiebreak: number
  item: Record<string, unknown>
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

// Unmet-demand log: which capabilities people summon for. Keywords only — no
// task text, no user/device/IP, ever. Only the router's cross-author fallback
// feeds it, so the tokens reflect a real "who can do X" ask.
const DEMAND_SOURCE = 'summon-fallback'
const MAX_DEMAND_TOKENS = 5
const MAX_DEMAND_TOKEN_LEN = 32

/** Sanitize a raw query into short, safe demand keyword slugs (deduped, capped). */
export function demandTokens(rawQuery: unknown): string[] {
  if (typeof rawQuery !== 'string') return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of rawQuery.toLowerCase().split(/[^a-z0-9-]+/)) {
    const t = raw.replace(/^-+|-+$/g, '')
    if (t.length === 0 || t.length > MAX_DEMAND_TOKEN_LEN || seen.has(t)) continue
    seen.add(t)
    out.push(t)
    if (out.length >= MAX_DEMAND_TOKENS) break
  }
  return out
}

/**
 * Record keywords-only unmet-demand tokens for the summon-fallback source.
 * Aggregate (day, token) counts only; drops every other source and never stores
 * the raw query, a user, a device, or an IP.
 */
export async function recordDemandTokensPrisma(
  prisma: PrismaDb,
  rawMarker: unknown,
  rawQuery: unknown,
): Promise<void> {
  if (rawMarker !== DEMAND_SOURCE) return
  const tokens = demandTokens(rawQuery)
  if (tokens.length === 0) return
  const day = new Date().toISOString().slice(0, 10)
  for (const token of tokens) {
    try {
      await prisma.summon_demand_tokens.upsert({
        where: { day_token: { day, token } },
        create: { day, token, count: 1 },
        update: { count: { increment: 1 } },
      })
    } catch {
      // Best-effort demand signal.
    }
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

export async function searchSkillsPrisma(
  prisma: PrismaDb,
  q: string,
  principal: Principal | null | undefined,
  limit: number,
): Promise<Record<string, unknown>[]> {
  const rows = await prisma.skills.findMany({
    where: {
      latest_hash: { not: null },
      deprecated_at: null,
      moderation_status: 'none',
      OR: [
        { slug: { contains: q } },
        { description: { contains: q } },
        { author_id: { contains: q } },
      ],
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

  const suspended = new Set(await suspendedAuthorHandlesPrisma(prisma))
  const scored: Scored[] = []
  for (const row of rows) {
    if (suspended.has(row.author_id)) continue
    if (!(await canReadSkillPrisma(prisma, principal, row.id, row.visibility))) continue
    const score = matchScore(q, [row.slug, row.author_id], [row.description])
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
  return rankAndSlice(scored, limit)
}

export async function searchKitsPrisma(
  prisma: PrismaDb,
  q: string,
  principal: Principal | null | undefined,
  limit: number,
): Promise<Record<string, unknown>[]> {
  const suspended = new Set(await suspendedAuthorHandlesPrisma(prisma))
  const rows = await prisma.kits.findMany({
    where: {
      moderation_status: 'none',
      OR: [{ name: { contains: q } }, { description: { contains: q } }],
    },
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
    const score = matchScore(q, [row.name], [row.description])
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
  const items = rankAndSlice(scored, limit)
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

export async function searchAuthorsPrisma(
  prisma: PrismaDb,
  q: string,
  limit: number,
): Promise<Record<string, unknown>[]> {
  const orgSlugs = (
    await prisma.organizations.findMany({ select: { slug: true } })
  ).map((o) => o.slug)
  const suspended = await suspendedAuthorHandlesPrisma(prisma)
  const exclude = [...new Set([...orgSlugs, ...suspended])]

  const rows = await prisma.authors.findMany({
    where: {
      ...(exclude.length > 0 ? { id: { notIn: exclude } } : {}),
      OR: [
        { id: { contains: q } },
        { name: { contains: q } },
        { bio: { contains: q } },
      ],
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
    const score = matchScore(q, [row.id, row.name], [row.bio])
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
  return rankAndSlice(scored, limit)
}

export async function searchTeamsPrisma(
  prisma: PrismaDb,
  q: string,
  limit: number,
): Promise<Record<string, unknown>[]> {
  const rows = await prisma.organizations.findMany({
    where: {
      OR: [{ slug: { contains: q } }, { name: { contains: q } }],
    },
    orderBy: { created_at: 'desc' },
    take: CANDIDATE_CAP,
    select: { slug: true, name: true, created_at: true },
  })

  const scored: Scored[] = []
  for (const row of rows) {
    const score = matchScore(q, [row.slug, row.name], [])
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
  return rankAndSlice(scored, limit)
}
