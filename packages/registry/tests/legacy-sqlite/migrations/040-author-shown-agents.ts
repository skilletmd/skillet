import type { RegistryMigration } from '../migrate-runner.js';

/**
 * Per-author curated list of agents to show on the public profile.
 *
 * Today the "Runs on" row is derived: the union of every connected device's
 * `detected_agents`, gated by the single `agents_public` boolean. This column
 * lets the user curate the row instead — a JSON array of runtime keys to display.
 *
 *   NULL          → uncurated. Fall back to the legacy behavior (detected union
 *                   when `agents_public`, else nothing). No lossy backfill.
 *   '[]'          → curated to show nothing.
 *   '["cursor"]'  → show exactly these keys; each is marked "verified" at read
 *                   time when it also appears in the device-detected union.
 *
 * Plain ADD COLUMN (no rebuild); nullable with no default so NULL stays the
 * meaningful "uncurated" state.
 */
export const migration040AuthorShownAgents: RegistryMigration = {
  version: 40,
  name: 'author_shown_agents',
  up: (db) => {
    db.exec(`ALTER TABLE authors ADD COLUMN shown_agents TEXT;`);
  },
};
