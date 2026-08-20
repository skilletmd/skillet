import type { RegistryMigration } from '../migrate-runner.js';

/**
 * Platform admin flag. A small set of trusted operators who can take
 * site-wide moderation actions (suspend spam accounts) and hand a seeded
 * mirror handle to its real brand owner. Distinct from org roles, which are
 * scoped to a single org. Bootstrap admins can also be named by env
 * (`SKILLET_ADMIN_HANDLES`) so the first admin exists before any DB edit.
 */
export const migration013UserIsAdmin: RegistryMigration = {
  version: 13,
  name: 'user_is_admin',
  up: (db) => {
    db.exec(`ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;`);
  },
};
