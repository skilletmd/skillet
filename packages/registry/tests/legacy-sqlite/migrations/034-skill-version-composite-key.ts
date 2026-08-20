import type { RegistryMigration } from '../migrate-runner.js'
import { query } from '../../legacy-sqlite-query.js'

/**
 * Re-key `skill_versions` from a GLOBAL `hash` primary key to a per-skill
 * composite `(skill_id, hash)`.
 *
 * Why: `hash` being globally unique meant two different skills could never own
 * a version row for the same content hash. A second skill publishing or syncing
 * a byte-identical bundle silently lost its row (`ON CONFLICT(hash) DO NOTHING`)
 * while `latest_hash` still advanced — corruption — and the publish/approval
 * idempotency checks short-circuited across skills. Content-addressed *blob*
 * storage stays global (`blobs.hash`, `skill_version_files.blob_hash`); only the
 * version *association* becomes per-skill.
 *
 * `hash` is the FK target for four tables, so each must carry `skill_id` and
 * reference the composite key: `skill_version_files`, `skill_version_scans`,
 * `skill_version_provenance`, and `kit_skills.pinned_hash` (which already has
 * `skill_id`). This is a SQLite table-rebuild. `PRAGMA foreign_keys` can't be
 * toggled inside the migrate-runner's open transaction, so we defer FK
 * enforcement to COMMIT with `defer_foreign_keys` instead and assert
 * `foreign_key_check` before returning. The pre-034 global-unique `hash`
 * guarantees each child→parent join is 1:1, so `skill_id` backfills cleanly.
 *
 * `skill_version_scans` carries `capabilities_json` (032) and
 * `capabilities_version` (033) on top of the baseline, so the rebuilt table
 * reflects the CURRENT shape, not the baseline CREATE.
 */
export const migration034SkillVersionCompositeKey: RegistryMigration = {
  version: 34,
  name: 'skill_version_composite_key',
  up: (db) => {
    db.exec('PRAGMA defer_foreign_keys = ON;')

    db.exec(`
      -- 1. New parent: per-skill composite primary key. Columns unchanged.
      -- Full CURRENT column set: the baseline 9 plus delegation_json,
      -- yanked_at, yank_reason (added by ALTERs in the baseline migration).
      -- Missing any of these here would silently drop data (e.g. yank state).
      CREATE TABLE skill_versions_new (
        hash             TEXT NOT NULL,
        skill_id         TEXT NOT NULL REFERENCES skills(id),
        signature_alg    TEXT,
        signature_key_id TEXT,
        signature_b64    TEXT,
        author_key_id    TEXT,
        metadata_json    TEXT NOT NULL DEFAULT '{}',
        published_at     INTEGER NOT NULL DEFAULT (unixepoch()),
        published_by     TEXT NOT NULL REFERENCES authors(id),
        delegation_json  TEXT,
        yanked_at        INTEGER,
        yank_reason      TEXT,
        PRIMARY KEY (skill_id, hash)
      );
      INSERT INTO skill_versions_new
        (hash, skill_id, signature_alg, signature_key_id, signature_b64,
         author_key_id, metadata_json, published_at, published_by,
         delegation_json, yanked_at, yank_reason)
        SELECT hash, skill_id, signature_alg, signature_key_id, signature_b64,
               author_key_id, metadata_json, published_at, published_by,
               delegation_json, yanked_at, yank_reason
        FROM skill_versions;

      -- 2. Capture each child's rows WITH the resolved skill_id into FK-free
      -- temp tables, joining the still-present OLD skill_versions (hash was
      -- globally unique pre-034 ⇒ 1:1 join). We can't create the new children
      -- with their composite FK yet, because "skill_versions" is still the old
      -- single-column-keyed table — a composite FK to it is a "foreign key
      -- mismatch". So hold the data, swap the parent, then build children.
      CREATE TEMP TABLE _files AS
        SELECT sv.skill_id AS skill_id, f.version_hash, f.path, f.blob_hash
        FROM skill_version_files f JOIN skill_versions sv ON sv.hash = f.version_hash;
      CREATE TEMP TABLE _scans AS
        SELECT sv.skill_id AS skill_id, s.skill_version_id, s.status, s.findings_json,
               s.scanned_at, s.capabilities_json, s.capabilities_version
        FROM skill_version_scans s JOIN skill_versions sv ON sv.hash = s.skill_version_id;
      CREATE TEMP TABLE _prov AS
        SELECT sv.skill_id AS skill_id, p.version_hash, p.proposed_by, p.approved_by, p.proposal_id
        FROM skill_version_provenance p JOIN skill_versions sv ON sv.hash = p.version_hash;
      CREATE TEMP TABLE _kit AS
        SELECT kit_id, skill_id, pinned_hash, added_at FROM kit_skills;

      -- 3. Drop old children + parent, swap the composite parent into place.
      DROP TABLE skill_version_files;
      DROP TABLE skill_version_scans;
      DROP TABLE skill_version_provenance;
      DROP TABLE kit_skills;
      DROP TABLE skill_versions;
      ALTER TABLE skill_versions_new RENAME TO skill_versions;

      -- 4. Build the children against the now-composite parent, refill from temp.
      CREATE TABLE skill_version_files (
        skill_id     TEXT NOT NULL,
        version_hash TEXT NOT NULL,
        path         TEXT NOT NULL,
        blob_hash    TEXT NOT NULL REFERENCES blobs(hash),
        PRIMARY KEY (skill_id, version_hash, path),
        FOREIGN KEY (skill_id, version_hash)
          REFERENCES skill_versions(skill_id, hash) ON DELETE CASCADE
      );
      INSERT INTO skill_version_files (skill_id, version_hash, path, blob_hash)
        SELECT skill_id, version_hash, path, blob_hash FROM _files;

      CREATE TABLE skill_version_scans (
        skill_id             TEXT NOT NULL,
        skill_version_id     TEXT NOT NULL,
        status               TEXT NOT NULL,
        findings_json        TEXT NOT NULL DEFAULT '[]',
        scanned_at           INTEGER,
        capabilities_json    TEXT,
        capabilities_version INTEGER,
        PRIMARY KEY (skill_id, skill_version_id),
        FOREIGN KEY (skill_id, skill_version_id)
          REFERENCES skill_versions(skill_id, hash) ON DELETE CASCADE
      );
      INSERT INTO skill_version_scans
        (skill_id, skill_version_id, status, findings_json, scanned_at,
         capabilities_json, capabilities_version)
        SELECT skill_id, skill_version_id, status, findings_json, scanned_at,
               capabilities_json, capabilities_version FROM _scans;

      CREATE TABLE skill_version_provenance (
        skill_id     TEXT NOT NULL,
        version_hash TEXT NOT NULL,
        proposed_by  TEXT NOT NULL REFERENCES authors(id),
        approved_by  TEXT NOT NULL REFERENCES authors(id),
        proposal_id  TEXT REFERENCES skill_proposals(id),
        PRIMARY KEY (skill_id, version_hash),
        FOREIGN KEY (skill_id, version_hash)
          REFERENCES skill_versions(skill_id, hash) ON DELETE CASCADE
      );
      INSERT INTO skill_version_provenance
        (skill_id, version_hash, proposed_by, approved_by, proposal_id)
        SELECT skill_id, version_hash, proposed_by, approved_by, proposal_id FROM _prov;

      -- kit_skills already had skill_id; only pinned_hash's FK becomes composite.
      -- A NULL pinned_hash (track-latest) keeps the composite FK satisfied.
      CREATE TABLE kit_skills (
        kit_id      TEXT NOT NULL REFERENCES kits(id) ON DELETE CASCADE,
        skill_id    TEXT NOT NULL REFERENCES skills(id),
        pinned_hash TEXT,
        added_at    INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (kit_id, skill_id),
        FOREIGN KEY (skill_id, pinned_hash)
          REFERENCES skill_versions(skill_id, hash)
      );
      INSERT INTO kit_skills (kit_id, skill_id, pinned_hash, added_at)
        SELECT kit_id, skill_id, pinned_hash, added_at FROM _kit;

      DROP TABLE _files;
      DROP TABLE _scans;
      DROP TABLE _prov;
      DROP TABLE _kit;

      -- 5. Recreate the only index on the rebuilt tables.
      CREATE INDEX IF NOT EXISTS idx_skill_version_files_blob
        ON skill_version_files (blob_hash);
    `)

    // 6. Fail loud on any dangling reference before the runner's deferred
    // COMMIT check, so a bad rebuild rolls back with a clear message.
    const violations = query<unknown>(db, 'PRAGMA foreign_key_check;')
    if (violations.length > 0) {
      throw new Error(
        `migration 034: foreign_key_check reported ${violations.length} violation(s) after the composite-key rebuild`,
      )
    }
  },
}
