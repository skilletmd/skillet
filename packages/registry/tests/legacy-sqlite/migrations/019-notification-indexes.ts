import type { RegistryMigration } from '../migrate-runner.js';

/**
 * Indexes for the notifications inverse queries. The "subscribed to your kit" and
 * "subscribed to your skills" lookups filter kit_subscriptions by kit_id / author_id
 * + kind, ordered by created_at — but the existing partial indexes are user_id-first,
 * so those predicates fell back to a full table scan. These cover the access path
 * (equality on the leading column + the created_at range/order used by the unread
 * cursor), and run on a hot path: the nav bell polls the unread count on every
 * authenticated navigation.
 */
export const migration019NotificationIndexes: RegistryMigration = {
  version: 19,
  name: 'notification_indexes',
  up: (db) => {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_kit_sub_author_kind
        ON kit_subscriptions (author_id, kind, created_at);
      CREATE INDEX IF NOT EXISTS idx_kit_sub_kit_kind
        ON kit_subscriptions (kit_id, kind, created_at);
    `);
  },
};
