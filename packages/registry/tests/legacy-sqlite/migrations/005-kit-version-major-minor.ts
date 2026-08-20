import type { RegistryMigration } from '../migrate-runner.js';

/**
 * Two-level kit versions (docs/plans/connect-your-repo.md): a kit release is
 * `major.minor`, where major bumps when the kit's composition changes (a skill
 * added/removed) and minor bumps when a member skill's content changes. The
 * existing `version` column stays as the monotonic sequence (ordering + uniqueness);
 * `major`/`minor` are the human-facing label. Backfill: each prior vN becomes vN.0.
 */
export const migration005KitVersionMajorMinor: RegistryMigration = {
  version: 5,
  name: 'kit_version_major_minor',
  up: (db) => {
    db.exec(`
      ALTER TABLE kit_versions ADD COLUMN major INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE kit_versions ADD COLUMN minor INTEGER NOT NULL DEFAULT 0;
      UPDATE kit_versions SET major = version, minor = 0;
    `);
  },
};
