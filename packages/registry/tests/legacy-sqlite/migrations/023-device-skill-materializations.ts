import type { RegistryMigration } from '../migrate-runner.js';

/**
 * Per-skill, per-runtime materialization status reported by a device after sync.
 * Powers the first-run "watch it land" moment: the web reads the true result
 * (materialized / failed) for a just-added skill across the device's runtimes.
 */
export const migration023DeviceSkillMaterializations: RegistryMigration = {
  version: 23,
  name: 'device_skill_materializations',
  up: (db) => {
    db.exec(`
      CREATE TABLE device_skill_materializations (
        device_id   TEXT NOT NULL,
        skill_slug  TEXT NOT NULL,
        runtime     TEXT NOT NULL,
        status      TEXT NOT NULL,
        reported_at INTEGER NOT NULL,
        PRIMARY KEY (device_id, skill_slug, runtime)
      );
      CREATE INDEX idx_dsm_device_reported
        ON device_skill_materializations (device_id, reported_at);
    `);
  },
};
