import type { RegistryMigration } from '../migrate-runner.js'
import { query } from '../../legacy-sqlite-query.js'

/** Monotonic cursor for device sync push per user. */
export const migration062UserDeviceSyncSeq: RegistryMigration = {
  version: 62,
  name: 'user_device_sync_seq',
  up: (db) => {
    const cols = query<{ name: string }>(db, `PRAGMA table_info(users)`)
    if (!cols.some((c) => c.name === 'device_sync_seq')) {
      db.exec(`ALTER TABLE users ADD COLUMN device_sync_seq INTEGER NOT NULL DEFAULT 0`)
    }
  },
}
