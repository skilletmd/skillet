import type { RegistryMigration } from '../migrate-runner.js';

/**
 * The IdP username (GitHub login, X handle) so a connected account can surface a
 * public profile link (github.com/<login>, x.com/<handle>). Previously this was
 * captured from the OAuth profile only to pre-fill the handle at sign-up, then
 * discarded. Nullable: Google has no public handle, and existing rows backfill
 * on the owner's next sign-in / link (upsert writes it on conflict).
 *
 * (The verified-email lookup index lives in migration 026, not here — this
 * migration had already shipped/applied before the index was needed, and an
 * applied migration's up() never re-runs.)
 */
export const migration025IdentityProviderLogin: RegistryMigration = {
  version: 25,
  name: 'identity_provider_login',
  up: (db) => {
    db.exec(`
      ALTER TABLE user_identities ADD COLUMN provider_login TEXT;
    `);
  },
};
