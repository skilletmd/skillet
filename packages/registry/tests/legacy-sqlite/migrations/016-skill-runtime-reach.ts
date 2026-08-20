import type { RegistryMigration } from '../migrate-runner.js';

/**
 * Cross-vendor distribution (availability) — the data behind "this skill is
 * available on Claude + Codex + Cursor across N machines". CURRENT STATE, not an
 * event log: one row per (user, skill, runtime), upserted on sync. That's the
 * minimal data for the distribution graph (`COUNT(DISTINCT user_id)` per
 * skill×runtime), and it doubles as honest product surface — your own profile /
 * devices show where your skills are available.
 *
 * It is AVAILABILITY, not usage: we know a skill is present + materialized in a
 * runtime on a machine, never that it executed.
 *
 * Privacy by construction (mirrors the events table, migration 014):
 * - Account-bound: keyed by user_id; the anonymous local-first path never reports.
 * - Opt-out: `users.activity_private = 1` drops reach at ingest, same as events.
 * - Metadata only: a skill ref + a runtime name. No content.
 * - User-owned: DELETE /api/v1/me/reach purges it on demand (parity with
 *   /me/events), and ON DELETE CASCADE removes it with the account.
 * - Per-user storage ceiling at ingest, so a value-rotating client can't bloat it.
 *
 * K-ANONYMITY (future): there is no public aggregate endpoint yet. When one is
 * built, any per-skill×runtime count it exposes MUST be gated behind a minimum
 * distinct-user floor (e.g. only surface `COUNT(DISTINCT user_id) >= k`, k>=5)
 * so a low-count cell can't deanonymize who has a niche skill installed. The
 * raw table stays account-private and is never served per-user.
 */
export const migration016SkillRuntimeReach: RegistryMigration = {
  version: 16,
  name: 'skill_runtime_reach',
  up: (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS skill_runtime_reach (
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        skill_ref  TEXT NOT NULL,
        runtime    TEXT NOT NULL,
        last_seen  INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (user_id, skill_ref, runtime)
      );
      CREATE INDEX IF NOT EXISTS idx_reach_skill_runtime ON skill_runtime_reach (skill_ref, runtime);
    `);
  },
};
