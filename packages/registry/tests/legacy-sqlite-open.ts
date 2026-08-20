// Legacy sqlite open+migrate for characterization tests only (not under src/).
import { DatabaseSync } from 'node:sqlite'
import { runRegistryMigrations } from './legacy-sqlite/migrate-runner.js'
import { REGISTRY_MIGRATIONS } from './legacy-sqlite/migrations/index.js'
import type { SqliteHandle } from '../src/db/sqlite-handle.js'

/** Open an in-memory (or path) sqlite DB with the historical migration ledger. */
export function openLegacySqlite(path = ':memory:'): SqliteHandle {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 5000')
  runRegistryMigrations(db, REGISTRY_MIGRATIONS)
  return db
}
