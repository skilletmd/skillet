// Typed sqlite query helpers for characterization under tests/ only (U6).
import type { DatabaseSync } from '../src/db/sqlite-handle.js'

/** Bound statement parameter types node:sqlite accepts. */
type BindValue = null | number | bigint | string | Uint8Array

/** Run a SELECT and return every row, typed as `T`. */
export function query<T>(db: DatabaseSync, sql: string, ...params: BindValue[]): T[] {
  return db.prepare(sql).all(...params) as unknown as T[]
}

/** Run a SELECT and return the first row as `T`, or `undefined` if none. */
export function queryOne<T>(
  db: DatabaseSync,
  sql: string,
  ...params: BindValue[]
): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined
}

/** Sync BEGIN/COMMIT wrapper for characterization sqlite writes. */
export function runTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}
