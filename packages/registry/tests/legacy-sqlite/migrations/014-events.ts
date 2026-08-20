import type { RegistryMigration } from '../migrate-runner.js';

/**
 * The activity stream — the time-series the totals can't give you (retention,
 * cohorts, funnels, cross-vendor distribution (availability)). Append-only; each row is one
 * human/daemon/ci-tagged action you took against your account (sync, add,
 * publish, login…). It's not separate "telemetry" — it's the record of your
 * sync, the way a code host records your pushes, and it powers your devices,
 * profile, and the public compatibility graph. History is irrecoverable, so it
 * accrues now.
 *
 * Privacy by construction:
 * - Account-bound: only signed-in / user-bound clients are recorded. The
 *   anonymous local-first path (unbound device tokens, no account) is the
 *   genuine "don't record me" mode — those events are rejected at ingest.
 * - Private mode (opt-out): `users.activity_private = 1` stops recording for an
 *   account; the ingest endpoint drops their events, so a stale client can't
 *   keep sending. Default is 0 (recorded), disclosed on first sync.
 * - Metadata only: `meta` holds short key/values (skill ref, runtime, counts) —
 *   the ingest endpoint length-caps every value and bounds the key count, so a
 *   skill body / prompt / file can't fit. No content.
 * - User-owned: ON DELETE CASCADE; DELETE /me/events clears your stream.
 *
 * `initiator` keeps the north-star honest — only `human` events count toward
 * retention; daemon heartbeats and CI-token syncs are kept but excluded.
 */
export const migration014Events: RegistryMigration = {
  version: 14,
  name: 'events',
  up: (db) => {
    db.exec(`
      ALTER TABLE users ADD COLUMN activity_private INTEGER NOT NULL DEFAULT 0;

      CREATE TABLE IF NOT EXISTS events (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        initiator   TEXT NOT NULL CHECK (initiator IN ('human', 'daemon', 'ci')),
        user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
        device_id   TEXT,
        meta        TEXT,
        ts          INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_events_name_ts ON events (name, ts);
      CREATE INDEX IF NOT EXISTS idx_events_user_ts ON events (user_id, ts);
    `);
  },
};
