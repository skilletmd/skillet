import type { RegistryMigration } from '../migrate-runner.js';

/**
 * Index backing userIdByVerifiedEmail. The verified-email auto-link (and the
 * reassignment-poisoning guard) run `lower(email) = lower(?) AND email_verified = 1`
 * on every unseen sign-in; the only other index on user_identities is on user_id,
 * which can't serve that filter. A partial expression index keyed on lower(email)
 * over just the verified rows turns the cold full scan into a seek and stays small.
 *
 * Separate from migration 025 (which added provider_login) because 025 had already
 * applied in some environments before this index was needed, and an applied
 * migration's up() never re-runs. IF NOT EXISTS keeps it a no-op on any DB that
 * happened to get the index via an earlier in-place 025.
 */
export const migration026IdentityEmailIndex: RegistryMigration = {
  version: 26,
  name: 'identity_email_index',
  up: (db) => {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_user_identities_lower_email_verified
        ON user_identities (lower(email))
        WHERE email IS NOT NULL AND email_verified = 1;
    `);
  },
};
