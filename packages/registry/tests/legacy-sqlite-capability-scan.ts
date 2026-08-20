// Quarantined sqlite capability-cache helpers for characterization (U6).
// Prod path uses capabilityCacheLookupPrisma / capabilityCacheStorePrisma in src/.
import type { DatabaseSync } from '../src/db/sqlite-handle.js'
import { queryOne } from './legacy-sqlite-query.js'
import { CAPABILITY_VERSION } from '../src/scanner/capabilities/scan.js'

export { CAPABILITY_VERSION }

/** Read a cached capability report JSON for a content key at the given version. */
export function capabilityCacheLookup(
  db: DatabaseSync,
  contentKey: string,
  version: number = CAPABILITY_VERSION,
): string | null {
  const row = queryOne<{ capabilities_json: string }>(
    db,
    'SELECT capabilities_json FROM capability_result_cache WHERE content_key = ? AND capability_version = ?',
    contentKey,
    version,
  )
  return row?.capabilities_json ?? null
}

/** Write a computed capability report JSON through the content-hash cache. */
export function capabilityCacheStore(
  db: DatabaseSync,
  contentKey: string,
  capabilitiesJson: string,
  version: number = CAPABILITY_VERSION,
): void {
  db.prepare(
    `INSERT INTO capability_result_cache (content_key, capability_version, capabilities_json, computed_at)
     VALUES (?, ?, ?, unixepoch())
     ON CONFLICT(content_key, capability_version) DO UPDATE SET
       capabilities_json = excluded.capabilities_json,
       computed_at = excluded.computed_at`,
  ).run(contentKey, version, capabilitiesJson)
}
