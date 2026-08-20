import type { RegistryMigration } from '../migrate-runner.js';

/** Per-author toggle: whether the "Runs" (detected agents) row is public.
 *  Default on — the deduped runtime list is low-sensitivity social proof; this
 *  lets a user hide it. Machine-level device detail is never public regardless. */
export const migration012AgentsPublic: RegistryMigration = {
  version: 12,
  name: 'agents_public',
  up: (db) => {
    db.exec(`ALTER TABLE authors ADD COLUMN agents_public INTEGER NOT NULL DEFAULT 1;`);
  },
};
