import type { RegistryMigration } from '../migrate-runner.js';

/**
 * Semver labels for skill versions: `major.minor.patch` columns alongside the
 * content-addressed hash (the kit analogue is 005's `major.minor`). Backfill
 * maps each skill's flat history onto `N.0.0` without renumbering: the k-th
 * row per skill ordered by `(published_at, rowid)` becomes `k.0.0`.
 * `published_at` has second resolution, so `rowid` breaks same-second ties in
 * insertion order. Yanked rows keep their ordinal — a yank never shifts the
 * numbering of later versions.
 */
export const migration047SkillVersionSemver: RegistryMigration = {
  version: 47,
  name: 'skill_version_semver',
  up: (db) => {
    db.exec(`
      ALTER TABLE skill_versions ADD COLUMN major INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE skill_versions ADD COLUMN minor INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE skill_versions ADD COLUMN patch INTEGER NOT NULL DEFAULT 0;
      UPDATE skill_versions SET major = ranked.k
      FROM (
        SELECT rowid AS rid,
               ROW_NUMBER() OVER (PARTITION BY skill_id ORDER BY published_at, rowid) AS k
        FROM skill_versions
      ) AS ranked
      WHERE skill_versions.rowid = ranked.rid;
    `);
  },
};
