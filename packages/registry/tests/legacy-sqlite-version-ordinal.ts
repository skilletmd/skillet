// Quarantined sqlite version-ordinal helpers for characterization under tests/ (U3).
import type { DatabaseSync } from '../src/db/sqlite-handle.js'
import { queryOne } from './legacy-sqlite-query.js'

export function versionOrdinal(db: DatabaseSync, skillId: string, hash: string): number {
  const row = queryOne<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n
       FROM skill_versions v,
            (SELECT published_at AS p, rowid AS r
               FROM skill_versions WHERE skill_id = ? AND hash = ?) t
      WHERE v.skill_id = ?
        AND (v.published_at < t.p OR (v.published_at = t.p AND v.rowid <= t.r))`,
    skillId,
    hash,
    skillId,
  )
  return row?.n ?? 1
}

export function nextVersionOrdinal(db: DatabaseSync, skillId: string): number {
  const row = queryOne<{ c: number }>(
    db,
    'SELECT COUNT(*) AS c FROM skill_versions WHERE skill_id = ?',
    skillId,
  )
  return (row?.c ?? 0) + 1
}
