import type { RegistryMigration } from '../migrate-runner.js'

/**
 * Record which capability detector version computed a per-version manifest.
 *
 * Migration 032 added `skill_version_scans.capabilities_json` but not the
 * `CAPABILITY_VERSION` that produced it, so a row gives no way to tell a manifest
 * computed under the current detectors from a stale one computed under an older
 * set. `capabilities_version` closes that gap: it is the BACKFILL TARGETING key,
 * not part of the public report.
 *
 * Nullable with no default, mirroring `capabilities_json`'s null-vs-empty
 * contract:
 *   - NULL                          → capabilities were NEVER computed for this
 *     row (an older row, or a still-`pending`/transient-failure insert).
 *   - = CAPABILITY_VERSION          → computed under the current detectors.
 *   - < CAPABILITY_VERSION          → computed under an OLDER set → stale, a
 *     backfill candidate.
 * A row only ever carries a non-NULL `capabilities_version` when it also carries
 * a non-NULL `capabilities_json` (they are written together); the two stay in
 * lockstep so a version can never be both "computed" and "version-unknown".
 */
export const migration033SkillVersionCapabilitiesVersion: RegistryMigration = {
  version: 33,
  name: 'skill_version_capabilities_version',
  up: (db) => {
    db.exec(`ALTER TABLE skill_version_scans ADD COLUMN capabilities_version INTEGER;`)
  },
}
