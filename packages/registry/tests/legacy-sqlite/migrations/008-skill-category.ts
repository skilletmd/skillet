import type { RegistryMigration } from '../migrate-runner.js';

/**
 * Auto-assigned browse category for a skill (one of the closed taxonomy keys —
 * see src/categories.ts). Null until classified. Only public skills are ever
 * classified (private content never goes to the classifier), so a null category
 * means either "private" or "not yet classified". Drives Browse-by-category and
 * the category color family on the web.
 */
export const migration008SkillCategory: RegistryMigration = {
  version: 8,
  name: 'skill_category',
  up: (db) => {
    db.exec(`ALTER TABLE skills ADD COLUMN category TEXT;`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_skills_category ON skills(category);`);
  },
};
