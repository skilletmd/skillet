import type { RegistryMigration } from '../migrate-runner.js';

/**
 * Self-typed X (Twitter) handle on the public profile. We don't run X OAuth (its
 * API isn't worth the cost for a profile link), so the handle is unverified —
 * stored bare (no '@'), rendered as a link to x.com/<handle>. GitHub stays
 * OAuth-verified (it also powers repo sync); X is just a link the user types.
 */
export const migration028AuthorXHandle: RegistryMigration = {
  version: 28,
  name: 'author_x_handle',
  up: (db) => {
    db.exec(`ALTER TABLE authors ADD COLUMN x_handle TEXT;`);
  },
};
