import type { RegistryMigration } from '../migrate-runner.js';

/**
 * The author a connected repo publishes under. NULL = the connecting user's own
 * handle (the default). A team slug means the repo publishes (and re-syncs) under
 * that team — persisted so an auto-refresh keeps publishing to the right owner,
 * not the user. The connect route verifies the user admins the team before
 * setting it (canAdminOrgAuthor).
 */
export const migration030ConnectedRepoPublishAs: RegistryMigration = {
  version: 30,
  name: 'connected_repo_publish_as',
  up: (db) => {
    db.exec(`ALTER TABLE connected_repos ADD COLUMN publish_as TEXT;`);
  },
};
