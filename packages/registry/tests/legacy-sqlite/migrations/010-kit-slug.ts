import type { RegistryMigration } from '../migrate-runner.js';
import { query } from '../../legacy-sqlite-query.js';

/** Self-contained copy of slugify so the migration never depends on app code
 *  that may change after this migration is frozen. Mirrors src/slug.ts. */
function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'kit'
  );
}

/**
 * Human-readable kit permalinks: kits move from `/kits/:uuid` to
 * `/kits/:owner/:slug`. Adds `kits.slug` (unique per owner) and a
 * `kit_slug_aliases` table so renames keep old URLs alive via redirect.
 *
 * Backfill derives each slug from the kit name; legacy duplicate names within
 * one owner get a `-2`, `-3`… suffix once (a one-time cleanup — going forward
 * the create/rename routes reject duplicate names so no suffix is ever minted).
 */
export const migration010KitSlug: RegistryMigration = {
  version: 10,
  name: 'kit_slug',
  up: (db) => {
    db.exec(`ALTER TABLE kits ADD COLUMN slug TEXT;`);

    const kits = query<{ id: string; owner_id: string; name: string }>(
      db,
      `SELECT id, owner_id, name FROM kits ORDER BY created_at, id`,
    );
    const usedByOwner = new Map<string, Set<string>>();
    const update = db.prepare(`UPDATE kits SET slug = ? WHERE id = ?`);
    for (const k of kits) {
      let used = usedByOwner.get(k.owner_id);
      if (!used) {
        used = new Set<string>();
        usedByOwner.set(k.owner_id, used);
      }
      const base = slugify(k.name);
      let slug = base;
      let n = 2;
      while (used.has(slug)) slug = `${base}-${n++}`;
      used.add(slug);
      update.run(slug, k.id);
    }

    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_kits_owner_slug ON kits(owner_id, slug);`);

    db.exec(`
      CREATE TABLE IF NOT EXISTS kit_slug_aliases (
        owner_id   TEXT NOT NULL,
        slug       TEXT NOT NULL,
        kit_id     TEXT NOT NULL REFERENCES kits(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (owner_id, slug)
      );
      CREATE INDEX IF NOT EXISTS idx_kit_slug_aliases_kit ON kit_slug_aliases(kit_id);
    `);
  },
};
