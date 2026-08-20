import type { RegistryMigration } from '../migrate-runner.js'
import { query } from '../../legacy-sqlite-query.js'

/**
 * Records the upstream version a GitHub-synced mirror REFUSED to advance to
 *. Sync is automated — it can't 422 like an interactive publish, so
 * when a synced version scans as a secret or quarantined it *holds*: the mirror
 * stays installable on its last clean version (latest_hash), `computed_hash`
 * still advances to the upstream hash (so we don't re-process it every run), and
 * `blocked_hash` remembers what was held back so the skill page can show a
 * "a newer upstream version was blocked" banner. Cleared when a later clean
 * upstream version advances the mirror again.
 */
export const migration022MirrorBlockedHash: RegistryMigration = {
  version: 22,
  name: 'mirror_blocked_hash',
  up: (db) => {
    const cols = query<{ name: string }>(db, `PRAGMA table_info(skill_mirrors)`)
    if (!cols.some((c) => c.name === 'blocked_hash')) {
      db.exec(`ALTER TABLE skill_mirrors ADD COLUMN blocked_hash TEXT`)
    }
  },
}
