import type { RegistryMigration } from '../migrate-runner.js';

/**
 * Self-serve "connect your GitHub repo" (docs/plans/connect-your-repo.md).
 *
 * A user connects a repo they own; its skills sync under their handle, refreshed
 * on demand (and later by a cheap SHA-gated cron). Unlike ops mirrors, the author
 * is a real claimed user — so these render "GitHub-synced (ownership-verified)".
 *
 * - token_enc: the repo-scoped OAuth token, AES-256-GCM encrypted at rest
 *   (SKILLET_REPO_TOKEN_KEY). Used only to read the repo + verify ownership.
 * - last_synced_sha: the branch commit SHA at last sync, so reconciliation can
 *   short-circuit unchanged repos with a single cheap API call.
 */
export const migration004ConnectedRepos: RegistryMigration = {
  version: 4,
  name: 'connected_repos',
  up: (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS connected_repos (
        id              TEXT PRIMARY KEY,
        user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        owner           TEXT NOT NULL,
        repo            TEXT NOT NULL,
        default_branch  TEXT,
        token_enc       TEXT,
        last_synced_sha TEXT,
        last_synced_at  INTEGER,
        status          TEXT NOT NULL DEFAULT 'active',
        created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
        UNIQUE(user_id, owner, repo)
      );

      CREATE INDEX IF NOT EXISTS idx_connected_repos_user
        ON connected_repos (user_id);
    `);
  },
};
