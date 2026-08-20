import type { RegistryMigration } from '../migrate-runner.js'
import { query } from '../../legacy-sqlite-query.js'

/**
 * Brand mirrors → orgs: support an UNCLAIMED organization.
 *
 * The converter (scripts/migrate-brand-mirrors-to-orgs.ts) turns existing
 * org-source mirror authors into Skillet orgs *in place* but leaves them
 * UNCLAIMED until a real GitHub admin claims them — so the `organizations` row
 * exists with NO owner: no `owner_user_id` and no `organization_members` owner
 * row. The baseline table declares `owner_user_id TEXT NOT NULL`, which cannot
 * hold that ownerless state, so this migration relaxes it to nullable.
 *
 * It also adds `source_owner_id` (the GitHub numeric id of the source org owner,
 * captured at seed/convert time) so a later source-repo transfer to a
 * *different* owner id is detectable at claim time (KTD9 re-bind guard), not
 * just a login rename.
 *
 * Pure schema only — NO network I/O. Deciding which mirrors are Organization vs
 * User owners needs a GitHub lookup, so the durable data backfill lives in the
 * re-runnable script, not here. Safe to run with zero org-source mirrors.
 *
 * SQLite can't ALTER a column's NOT NULL away, so relaxing `owner_user_id` is a
 * table-rebuild. The migrate-runner holds one open transaction and
 * `PRAGMA foreign_keys` can't be toggled inside it, so we defer FK enforcement
 * to COMMIT with `defer_foreign_keys`.
 *
 * CRITICAL: `defer_foreign_keys` defers violation *checking*, not cascade
 * *actions*. A bare `DROP TABLE organizations` performs an implicit DELETE of
 * every row, which FIRES the `ON DELETE CASCADE` on `organization_members` and
 * `organization_invites` (wiping them) and leaves the NO-ACTION refs
 * `kits.org_id` / `skills.org_id` dangling — which wedges the deferred-FK counter
 * so COMMIT fails even though `foreign_key_check` reports clean. (Empirically
 * reproduced; the 034 precedent does not transfer because `skill_versions` had no
 * incoming FK references.) So before the DROP we remove every reference to
 * `organizations`: snapshot the two CASCADE children into TEMP tables and NULL the
 * two NO-ACTION columns; after the rename (org `id`s preserved) we restore all
 * four. Result: zero data loss, clean COMMIT.
 */
export const migration037BrandMirrorsToOrgs: RegistryMigration = {
  version: 37,
  name: 'brand_mirrors_to_orgs',
  up: (db) => {
    db.exec('PRAGMA defer_foreign_keys = ON;')

    db.exec(`
      -- Rebuild organizations: owner_user_id becomes NULLable (ownerless =
      -- unclaimed brand) and add source_owner_id (GitHub numeric owner id).
      CREATE TABLE organizations_new (
        id              TEXT PRIMARY KEY,
        slug            TEXT NOT NULL UNIQUE,
        name            TEXT NOT NULL,
        owner_user_id   TEXT REFERENCES users(id),
        source_owner_id INTEGER,
        created_at      INTEGER NOT NULL DEFAULT (unixepoch())
      );
      INSERT INTO organizations_new (id, slug, name, owner_user_id, created_at)
        SELECT id, slug, name, owner_user_id, created_at FROM organizations;

      -- Detach every reference to organizations BEFORE the drop (see header):
      -- snapshot the CASCADE children, NULL the NO-ACTION columns.
      CREATE TEMP TABLE _om_backup AS SELECT * FROM organization_members;
      CREATE TEMP TABLE _oi_backup AS SELECT * FROM organization_invites;
      CREATE TEMP TABLE _kits_org_backup AS SELECT id, org_id FROM kits WHERE org_id IS NOT NULL;
      CREATE TEMP TABLE _skills_org_backup AS SELECT id, org_id FROM skills WHERE org_id IS NOT NULL;
      UPDATE kits SET org_id = NULL WHERE org_id IS NOT NULL;
      UPDATE skills SET org_id = NULL WHERE org_id IS NOT NULL;

      DROP TABLE organizations;
      ALTER TABLE organizations_new RENAME TO organizations;

      -- Restore all four references (org ids are preserved, so they re-resolve).
      INSERT INTO organization_members SELECT * FROM _om_backup;
      INSERT INTO organization_invites SELECT * FROM _oi_backup;
      UPDATE kits SET org_id = (SELECT b.org_id FROM _kits_org_backup b WHERE b.id = kits.id)
        WHERE id IN (SELECT id FROM _kits_org_backup);
      UPDATE skills SET org_id = (SELECT b.org_id FROM _skills_org_backup b WHERE b.id = skills.id)
        WHERE id IN (SELECT id FROM _skills_org_backup);
      DROP TABLE _om_backup;
      DROP TABLE _oi_backup;
      DROP TABLE _kits_org_backup;
      DROP TABLE _skills_org_backup;

      CREATE INDEX IF NOT EXISTS idx_organizations_slug ON organizations (slug);
    `)

    // Fail loud on any dangling reference before the runner's deferred COMMIT
    // check, so a bad rebuild rolls back with a clear message.
    const violations = query<unknown>(db, 'PRAGMA foreign_key_check;')
    if (violations.length > 0) {
      throw new Error(
        `migration 037: foreign_key_check reported ${violations.length} violation(s) after the organizations rebuild`,
      )
    }
  },
}
