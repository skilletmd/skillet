import type { RegistryMigration } from '../migrate-runner.js'
import { query } from '../../legacy-sqlite-query.js'

/**
 * Account-scoped update decisions + the account-level update mode.
 *
 * `update_decisions` is the server-side source of truth for whether a subscriber
 * has approved (or rejected) a specific published version of a skill. One row per
 * (user, skill, version) flips between 'approved' and 'rejected' — mirroring the
 * device's local lock (approvals + rejections in one file), so there is no second
 * table and no cross-table clearing. `version_hash` IS the canonical content hash
 * (`skill_versions.hash` = canonicalContentHash(bundle)), so it carries content
 * identity on its own; stored as plain text (existence validated in the handler)
 * to avoid a yanked-version FK failure mode. Pending is computed live; recently-
 * applied = state='approved' rows.
 *
 * `users.update_mode` is the single account control: 'auto' (signed + scanned
 * updates apply on their own) or 'manual' (updates wait for review). Maps to the
 * external global trust default — 'auto' -> auto, 'manual' -> gate. Defaults to
 * 'manual' so existing accounts keep today's safe external default with no
 * backfill.
 */
export const migration020UpdateDecisions: RegistryMigration = {
  version: 20,
  name: 'update_decisions',
  up: (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS update_decisions (
        id           TEXT PRIMARY KEY,
        user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        skill_id     TEXT NOT NULL,
        version_hash TEXT NOT NULL,
        state        TEXT NOT NULL CHECK (state IN ('approved', 'rejected')),
        source       TEXT NOT NULL CHECK (source IN ('web', 'desktop', 'cli', 'auto')),
        decided_at   INTEGER NOT NULL DEFAULT (unixepoch()),
        UNIQUE (user_id, skill_id, version_hash)
      );
    `)
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_update_decisions_user ON update_decisions (user_id, state);`,
    )

    const cols = query<{ name: string }>(db, `PRAGMA table_info(users)`)
    if (!cols.some((c) => c.name === 'update_mode')) {
      db.exec(
        `ALTER TABLE users ADD COLUMN update_mode TEXT NOT NULL DEFAULT 'manual' CHECK (update_mode IN ('auto', 'manual'))`,
      )
    }
  },
}
