import type { RegistryMigration } from '../migrate-runner.js';

/**
 * Link pair-minted sessions to the device the claim bound, so deleting a
 * device (web → Settings → Devices) can revoke the session it minted and a
 * removed machine loses publish/upload, not just sync.
 *
 * Nullable by design: web-login and Connect-wizard sessions carry no
 * device_id and are never touched by device deletion. Sessions minted before
 * this migration stay NULL — no linkage data exists to backfill, so they
 * decay via their natural TTL (accepted decay window, see the device
 * revocation plan's Scope Boundaries).
 */
export const migration045SessionDeviceLink: RegistryMigration = {
  version: 45,
  name: 'session_device_link',
  up: (db) => {
    db.exec(`
      ALTER TABLE sessions ADD COLUMN device_id TEXT;
    `);
  },
};
