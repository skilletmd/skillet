import type { RegistryMigration } from '../migrate-runner.js';

/**
 * Kit moderation + featured flags for admin hide/feature.
 *
 *   1. `kits.moderation_status` — the kit analogue of `skills.moderation_status`,
 *      but only two states (`none | hidden`). Kits don't need a download-blocking
 *      "quarantine" tier, so two states suffice. Public kit browse (discover +
 *      author profile) excludes on `hidden`; the owner's own management views do
 *      not filter. Plain ADD COLUMN; existing rows default to `none`.
 *
 *   2. `skills.is_featured` / `kits.is_featured` — a manual boolean an admin sets
 *      to float an item to the top of its catalog. The catalog `ORDER BY`s
 *      prepend `is_featured DESC` so featured items lead the default sort (and
 *      thus the home/browse "Featured" slices). Default 0.
 */
export const migration044KitModerationAndFeatured: RegistryMigration = {
  version: 44,
  name: 'kit_moderation_and_featured',
  up: (db) => {
    db.exec(`
      ALTER TABLE kits ADD COLUMN moderation_status TEXT NOT NULL DEFAULT 'none'
        CHECK (moderation_status IN ('none','hidden'));
    `);
    db.exec(`ALTER TABLE skills ADD COLUMN is_featured INTEGER NOT NULL DEFAULT 0;`);
    db.exec(`ALTER TABLE kits ADD COLUMN is_featured INTEGER NOT NULL DEFAULT 0;`);
  },
};
