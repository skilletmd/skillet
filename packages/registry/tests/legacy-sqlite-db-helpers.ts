// Quarantined sqlite helpers formerly in src/db/index.ts (U6).
import type { DatabaseSync } from '../src/db/sqlite-handle.js'
import type { AuthorKey, FollowEdge, FollowKind, FollowerEntry } from '../src/db/index.js'
import { SUSPENDED_HANDLES_SUBQUERY } from '../src/lib/suspension.js'
import { query, queryOne, runTransaction } from './legacy-sqlite-query.js'

export { runTransaction }

/** Return all non-revoked keys bound to a user (characterization only). */
export function getAuthorKeys(db: DatabaseSync, userId: string): AuthorKey[] {
  return query<AuthorKey>(
    db,
    'SELECT key_id, public_key FROM author_keys WHERE user_id = ? AND revoked_at IS NULL',
    userId,
  )
}

export function getPrimaryAuthorKey(db: DatabaseSync, userId: string): AuthorKey | null {
  const row = queryOne<{ key_id: string | null; public_key: string | null }>(
    db,
    'SELECT author_key_id AS key_id, author_public_key AS public_key FROM users WHERE id = ?',
    userId,
  )
  if (!row || !row.key_id || !row.public_key) return null
  return { key_id: row.key_id, public_key: row.public_key }
}

/** Follow a subject. Idempotent. Returns true if a new edge was created. */
export function followSubject(
  db: DatabaseSync,
  userId: string,
  kind: FollowKind,
  subjectId: string,
): boolean {
  return runTransaction(db, () => {
    const res = db
      .prepare(
        `INSERT OR IGNORE INTO follows (follower_user_id, subject_kind, subject_id)
         VALUES (?, ?, ?)`,
      )
      .run(userId, kind, subjectId)
    const created = Number(res.changes) > 0
    if (created) {
      db.prepare(
        `INSERT INTO follow_counts (subject_kind, subject_id, followers)
         VALUES (?, ?, 1)
         ON CONFLICT(subject_kind, subject_id)
         DO UPDATE SET followers = followers + 1`,
      ).run(kind, subjectId)
    }
    return created
  })
}

export function unfollowSubject(
  db: DatabaseSync,
  userId: string,
  kind: FollowKind,
  subjectId: string,
): boolean {
  return runTransaction(db, () => {
    const res = db
      .prepare(
        `DELETE FROM follows
         WHERE follower_user_id = ? AND subject_kind = ? AND subject_id = ?`,
      )
      .run(userId, kind, subjectId)
    const removed = Number(res.changes) > 0
    if (removed) {
      db.prepare(
        `UPDATE follow_counts SET followers = MAX(0, followers - 1)
         WHERE subject_kind = ? AND subject_id = ?`,
      ).run(kind, subjectId)
    }
    return removed
  })
}

export function isFollowing(
  db: DatabaseSync,
  userId: string,
  kind: FollowKind,
  subjectId: string,
): boolean {
  const row = queryOne<{ ok: number }>(
    db,
    `SELECT 1 AS ok FROM follows
       WHERE follower_user_id = ? AND subject_kind = ? AND subject_id = ?`,
    userId,
    kind,
    subjectId,
  )
  return row != null
}

export function getFollowerCount(
  db: DatabaseSync,
  kind: FollowKind,
  subjectId: string,
): number {
  const row = queryOne<{ followers: number }>(
    db,
    'SELECT followers FROM follow_counts WHERE subject_kind = ? AND subject_id = ?',
    kind,
    subjectId,
  )
  return row?.followers ?? 0
}

export function listFollowing(db: DatabaseSync, userId: string): FollowEdge[] {
  return query<FollowEdge>(
    db,
    `SELECT subject_kind, subject_id, created_at
       FROM follows WHERE follower_user_id = ?
       ORDER BY created_at DESC`,
    userId,
  )
}

export function listFollowedAuthorIds(db: DatabaseSync, userId: string): string[] {
  const rows = query<{ subject_id: string }>(
    db,
    `SELECT subject_id FROM follows
       WHERE follower_user_id = ? AND subject_kind = 'author'`,
    userId,
  )
  return rows.map((r) => r.subject_id)
}

export function listFollowers(
  db: DatabaseSync,
  kind: FollowKind,
  subjectId: string,
): FollowerEntry[] {
  return query<FollowerEntry>(
    db,
    `SELECT u.handle AS handle, f.created_at AS created_at
       FROM follows f
       JOIN users u ON u.id = f.follower_user_id
       WHERE f.subject_kind = ? AND f.subject_id = ? AND f.is_private = 0
         AND u.suspended_at IS NULL
       ORDER BY f.created_at DESC`,
    kind,
    subjectId,
  )
}

export function getFollowingCount(db: DatabaseSync, userId: string): number {
  const row = queryOne<{ c: number }>(
    db,
    "SELECT COUNT(*) AS c FROM follows WHERE follower_user_id = ? AND subject_kind = 'author'",
    userId,
  )
  return row?.c ?? 0
}

export function listFollowingHandles(db: DatabaseSync, userId: string): string[] {
  return query<{ subject_id: string }>(
    db,
    `SELECT subject_id FROM follows
       WHERE follower_user_id = ? AND subject_kind = 'author' AND is_private = 0
         AND subject_id NOT IN (${SUSPENDED_HANDLES_SUBQUERY})
       ORDER BY created_at DESC`,
    userId,
  ).map((r) => r.subject_id)
}

export function getUserIdByHandle(db: DatabaseSync, handle: string): string | null {
  const row = queryOne<{ id: string }>(db, 'SELECT id FROM users WHERE handle = ?', handle)
  return row?.id ?? null
}

export function listOrgMemberHandles(db: DatabaseSync, orgSlug: string): string[] {
  return query<{ handle: string }>(
    db,
    `SELECT u.handle AS handle
         FROM organization_members om
         JOIN organizations o ON o.id = om.org_id
         JOIN users u ON u.id = om.user_id
         WHERE o.slug = ? AND om.accepted_at IS NOT NULL AND u.handle IS NOT NULL`,
    orgSlug,
  ).map((r) => r.handle)
}
