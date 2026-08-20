import type { RegistryMigration } from '../migrate-runner.js';

/**
 * Rename `skill_runtime_reach` → `skill_runtime_availability` (pre-launch
 * clean break; see docs/plans/2026-07-07-002). The table is cross-vendor
 * AVAILABILITY, not usage: one current-state row per (user, skill, runtime),
 * upserted on sync — we know a skill is present in a runtime on a machine,
 * never that it executed. Migration 016 has the full privacy contract
 * (account-bound, opt-out at ingest, metadata only, user-owned delete,
 * per-user ceiling); the rename preserves all of it.
 *
 * K-ANONYMITY (future): there is no public aggregate endpoint yet. When one is
 * built, any per-skill×runtime count it exposes MUST be gated behind a minimum
 * distinct-user floor (e.g. only surface `COUNT(DISTINCT user_id) >= k`, k>=5)
 * so a low-count cell can't deanonymize who has a niche skill installed. The
 * raw table stays account-private and is never served per-user.
 *
 * SQLite preserves the PK and the `users(id) ON DELETE CASCADE` FK through
 * `ALTER TABLE … RENAME TO`; only the standalone index needs a manual rename.
 */
export const migration058SkillAvailabilityRename: RegistryMigration = {
  version: 58,
  name: 'skill_availability_rename',
  up: (db) => {
    db.exec(`
      ALTER TABLE skill_runtime_reach RENAME TO skill_runtime_availability;
      DROP INDEX IF EXISTS idx_reach_skill_runtime;
      CREATE INDEX IF NOT EXISTS idx_availability_skill_runtime
        ON skill_runtime_availability (skill_ref, runtime);
    `);
  },
};
