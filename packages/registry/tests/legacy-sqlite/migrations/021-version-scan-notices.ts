import type { RegistryMigration } from '../migrate-runner.js'

/**
 * Author-facing notices for retroactive enforcement (trust flow, U8).
 *
 * When an async re-scan resolves a *live* version to `quarantined`, the runner
 * rebalances `latest_hash` off it (the installable pointer never references a
 * blocked version) and records a notice here so the author learns their version
 * was pulled — they didn't take an action that would surface in the activity
 * feed, so this is the persistent record the Updates/notifications surface reads.
 *
 * One row per blocked version (`version_hash` UNIQUE) — re-scanning the same
 * already-blocked hash is idempotent. `author_id` is the skill's author handle
 * (`skills.author_id`); nullable only in the degenerate case where it can't be
 * resolved. Unread state rides the shared `users.notifications_seen_at` cursor
 * (same as every other notification kind) — `created_at` is the comparison key.
 */
export const migration021VersionScanNotices: RegistryMigration = {
  version: 21,
  name: 'version_scan_notices',
  up: (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS version_scan_notices (
        version_hash TEXT PRIMARY KEY,
        skill_id     TEXT NOT NULL,
        author_id    TEXT,
        reason       TEXT NOT NULL CHECK (reason IN ('quarantined')),
        created_at   INTEGER NOT NULL DEFAULT (unixepoch())
      );
    `)
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_version_scan_notices_author ON version_scan_notices (author_id, created_at);`,
    )
  },
}
