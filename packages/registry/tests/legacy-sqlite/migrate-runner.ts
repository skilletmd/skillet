import type { DatabaseSync } from '../../src/db/sqlite-handle.js'
import { query, queryOne } from '../legacy-sqlite-query.js'


export interface RegistryMigration {
  version: number;
  name: string;
  up: (db: DatabaseSync) => void;
}

const LEDGER_TABLE = 'schema_migrations';

function runInTransaction(db: DatabaseSync, fn: () => void): void {
  db.exec('BEGIN');
  try {
    fn();
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function tableExists(db: DatabaseSync, name: string): boolean {
  const row = queryOne<{ ok: number }>(
    db,
    "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?",
    name,
  );
  return row != null;
}

function ensureLedgerTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${LEDGER_TABLE} (
      version     INTEGER PRIMARY KEY,
      name        TEXT NOT NULL,
      applied_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
}

function appliedVersions(db: DatabaseSync): Set<number> {
  const rows = query<{ version: number }>(
    db,
    `SELECT version FROM ${LEDGER_TABLE} ORDER BY version`,
  );
  return new Set(rows.map((r) => r.version));
}

function recordMigration(db: DatabaseSync, migration: RegistryMigration): void {
  db.prepare(
    `INSERT INTO ${LEDGER_TABLE} (version, name, applied_at) VALUES (?, ?, unixepoch())`,
  ).run(migration.version, migration.name);
}

/**
 * Pre-ledger databases: stamp every migration as applied without re-running
 * baseline backfills (github_id → identities, author_keys backfill, etc.).
 */
function bootstrapLegacyLedger(db: DatabaseSync, migrations: RegistryMigration[]): void {
  if (tableExists(db, LEDGER_TABLE)) return;
  if (!tableExists(db, 'skills')) return;

  ensureLedgerTable(db);
  runInTransaction(db, () => {
    for (const m of migrations) {
      recordMigration(db, m);
    }
  });
}

/** Run pending numbered migrations; idempotent via schema_migrations ledger. */
export function runRegistryMigrations(db: DatabaseSync, migrations: RegistryMigration[]): void {
  bootstrapLegacyLedger(db, migrations);
  ensureLedgerTable(db);

  const applied = appliedVersions(db);
  const pending = migrations.filter((m) => !applied.has(m.version));
  if (pending.length === 0) return;

  runInTransaction(db, () => {
    for (const migration of pending) {
      migration.up(db);
      recordMigration(db, migration);
    }
  });
}

/** Current head version for ops / diagnostics. */
export function registrySchemaVersion(db: DatabaseSync): number {
  if (!tableExists(db, LEDGER_TABLE)) return 0;
  const row = queryOne<{ v: number | null }>(
    db,
    `SELECT MAX(version) AS v FROM ${LEDGER_TABLE}`,
  );
  return row?.v ?? 0;
}
