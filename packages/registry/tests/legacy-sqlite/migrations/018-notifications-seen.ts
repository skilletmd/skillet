import type { RegistryMigration } from '../migrate-runner.js';
import { query } from '../../legacy-sqlite-query.js';

/**
 * Per-user "notifications seen" cursor. Unread notifications are computed as the
 * inbound activity events (someone followed you / added your kit / subscribed to
 * your skills) newer than this timestamp. Null = never opened the notifications
 * page, so everything is unread. Advancing it on view clears the nav bell count.
 * One timestamp, not per-row read state — activity notifications don't need
 * per-item dismiss.
 */
export const migration018NotificationsSeen: RegistryMigration = {
  version: 18,
  name: 'notifications_seen',
  up: (db) => {
    const cols = query<{ name: string }>(db, `PRAGMA table_info(users)`);
    if (!cols.some((c) => c.name === 'notifications_seen_at')) {
      db.exec(`ALTER TABLE users ADD COLUMN notifications_seen_at INTEGER`);
    }
  },
};
