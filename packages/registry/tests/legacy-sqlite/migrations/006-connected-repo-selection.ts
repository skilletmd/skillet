import type { RegistryMigration } from '../migrate-runner.js';

/**
 * Subset sync (docs/plans/connect-your-repo.md): a connection can track a chosen
 * SUBSET of a repo's skills, not all of them. `selected_dirs` is a JSON array of
 * skill directories (relative to the repo root) to sync; NULL means "all skills".
 * The sync stays locked to this set — new upstream skills don't appear unless the
 * user re-runs the flow and picks them.
 */
export const migration006ConnectedRepoSelection: RegistryMigration = {
  version: 6,
  name: 'connected_repo_selection',
  up: (db) => {
    db.exec(`ALTER TABLE connected_repos ADD COLUMN selected_dirs TEXT;`);
  },
};
