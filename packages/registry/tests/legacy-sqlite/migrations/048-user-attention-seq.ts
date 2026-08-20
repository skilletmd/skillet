import type { RegistryMigration } from '../migrate-runner.js'
import { query } from '../../legacy-sqlite-query.js'

/** Monotonic cursor for cheap SSE change detection per user. */
export const migration048UserAttentionSeq: RegistryMigration = {
  version: 48,
  name: 'user_attention_seq',
  up: (db) => {
    const cols = query<{ name: string }>(db, `PRAGMA table_info(users)`)
    if (!cols.some((c) => c.name === 'attention_seq')) {
      db.exec(`ALTER TABLE users ADD COLUMN attention_seq INTEGER NOT NULL DEFAULT 0`)
    }
  },
}
