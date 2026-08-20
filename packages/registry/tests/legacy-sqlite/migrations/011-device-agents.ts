import type { RegistryMigration } from '../migrate-runner.js';

/** Last-known agent runtimes detected on sync, stored per connected device. */
export const migration011DeviceAgents: RegistryMigration = {
  version: 11,
  name: 'device_agents',
  up: (db) => {
    db.exec(`
      ALTER TABLE devices ADD COLUMN detected_agents TEXT;
      ALTER TABLE devices ADD COLUMN agents_reported_at INTEGER;
    `);
  },
};
