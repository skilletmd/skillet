import type { RegistryMigration } from '../migrate-runner.js';

/**
 * Whether a connected repo's >1 skills bundle into a linked kit. Default 1
 * (a multi-skill repo is a kit, the historic behavior). The import wizard can set
 * it to 0 to publish the skills loose, and re-sync must respect that choice
 * instead of re-creating the kit — hence persisting it here, not just at import.
 */
export const migration029ConnectedRepoAsKit: RegistryMigration = {
  version: 29,
  name: 'connected_repo_as_kit',
  up: (db) => {
    db.exec(`ALTER TABLE connected_repos ADD COLUMN as_kit INTEGER NOT NULL DEFAULT 1;`);
  },
};
