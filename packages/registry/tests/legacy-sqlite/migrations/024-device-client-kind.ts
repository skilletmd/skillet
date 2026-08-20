import type { RegistryMigration } from '../migrate-runner.js';

/** How the machine joined: CLI (`skillet connect`) vs desktop menubar app. */
export const migration024DeviceClientKind: RegistryMigration = {
  version: 24,
  name: 'device_client_kind',
  up: (db) => {
    db.exec(`
      ALTER TABLE devices ADD COLUMN client_kind TEXT;
    `);
  },
};
