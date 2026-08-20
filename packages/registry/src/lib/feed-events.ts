// Feed-family reads for the MySQL/Prisma path (follows on 2026-07-15 plan).
import type { PrismaDb } from '../db/prisma-client.js'
import type { SkillRow, SubscribeEvent } from '../routes/follows.js'
import { SUSPENDED_HANDLES_SUBQUERY } from './suspension.js'

const SKILL_EVENT_FROM = `
  FROM skill_versions sv
  JOIN skills s ON s.id = sv.skill_id
  LEFT JOIN skill_version_scans svs ON svs.skill_id = s.id AND svs.skill_version_id = sv.hash
  LEFT JOIN follow_counts fc ON fc.subject_kind = 'author' AND fc.subject_id = s.author_id
`

const SKILL_EVENT_SELECT_CORE = `
  SELECT sv.hash          AS version_hash,
         sv.published_at   AS at,
         sv.metadata_json  AS metadata_json,
         sv.major          AS major,
         sv.minor          AS minor,
         sv.patch          AS patch,
         s.author_id       AS author,
         s.slug            AS slug,
         s.description     AS description,
         s.category        AS category,
         s.install_count   AS installs,
         svs.status        AS scan_status,
         fc.followers      AS actor_followers,
         (SELECT MIN(sv2.published_at) FROM skill_versions sv2 WHERE sv2.skill_id = s.id) AS first_at
  ${SKILL_EVENT_FROM}
`

/** Defense-in-depth before raw SQL; invalid route params return empty (sqlite parity). */
function handlesAreSafe(handles: string[]): boolean {
  return handles.every((h) => /^[A-Za-z0-9_-]+$/.test(h))
}

export type SkillFeedScope =
  | { kind: 'discover'; excludeUnlisted?: boolean }
  | { kind: 'authors'; handles: string[] }
  | { kind: 'team'; memberHandles: string[]; orgHandle: string }
  | { kind: 'single_author'; author: string }

/** Author handles this user follows (feed assembly). Mirrors sqlite listFollowedAuthorIds. */
export async function listFollowedAuthorIdsPrisma(
  prisma: PrismaDb,
  userId: string,
): Promise<string[]> {
  const rows = await prisma.follows.findMany({
    where: { follower_user_id: userId, subject_kind: 'author' },
    select: { subject_id: true },
  })
  return rows.map((r) => r.subject_id)
}

/** Accepted org member handles. Powers team-scoped feeds. */
export async function listOrgMemberHandlesPrisma(
  prisma: PrismaDb,
  orgSlug: string,
): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ handle: string }>>(
    `SELECT u.handle AS handle
       FROM organization_members om
       JOIN organizations o ON o.id = om.org_id
       JOIN users u ON u.id = om.user_id
       WHERE o.slug = ? AND om.accepted_at IS NOT NULL AND u.handle IS NOT NULL`,
    orgSlug,
  )
  return rows.map((r) => r.handle)
}

function skillScopeWhere(scope: SkillFeedScope): { sql: string; params: Array<string | number> } {
  // Shared across every scope: exclude suspended authors AND deprecated skills.
  // A deprecated skill is hidden from the directory and unopenable, so its
  // publish/update events must not surface in any feed either.
  const suspended = `s.author_id NOT IN (${SUSPENDED_HANDLES_SUBQUERY}) AND s.deprecated_at IS NULL`
  if (scope.kind === 'discover') {
    const unlisted =
      scope.excludeUnlisted === true ? ` AND s.moderation_status != 'unlisted'` : ''
    return {
      sql: `WHERE s.visibility = 'public' AND ${suspended}${unlisted}`,
      params: [],
    }
  }
  if (scope.kind === 'single_author') {
    if (!handlesAreSafe([scope.author])) return { sql: 'WHERE 1=0', params: [] }
    return {
      sql: `WHERE s.author_id = ? AND s.visibility = 'public' AND ${suspended}`,
      params: [scope.author],
    }
  }
  if (scope.kind === 'authors') {
    if (scope.handles.length === 0) return { sql: 'WHERE 1=0', params: [] }
    if (!handlesAreSafe(scope.handles)) return { sql: 'WHERE 1=0', params: [] }
    const ph = scope.handles.map(() => '?').join(',')
    return {
      sql: `WHERE s.author_id IN (${ph}) AND s.visibility = 'public' AND ${suspended}`,
      params: [...scope.handles],
    }
  }
  if (!handlesAreSafe([scope.orgHandle, ...scope.memberHandles])) {
    return { sql: 'WHERE 1=0', params: [] }
  }
  const ph = scope.memberHandles.length
    ? scope.memberHandles.map(() => '?').join(',')
    : `''`
  return {
    sql: `WHERE ((s.author_id IN (${ph}) AND s.visibility = 'public') OR s.author_id = ?)
            AND ${suspended}`,
    params: [...scope.memberHandles, scope.orgHandle],
  }
}

/** Skill publish/update rows for feed surfaces. */
export async function skillEventRowsPrisma(
  prisma: PrismaDb,
  scope: SkillFeedScope,
  limit: number,
): Promise<SkillRow[]> {
  if (scope.kind === 'authors' && scope.handles.length === 0) return []
  const { sql, params } = skillScopeWhere(scope)
  const rows = await prisma.$queryRawUnsafe<SkillRow[]>(
    `${SKILL_EVENT_SELECT_CORE}
     ${sql}
     ORDER BY sv.published_at DESC
     LIMIT ?`,
    ...params,
    limit,
  )
  return rows.map((r) => ({
    ...r,
    at: Number(r.at),
    major: Number(r.major),
    minor: Number(r.minor),
    patch: Number(r.patch),
    installs: Number(r.installs),
    actor_followers: r.actor_followers == null ? null : Number(r.actor_followers),
    first_at: Number(r.first_at),
  }))
}

/**
 * Second-degree follow signal for feed skill cards. Mirrors secondDegreeViaFollows.
 */
export async function secondDegreeViaFollowsPrisma(
  prisma: PrismaDb,
  viewerUserId: string,
  targetHandles: string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  if (targetHandles.length === 0) return out
  if (!handlesAreSafe(targetHandles)) return out
  const ph = targetHandles.map(() => '?').join(',')
  const rows = await prisma.$queryRawUnsafe<Array<{ target: string; via: string }>>(
    `SELECT fp.subject_id AS target, fa.subject_id AS via
       FROM follows fa
       JOIN users pu ON pu.handle = fa.subject_id
       JOIN follows fp ON fp.follower_user_id = pu.id AND fp.subject_kind = 'author'
       WHERE fa.follower_user_id = ? AND fa.subject_kind = 'author'
         AND fp.subject_id IN (${ph})
         AND fa.subject_id <> fp.subject_id
         AND fa.subject_id NOT IN (${SUSPENDED_HANDLES_SUBQUERY})`,
    viewerUserId,
    ...targetHandles,
  )
  for (const r of rows) {
    const arr = out.get(r.target) ?? []
    arr.push(r.via)
    out.set(r.target, arr)
  }
  return out
}

/** Public follow events on a single author's profile activity timeline. */
export async function profileFollowEventRowsPrisma(
  prisma: PrismaDb,
  authorHandle: string,
  limit: number,
): Promise<Array<{ kind: 'follow'; actor: string; target: string; at: number }>> {
  if (!handlesAreSafe([authorHandle])) return []
  const rows = await prisma.$queryRawUnsafe<
    Array<{ actor: string; target: string; at: number | bigint }>
  >(
    `SELECT u.handle AS actor, f.subject_id AS target, f.created_at AS at
       FROM follows f
       JOIN users u ON u.id = f.follower_user_id
       WHERE f.subject_kind = 'author' AND f.is_private = 0 AND u.handle = ?
         AND u.suspended_at IS NULL
         AND f.subject_id NOT IN (${SUSPENDED_HANDLES_SUBQUERY})
       ORDER BY f.created_at DESC
       LIMIT ?`,
    authorHandle,
    limit,
  )
  return rows
    .filter((r) => r.actor !== r.target)
    .map((r) => ({
      kind: 'follow' as const,
      actor: r.actor,
      target: r.target,
      at: Number(r.at),
    }))
}

/**
 * Kit/author subscribe events for feeds. Mirrors subscribeEventRows in follows.ts.
 */
export async function subscribeEventRowsPrisma(
  prisma: PrismaDb,
  actorHandles: string[] | null,
  limit: number,
): Promise<SubscribeEvent[]> {
  if (actorHandles && actorHandles.length === 0) return []
  if (actorHandles && !handlesAreSafe(actorHandles)) return []

  const scope = actorHandles
    ? `AND u.handle IN (${actorHandles.map(() => '?').join(',')})`
    : ''
  const scopeArgs = actorHandles ?? []

  const kitRows = await prisma.$queryRawUnsafe<
    Array<{
      actor: string
      at: number | bigint
      kit_id: string
      name: string
      owner: string
      description: string | null
      skill_count: number | bigint
      subscriber_count: number | bigint
    }>
  >(
    `SELECT u.handle AS actor, sub.created_at AS at, k.id AS kit_id,
            k.name AS name, k.owner_id AS owner, k.description AS description,
            (SELECT COUNT(*) FROM kit_skills ks WHERE ks.kit_id = k.id) AS skill_count,
            (SELECT COUNT(*) FROM kit_subscriptions ks2
              WHERE ks2.kit_id = k.id AND ks2.kind = 'kit') AS subscriber_count
       FROM kit_subscriptions sub
       JOIN users u ON u.id = sub.user_id
       JOIN kits k ON k.id = sub.kit_id
       WHERE sub.kind = 'kit' AND k.visibility = 'public' AND u.handle IS NOT NULL
         AND u.suspended_at IS NULL
         AND k.owner_id NOT IN (${SUSPENDED_HANDLES_SUBQUERY}) ${scope}
       ORDER BY sub.created_at DESC
       LIMIT ?`,
    ...scopeArgs,
    limit,
  )

  const authorRows = await prisma.$queryRawUnsafe<
    Array<{
      actor: string
      at: number | bigint
      owner: string
      name: string
      skill_count: number | bigint
    }>
  >(
    `SELECT u.handle AS actor, sub.created_at AS at, a.id AS owner, a.name AS name,
            (SELECT COUNT(*) FROM skills s
              WHERE s.author_id = a.id AND s.visibility = 'public' AND s.latest_hash IS NOT NULL) AS skill_count
       FROM kit_subscriptions sub
       JOIN users u ON u.id = sub.user_id
       JOIN authors a ON a.id = sub.author_id
       WHERE sub.kind = 'author' AND u.handle IS NOT NULL
         AND u.suspended_at IS NULL
         AND a.id NOT IN (${SUSPENDED_HANDLES_SUBQUERY}) ${scope}
       ORDER BY sub.created_at DESC
       LIMIT ?`,
    ...scopeArgs,
    limit,
  )

  // Cover categories for the kits in this page of events. The cover engine takes
  // (seed, categories); the card seeds on kit_id like the detail hero, so without
  // the real categories it fabricates them from the seed and paints different art
  // for the same kit. Public members only, matching skill_count above (#461).
  const kitIds = [...new Set(kitRows.map((r) => r.kit_id))]
  const catsByKit = new Map<string, (string | null)[]>()
  if (kitIds.length > 0) {
    const members = await prisma.kit_skills.findMany({
      where: { kit_id: { in: kitIds }, skills: { visibility: 'public' } },
      orderBy: { added_at: 'asc' },
      select: { kit_id: true, skills: { select: { category: true } } },
    })
    for (const m of members) {
      const list = catsByKit.get(m.kit_id) ?? []
      list.push(m.skills.category ?? null)
      catsByKit.set(m.kit_id, list)
    }
  }

  const kitEvents: SubscribeEvent[] = kitRows
    .filter((r) => r.actor !== r.owner)
    .map((r) => ({
      kind: 'subscribe',
      actor: r.actor,
      at: Number(r.at),
      subscribe: {
        target_kind: 'kit',
        name: r.name,
        owner: r.owner,
        href: `/kits/${r.kit_id}`,
        skill_count: Number(r.skill_count),
        kit_id: r.kit_id,
        description: r.description,
        subscriber_count: Number(r.subscriber_count),
        skill_categories: catsByKit.get(r.kit_id) ?? [],
      },
    }))

  const authorEvents: SubscribeEvent[] = authorRows
    .filter((r) => r.actor !== r.owner)
    .map((r) => ({
      kind: 'subscribe',
      actor: r.actor,
      at: Number(r.at),
      subscribe: {
        target_kind: 'author',
        name: r.name || r.owner,
        owner: r.owner,
        href: `/${r.owner}/kit`,
        skill_count: Number(r.skill_count),
      },
    }))

  return [...kitEvents, ...authorEvents]
}

/** Session viewer map: skill_id -> handles of followed curators in public kits. */
export async function followedCurationsPrisma(
  prisma: PrismaDb,
  userId: string,
): Promise<Record<string, string[]>> {
  const rows = await prisma.$queryRawUnsafe<Array<{ skill_id: string; handle: string }>>(
    `SELECT ks.skill_id AS skill_id, k.owner_id AS handle
       FROM kit_skills ks
       JOIN kits k ON k.id = ks.kit_id
       JOIN follows f ON f.subject_kind = 'author' AND f.subject_id = k.owner_id
       WHERE k.visibility = 'public' AND f.follower_user_id = ?
         AND k.owner_id NOT IN (${SUSPENDED_HANDLES_SUBQUERY})
       GROUP BY ks.skill_id, k.owner_id
       ORDER BY ks.skill_id, k.owner_id`,
    userId,
  )
  const curations: Record<string, string[]> = {}
  for (const r of rows) {
    (curations[r.skill_id] ??= []).push(r.handle)
  }
  return curations
}
