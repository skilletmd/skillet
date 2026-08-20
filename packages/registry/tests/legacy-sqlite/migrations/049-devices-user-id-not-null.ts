import type { RegistryMigration } from '../migrate-runner.js'
import { query } from '../../legacy-sqlite-query.js'

/**
 * Anonymous devices retired (U6): delete the null-user device rows, then
 * rebuild `devices` with `user_id TEXT NOT NULL` so the schema itself makes an
 * account-less device impossible. /signup stopped minting these (410
 * tombstone) and the manifest fails closed on them; this is the final,
 * structural enforcement of "every device belongs to an account".
 *
 * SQLite can't ALTER a column to NOT NULL, so this is a table-rebuild (034/037
 * pattern). The migrate-runner holds one open transaction and
 * `PRAGMA foreign_keys` can't be toggled inside it, so FK enforcement is
 * deferred to COMMIT with `defer_foreign_keys` and `foreign_key_check` is
 * asserted before returning.
 *
 * Children of a device row (FK reality as of 048):
 *   - device_kit_excludes (015): FK to devices(id) ON DELETE CASCADE.
 *   - device_skill_materializations (023): `device_id` carries NO foreign key.
 * Both are deleted explicitly for the anon rows — deterministic regardless of
 * the connection's foreign_keys pragma. `sessions.device_id` (045) and
 * `events.device_id` (014) are FK-free and never referenced anon devices
 * (sessions are pair-minted; anon devices could not pair).
 *
 * CRITICAL (the 037 lesson): `DROP TABLE devices` performs an implicit DELETE
 * that FIRES the `ON DELETE CASCADE` on device_kit_excludes, wiping the
 * surviving paired-device exclusions — so they are snapshotted to a TEMP table
 * before the drop and restored after the rename.
 */

/**
 * The full live column set: baseline (legacy-migrate) `id, token_hash,
 * user_id, label, created_at, last_seen_at` plus 011 (`detected_agents`,
 * `agents_reported_at`), 024 (`client_kind`), 036 (`client_platform`).
 * Asserted against PRAGMA table_info at run time so a later devices ALTER
 * landing before 049 in a fresh clone fails loud instead of silently dropping
 * its column in the rebuild.
 */
const DEVICE_COLUMNS = [
  'id',
  'token_hash',
  'user_id',
  'label',
  'created_at',
  'last_seen_at',
  'detected_agents',
  'agents_reported_at',
  'client_kind',
  'client_platform',
]

export const migration049DevicesUserIdNotNull: RegistryMigration = {
  version: 49,
  name: 'devices_user_id_not_null',
  up: (db) => {
    db.exec('PRAGMA defer_foreign_keys = ON;')

    // Drift guard: the rebuild DDL below must carry EXACTLY the live columns.
    const live = query<{ name: string }>(db, 'PRAGMA table_info(devices)').map((c) => c.name)
    if (
      live.length !== DEVICE_COLUMNS.length ||
      DEVICE_COLUMNS.some((col, i) => live[i] !== col)
    ) {
      throw new Error(
        `migration 049: devices columns drifted from the expected set — live: [${live.join(', ')}]`,
      )
    }

    // Capture every named index on devices (currently idx_devices_user_id)
    // from sqlite_master so the rebuild preserves future additions too.
    // Autoindexes (PK, token_hash UNIQUE) are recreated by the DDL itself.
    const indexes = query<{ sql: string }>(
      db,
      "SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'devices' AND sql IS NOT NULL",
    )

    const cols = DEVICE_COLUMNS.join(', ')
    db.exec(`
      -- 1. Delete anon devices and their children (see header for FK reality).
      DELETE FROM device_skill_materializations
        WHERE device_id IN (SELECT id FROM devices WHERE user_id IS NULL);
      DELETE FROM device_kit_excludes
        WHERE device_id IN (SELECT id FROM devices WHERE user_id IS NULL);
      DELETE FROM devices WHERE user_id IS NULL;

      -- 2. Rebuild: same columns in the same order, user_id now NOT NULL.
      CREATE TABLE devices_new (
        id                 TEXT PRIMARY KEY,
        token_hash         TEXT NOT NULL UNIQUE,
        user_id            TEXT NOT NULL REFERENCES users(id),
        label              TEXT,
        created_at         INTEGER NOT NULL DEFAULT (unixepoch()),
        last_seen_at       INTEGER,
        detected_agents    TEXT,
        agents_reported_at INTEGER,
        client_kind        TEXT,
        client_platform    TEXT
      );
      INSERT INTO devices_new (${cols}) SELECT ${cols} FROM devices;

      -- 3. Snapshot the CASCADE child, drop, rename, restore (header CRITICAL).
      -- device_kit_excludes references "devices" by NAME, so its FK re-resolves
      -- against the renamed table.
      CREATE TEMP TABLE _dke_backup AS SELECT * FROM device_kit_excludes;
      DROP TABLE devices;
      ALTER TABLE devices_new RENAME TO devices;
      -- No-op when the drop's cascade fired; makes the restore deterministic
      -- on a connection running with foreign_keys OFF (where it didn't).
      DELETE FROM device_kit_excludes;
      INSERT INTO device_kit_excludes SELECT * FROM _dke_backup;
      DROP TABLE _dke_backup;
    `)

    // 4. Recreate the named indexes captured above.
    for (const { sql } of indexes) db.exec(sql)

    // 5. Fail loud on any dangling reference before the runner's deferred
    // COMMIT check, so a bad rebuild rolls back with a clear message.
    const violations = query<unknown>(db, 'PRAGMA foreign_key_check;')
    if (violations.length > 0) {
      throw new Error(
        `migration 049: foreign_key_check reported ${violations.length} violation(s) after the devices rebuild`,
      )
    }
  },
}
