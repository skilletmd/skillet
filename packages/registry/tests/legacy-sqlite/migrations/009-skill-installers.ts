import type { RegistryMigration } from '../migrate-runner.js';

/**
 * Deduped install attestations — one install_count bump per (skill, installer).
 * Installers are session users, bearer devices, or kit-keys (see recordSkillInstall).
 */
export const migration009SkillInstallers: RegistryMigration = {
  version: 9,
  name: 'skill_installers',
  up: (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS skill_installers (
        skill_id       TEXT NOT NULL,
        installer_kind TEXT NOT NULL,
        installer_id   TEXT NOT NULL,
        installed_at   INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (skill_id, installer_kind, installer_id)
      );

      CREATE INDEX IF NOT EXISTS idx_skill_installers_skill
        ON skill_installers (skill_id);
    `);
  },
};
