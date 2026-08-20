// Who-to-follow suggestions for the MySQL/Prisma path (mirrors GET /me/suggestions SQL).
import type { PrismaDb } from '../db/prisma-client.js'
import { SUSPENDED_HANDLES_SUBQUERY } from './suspension.js'

export type FollowSuggestionRow = {
  handle: string
  name: string
  avatar_url: string | null
  skills: number
  followers: number
}

type SuggestionSqlRow = {
  handle: string
  name: string
  avatar_url: string | null
  skills: number | bigint
  followers: number | bigint
  via_count?: number | bigint
  recent?: number | bigint | null
}

function assertSafeHandle(handle: string): boolean {
  return handle === '' || /^[A-Za-z0-9_-]+$/.test(handle)
}

function mapRow(r: SuggestionSqlRow): FollowSuggestionRow {
  return {
    handle: r.handle,
    name: r.name,
    avatar_url: r.avatar_url,
    skills: Number(r.skills),
    followers: Number(r.followers),
  }
}

/**
 * Second-degree then popular-publisher top-up. Same ranking as the sqlite
 * /me/suggestions handler.
 */
export async function listFollowSuggestionsPrisma(
  prisma: PrismaDb,
  userId: string,
  selfHandle: string,
  limit: number,
): Promise<FollowSuggestionRow[]> {
  if (!assertSafeHandle(selfHandle)) return []

  const secondDegree = await prisma.$queryRawUnsafe<SuggestionSqlRow[]>(
    `SELECT a.id AS handle,
            a.name AS name,
            a.avatar_url AS avatar_url,
            (SELECT COUNT(*) FROM skills s WHERE s.author_id = a.id AND s.visibility = 'public') AS skills,
            COALESCE(fc.followers, 0) AS followers,
            COUNT(DISTINCT pu.id) AS via_count,
            MAX(fp.created_at) AS recent
       FROM follows fa
       JOIN users pu ON pu.handle = fa.subject_id
       JOIN follows fp ON fp.follower_user_id = pu.id AND fp.subject_kind = 'author'
       JOIN authors a ON a.id = fp.subject_id
       LEFT JOIN follow_counts fc ON fc.subject_kind = 'author' AND fc.subject_id = a.id
       WHERE fa.follower_user_id = ? AND fa.subject_kind = 'author'
         AND a.id <> ?
         AND a.id NOT IN (${SUSPENDED_HANDLES_SUBQUERY})
         AND fp.subject_id NOT IN (
           SELECT subject_id FROM follows
           WHERE follower_user_id = ? AND subject_kind = 'author'
         )
         AND EXISTS (SELECT 1 FROM skills s WHERE s.author_id = a.id AND s.visibility = 'public')
       GROUP BY a.id, a.name, a.avatar_url, fc.followers
       ORDER BY via_count DESC, recent DESC, skills DESC, followers DESC, a.id ASC
       LIMIT ?`,
    userId,
    selfHandle,
    userId,
    limit,
  )

  const suggestions: FollowSuggestionRow[] = secondDegree.map(mapRow)

  if (suggestions.length >= limit) return suggestions

  const have = new Set(suggestions.map((s) => s.handle))
  const popular = await prisma.$queryRawUnsafe<SuggestionSqlRow[]>(
    `SELECT a.id AS handle,
            a.name AS name,
            a.avatar_url AS avatar_url,
            (SELECT COUNT(*) FROM skills s WHERE s.author_id = a.id AND s.visibility = 'public') AS skills,
            COALESCE(fc.followers, 0) AS followers
       FROM authors a
       LEFT JOIN follow_counts fc ON fc.subject_kind = 'author' AND fc.subject_id = a.id
       WHERE EXISTS (SELECT 1 FROM skills s WHERE s.author_id = a.id AND s.visibility = 'public')
         AND a.id <> ?
         AND a.id NOT IN (${SUSPENDED_HANDLES_SUBQUERY})
         AND a.id NOT IN (
           SELECT subject_id FROM follows
           WHERE follower_user_id = ? AND subject_kind = 'author'
         )
       ORDER BY skills DESC, followers DESC, a.id ASC
       LIMIT ?`,
    selfHandle,
    userId,
    limit,
  )

  for (const r of popular) {
    if (suggestions.length >= limit) break
    const row = mapRow(r)
    if (have.has(row.handle)) continue
    have.add(row.handle)
    suggestions.push(row)
  }

  return suggestions
}
