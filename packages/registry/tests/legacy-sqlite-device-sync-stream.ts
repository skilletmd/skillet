// Quarantined sqlite device-sync-stream helpers for characterization under tests/ (U5).
import type { DatabaseSync } from '../src/db/sqlite-handle.js'
import { queryOne } from './legacy-sqlite-query.js'
import {
  emitDeviceSyncRequired,
  subscribeDeviceSyncStream,
  type DeviceSyncSnapshot,
} from '../src/lib/device-sync-stream.js'

export type { DeviceSyncSnapshot }
export { subscribeDeviceSyncStream }

export function readDeviceSyncSnapshot(db: DatabaseSync, userId: string): DeviceSyncSnapshot | null {
  const row = queryOne<{ seq: number }>(
    db,
    'SELECT device_sync_seq AS seq FROM users WHERE id = ?',
    userId,
  )
  return row ? { seq: row.seq } : null
}

/** Bump a user's device-sync cursor and fan out to any live device streams. */
export function bumpUserDeviceSync(db: DatabaseSync, userId: string): DeviceSyncSnapshot | null {
  if (!userId) return null
  db.prepare('UPDATE users SET device_sync_seq = device_sync_seq + 1 WHERE id = ?').run(userId)
  const snapshot = readDeviceSyncSnapshot(db, userId)
  if (!snapshot) return null
  emitDeviceSyncRequired(userId, snapshot.seq)
  return snapshot
}
