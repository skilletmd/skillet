import type { RegistryMigration } from '../migrate-runner.js';

/**
 * Stable client-minted machine identity for pair-claim reclaim.
 *
 * The rebind path in /connect/claim is keyed on device-token possession alone,
 * so a machine whose local token is lost or clobbered (dev-registry pairing,
 * wiped ~/.skillet) mints a duplicate device row on every re-pair. machine_id
 * survives token loss client-side and lets a claim reclaim the SAME user's
 * existing row for that machine instead of duplicating it.
 */
export const migration060DevicesMachineId: RegistryMigration = {
  version: 60,
  name: 'devices_machine_id',
  up: (db) => {
    db.exec(`
      ALTER TABLE devices ADD COLUMN machine_id TEXT;
      CREATE INDEX IF NOT EXISTS idx_devices_user_machine ON devices(user_id, machine_id);
    `);
  },
};
