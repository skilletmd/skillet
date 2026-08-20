import type { RegistryMigration } from '../migrate-runner.js'

/**
 * Installer capability manifest storage.
 *
 * Capabilities are a PARALLEL lane to the threat findings: the inventory
 * of what a skill can DO, computed alongside `runScan` but never feeding the
 * quarantine rollup. They get their own column on the per-version scan row —
 * a sibling to `findings_json`, NOT an overload of it — so the public read path
 * can serve them without re-deriving anything from the threat findings.
 *
 * `capabilities_json` is nullable with no default: a NULL distinguishes an older
 * row (or a still-`pending` insert) where capabilities were never computed from
 * a row that was computed and found nothing (`{"capabilities":[]}`). The web UI
 * uses that distinction ("not analyzed" vs "no capabilities detected").
 *
 * `capability_result_cache` mirrors `scan_result_cache`: capabilities are pure
 * over a bundle's (path, bytes), so identical content reuses a cached report
 * keyed on the same content key plus an independent `capability_version`
 * (CAPABILITY_VERSION). Decoupled from the per-version row so a fork or a
 * republish of unchanged content shares one cache entry across many versions.
 */
export const migration032SkillVersionCapabilities: RegistryMigration = {
  version: 32,
  name: 'skill_version_capabilities',
  up: (db) => {
    db.exec(`ALTER TABLE skill_version_scans ADD COLUMN capabilities_json TEXT;`)
    db.exec(`
      CREATE TABLE IF NOT EXISTS capability_result_cache (
        content_key        TEXT NOT NULL,
        capability_version INTEGER NOT NULL,
        capabilities_json  TEXT NOT NULL,
        computed_at        INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (content_key, capability_version)
      );
    `)
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_capability_result_cache_version ON capability_result_cache (capability_version);`,
    )
  },
}
