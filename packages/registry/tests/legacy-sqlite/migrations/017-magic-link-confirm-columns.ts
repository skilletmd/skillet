import type { RegistryMigration } from '../migrate-runner.js';
import { query } from '../../legacy-sqlite-query.js';

/**
 * Backfill the H2 device-authorization confirm columns on magic_link_tokens.
 *
 * `user_code_hash` and `confirm_attempts` were added (commit f7d58e33) as new
 * guarded ALTERs *inside* the baseline migration 001. That works for fresh DBs,
 * but any DB created before that commit was stamped via bootstrapLegacyLedger —
 * which records migration 001 as applied WITHOUT running it — so the columns
 * were never added and magic-link login fails with "no such column:
 * user_code_hash". This dedicated, numbered migration converges every such DB
 * (local + production D1). The guards are idempotent, so it's a no-op where the
 * columns already exist.
 */
export const migration017MagicLinkConfirmColumns: RegistryMigration = {
  version: 17,
  name: 'magic_link_confirm_columns',
  up: (db) => {
    const cols = query<{ name: string }>(
      db,
      `PRAGMA table_info(magic_link_tokens)`,
    );
    if (!cols.some((c) => c.name === 'user_code_hash')) {
      db.exec(`ALTER TABLE magic_link_tokens ADD COLUMN user_code_hash TEXT`);
    }
    if (!cols.some((c) => c.name === 'confirm_attempts')) {
      db.exec(`ALTER TABLE magic_link_tokens ADD COLUMN confirm_attempts INTEGER NOT NULL DEFAULT 0`);
    }
  },
};
