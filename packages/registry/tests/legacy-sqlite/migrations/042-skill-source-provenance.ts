import type { RegistryMigration } from '../migrate-runner.js';

/**
 * Per-skill source provenance on the `skills` row.
 *
 * A skill can reach the catalog two ways that point back to the same GitHub
 * source: a one-time IMPORT published under the importer's handle, or a synced
 * MIRROR published under the owner's derived handle. Until now only mirrors
 * recorded their origin (in `skill_mirrors`), so an imported copy carried no
 * pointer to where it came from — the two were unlinkable.
 *
 * Two columns, matching the pair `skill_mirrors` already stores:
 *   - `source_repo` — the `owner/repo` (e.g. `mattpocock/skills`). The MATCH KEY:
 *     "does an official mirror exist for this repo?" compares on this, so the
 *     directory can hide a redundant copy when the canonical mirror is present.
 *   - `source_url`  — the specific source directory
 *     (…/tree/<ref>/skills/engineering/domain-modeling). Exact provenance for
 *     display and precise dedupe.
 *
 * Plain ADD COLUMN (no rebuild). Existing rows default to NULL ("unknown
 * origin"), which every consumer treats as "not import/mirror-linked."
 */
export const migration042SkillSourceProvenance: RegistryMigration = {
  version: 42,
  name: 'skill_source_provenance',
  up: (db) => {
    db.exec(`ALTER TABLE skills ADD COLUMN source_repo TEXT;`);
    db.exec(`ALTER TABLE skills ADD COLUMN source_url TEXT;`);
  },
};
