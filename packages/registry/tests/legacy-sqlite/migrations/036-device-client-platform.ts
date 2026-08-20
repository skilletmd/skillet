import type { RegistryMigration } from '../migrate-runner.js';

/** Host OS for desktop pairs: macOS vs Windows menubar app. */
export const migration036DeviceClientPlatform: RegistryMigration = {
  version: 36,
  name: 'device_client_platform',
  up: (db) => {
    db.exec(`
      ALTER TABLE devices ADD COLUMN client_platform TEXT;
    `);
  },
};
