import type { RegistryMigration } from '../migrate-runner.js';
import { query } from '../../legacy-sqlite-query.js';

/** Self-contained copy of slugify (mirrors src/slug.ts) so the migration stays
 *  a frozen snapshot independent of app code. */
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
 * One-time backfill: mint slugs for kits created without one.
 *
 * The repo-sync engine (sync/sync-repo.ts ensureLinkedKit) inserted linked
 * kits with no slug column, so every mirror-crawled kit had slug NULL. The
 * slug is the public permalink — kitHref built `/{owner}/kit/null` and the
 * legacy `/kits/:uuid` redirect landed on a 404. The insert now slugifies at
 * create time; this stamps the rows that predate the fix.
 *
 * Same derivation as migration 010's original backfill: slug from the kit
 * name, deduped per owner with a -2, -3… suffix against live slugs and
 * aliases. Idempotent — a second run finds no NULL rows.
 */
export const migration059BackfillLinkedKitSlugs: RegistryMigration = {
  version: 59,
  name: 'backfill_linked_kit_slugs',
  up: (db) => {
    const kits = query<{ id: string; owner_id: string; name: string }>(
      db,
      `SELECT id, owner_id, name FROM kits WHERE slug IS NULL OR slug = '' ORDER BY created_at, id`,
    );
    if (kits.length === 0) return;

    const taken = db.prepare(
      `SELECT 1 FROM kits WHERE owner_id = ? AND slug = ?
       UNION ALL
       SELECT 1 FROM kit_slug_aliases WHERE owner_id = ? AND slug = ?`,
    );
    const update = db.prepare(`UPDATE kits SET slug = ? WHERE id = ?`);
    for (const k of kits) {
      const base = slugify(k.name);
      let slug = base;
      let n = 2;
      while (taken.get(k.owner_id, slug, k.owner_id, slug)) slug = `${base}-${n++}`;
      update.run(slug, k.id);
    }
  },
};
