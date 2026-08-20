import type { RegistryMigration } from '../migrate-runner.js';

/**
 * One reusable GitHub token per user, so connecting a repo needs no extra OAuth
 * grant once we already hold a usable token (one-connection / minimal-scope
 * refactor). Captured two ways, both read-only:
 *   - at GitHub sign-in (the identity token, NextAuth default scope), and
 *   - when a non-GitHub-sign-in user completes the one-time minimal-scope connect.
 *
 * token_enc is AES-256-GCM encrypted at rest (SKILLET_REPO_TOKEN_KEY), reusing
 * the same crypto as connected_repos.token_enc. The raw token never leaves the
 * registry — the BFF only learns a boolean "has a usable GitHub token."
 */
export const migration027UserGithubTokens: RegistryMigration = {
  version: 27,
  name: 'user_github_tokens',
  up: (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_github_tokens (
        user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        token_enc  TEXT NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
    `);
  },
};
