import type { RegistryMigration } from '../migrate-runner.js';

/**
 * Per-machine kit routing. A device decides which kits sync to it; the sync
 * manifest is scoped to that device's selection.
 *
 * Stored as exclusions, not inclusions: a device with NO rows here syncs
 * everything (the account-wide union — exactly the prior behavior, so no
 * backfill). Turning a kit off for a machine inserts its `source_key`; a kit you
 * acquire later auto-syncs everywhere because it's in no device's exclude set.
 *
 * `source_key` is the manifest's canonical group key:
 *   - `kit:<kit_id>`   — owned / saved / subscribed / member kits
 *   - `author:self`    — your own published skills (the zero-config profile kit)
 *   - `author:<owner>` — a subscribed author kit
 *
 * ON DELETE CASCADE: removing a device drops its selection with it.
 */
export const migration015DeviceKitSync: RegistryMigration = {
  version: 15,
  name: 'device_kit_sync',
  up: (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS device_kit_excludes (
        device_id  TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        source_key TEXT NOT NULL,
        PRIMARY KEY (device_id, source_key)
      );
    `);
  },
};
