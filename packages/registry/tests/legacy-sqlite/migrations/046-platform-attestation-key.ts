import type { RegistryMigration } from '../migrate-runner.js';

/**
 * Platform attestation key storage. The registry signs versions it produces
 * itself (GitHub mirrors, seeds) with a platform-held Ed25519 key so device
 * sync can verify them like any author-signed version. Without it, mirrored
 * content carries no signature and every pull rejects it with
 * `unsigned_version` — the web (which does not verify) shows the kits fine
 * while devices silently sync nothing.
 */
export const migration046PlatformAttestationKey: RegistryMigration = {
  version: 46,
  name: 'platform_attestation_key',
  up: (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS platform_keys (
        purpose     TEXT PRIMARY KEY,
        key_id      TEXT NOT NULL,
        public_key  TEXT NOT NULL,
        secret_pem  TEXT NOT NULL,
        created_at  INTEGER NOT NULL DEFAULT (unixepoch())
      );
    `);
  },
};
