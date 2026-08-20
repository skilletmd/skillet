import type { RegistryMigration } from '../migrate-runner.js';
import { query } from '../../legacy-sqlite-query.js';

/**
 * Additive client-kind tracking + one-time merge of provable duplicate rows.
 *
 * `client_kind` is last-writer-wins, so a machine running both the CLI and the
 * desktop app can only ever display one kind. `client_kinds` is the additive
 * set (JSON array, at most ['cli','desktop']); pair-claim and the auth
 * middleware union into it from 063 on. Backfill guarantees the column is
 * always a JSON array — the web fallback keys on the FIELD being absent from
 * the response (old registry), never on an empty array.
 *
 * The merge collapses rows sharing (user_id, machine_id): only same-machine
 * proof merges — NULL machine_ids and cross-user collisions are never touched.
 * Loser cleanup mirrors DELETE /devices: materializations deleted and sessions
 * revoked explicitly (no FK); device_kit_excludes (015) and device_skill_edits
 * (057) are ON DELETE CASCADE and clean themselves.
 */
export const migration063DevicesClientKinds: RegistryMigration = {
  version: 63,
  name: 'devices_client_kinds',
  up: (db) => {
    db.exec(`ALTER TABLE devices ADD COLUMN client_kinds TEXT`);
    db.exec(`
      UPDATE devices SET client_kinds = CASE
        WHEN client_kind IS NULL OR client_kind = '' THEN '[]'
        ELSE json_array(client_kind)
      END
    `);

    const groups = query<{ user_id: string; machine_id: string }>(
      db,
      `SELECT user_id, machine_id FROM devices
       WHERE machine_id IS NOT NULL AND machine_id != ''
       GROUP BY user_id, machine_id HAVING COUNT(*) > 1`,
    );
    if (groups.length === 0) return;

    const rowsFor = db.prepare(
      `SELECT id, client_kind FROM devices
       WHERE user_id = ? AND machine_id = ?
       ORDER BY COALESCE(last_seen_at, created_at) DESC, created_at DESC, id ASC`,
    );
    const setKinds = db.prepare(`UPDATE devices SET client_kinds = ? WHERE id = ?`);
    const deleteMaterializations = db.prepare(
      `DELETE FROM device_skill_materializations WHERE device_id = ?`,
    );
    const revokeSessions = db.prepare(
      `UPDATE sessions SET revoked_at = unixepoch() WHERE device_id = ? AND revoked_at IS NULL`,
    );
    const deleteDevice = db.prepare(`DELETE FROM devices WHERE id = ?`);

    for (const group of groups) {
      const rows = rowsFor.all(group.user_id, group.machine_id) as Array<{
        id: string;
        client_kind: string | null;
      }>;
      const winner = rows[0];
      if (!winner) continue;

      const kinds: string[] = [];
      for (const row of rows) {
        const kind = row.client_kind?.trim();
        if (kind && !kinds.includes(kind)) kinds.push(kind);
      }
      setKinds.run(JSON.stringify(kinds), winner.id);

      for (const loser of rows.slice(1)) {
        deleteMaterializations.run(loser.id);
        revokeSessions.run(loser.id);
        deleteDevice.run(loser.id);
      }
    }
  },
};
