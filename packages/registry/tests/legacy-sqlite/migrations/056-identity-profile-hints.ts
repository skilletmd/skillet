import type { RegistryMigration } from '../migrate-runner.js';

/**
 * IdP profile hints (display name, avatar URL) captured at sign-in/link time.
 * Previously these rode the mint/link request and were applied to the authors
 * row immediately — which silently dropped them for users who had no handle
 * yet (the common Google sign-up path: mint first, choose a username after).
 * Persisting them per identity lets the handle claim seed the authors row with
 * the real name/avatar instead of the handle placeholder. Nullable: the email
 * provider has neither, and existing rows backfill on the owner's next
 * sign-in / link (upsert refreshes them on conflict).
 */
export const migration056IdentityProfileHints: RegistryMigration = {
  version: 56,
  name: 'identity_profile_hints',
  up: (db) => {
    db.exec(`
      ALTER TABLE user_identities ADD COLUMN display_name TEXT;
      ALTER TABLE user_identities ADD COLUMN avatar_url TEXT;
    `);
  },
};
