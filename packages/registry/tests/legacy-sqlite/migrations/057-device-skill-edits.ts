import type { RegistryMigration } from '../migrate-runner.js';

/**
 * Per-device edit flag for locally-customized skills, reconciled from the
 * device's post-sync report. One row per (device, skill) records only the bare
 * fact of the edit and its lineage baseline (version + content hash) — never the
 * edited content, filenames, or line counts, which stay private to the machine.
 *
 * The device reports the full set of currently-customized skills every sync; the
 * registry reconciles this table to exactly that set (upsert reported, delete the
 * rest), so the flag clears by absence when a skill un-customizes (take-theirs,
 * restore-original, or the edit reverting to canonical). UNIQUE(device_id,
 * skill_id) keeps the report idempotent. FKs cascade so a device/user teardown
 * removes its edit flags with no orphan rows.
 */
export const migration057DeviceSkillEdits: RegistryMigration = {
  version: 57,
  name: 'device_skill_edits',
  up: (db) => {
    db.exec(`
      CREATE TABLE device_skill_edits (
        device_id        TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        skill_id         TEXT NOT NULL,
        baseline_version TEXT,
        baseline_hash    TEXT NOT NULL,
        edited_at        INTEGER NOT NULL DEFAULT (unixepoch()),
        UNIQUE (device_id, skill_id)
      );
      CREATE INDEX idx_device_skill_edits_user
        ON device_skill_edits (user_id, skill_id);
    `);
  },
};
