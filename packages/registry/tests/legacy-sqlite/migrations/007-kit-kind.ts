import type { RegistryMigration } from '../migrate-runner.js';

/**
 * Per-user "Saved" kit (the Liked-Songs of skills). A kit's `kind` tells the
 * special ones apart from hand-made bundles:
 *   - 'manual' (default): a kit the user created/curated, or a linked/synced one.
 *   - 'saved': the auto-provisioned catch-all a user's one-click "+" drops skills
 *     into. One per owner, private by default, deployable like any kit. It holds
 *     an arbitrary set (your picks), so unlike the virtual author-kit it must be
 *     a real stored kit.
 */
export const migration007KitKind: RegistryMigration = {
  version: 7,
  name: 'kit_kind',
  up: (db) => {
    db.exec(`ALTER TABLE kits ADD COLUMN kind TEXT NOT NULL DEFAULT 'manual';`);
  },
};
