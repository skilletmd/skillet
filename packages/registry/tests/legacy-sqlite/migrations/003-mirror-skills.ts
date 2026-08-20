import type { RegistryMigration } from '../migrate-runner.js';

/**
 * Seed-mirror support (docs/plans/seed-mirror-skills.md).
 *
 * Mirrored skills are imported from public GitHub repos under a reserved brand
 * handle, clearly labeled and unsigned, and **claimable** by the real owner.
 *
 * - authors gains mirror flags: a mirror author with `mirror_claimed_at IS NULL`
 *   is still auto-synced; once a brand claims the handle, the timestamp is set and
 *   the sync job skips it (claim freezes sync, so it never overwrites real edits).
 * - `skill_mirrors` is the server-side sync lock (the skills-lock.json idea, in
 *   the DB): per mirrored skill, where it came from and the last-synced hash, so
 *   the job is idempotent and only re-publishes on upstream change.
 */
export const migration003MirrorSkills: RegistryMigration = {
  version: 3,
  name: 'mirror_skills',
  up: (db) => {
    db.exec(`
      ALTER TABLE authors ADD COLUMN is_mirror INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE authors ADD COLUMN mirror_source_url TEXT;
      ALTER TABLE authors ADD COLUMN mirror_claimed_at INTEGER;

      CREATE TABLE IF NOT EXISTS skill_mirrors (
        skill_id      TEXT PRIMARY KEY,
        source_repo   TEXT NOT NULL,
        source_ref    TEXT,
        source_path   TEXT,
        source_url    TEXT,
        license       TEXT,
        computed_hash TEXT NOT NULL,
        synced_at     INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_skill_mirrors_repo
        ON skill_mirrors (source_repo);
    `);
  },
};
