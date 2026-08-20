import type { RegistryMigration } from '../migrate-runner.js'

/**
 * Persist the signature version (`sig_version`) on each published version.
 *
 * The registry stored only `{signature_alg, signature_key_id, signature_b64,
 * author_key_id}` and dropped the envelope's `sig_version` entirely, so v2
 * (binding-bound: author/ref/version/content_hash) signatures were served to
 * consumers as v1 and failed verification on pull. This adds the column so the
 * publish path can persist the real value and the wire serializers can emit it.
 *
 * Backfill for pre-existing rows: there is no recoverable at-rest discriminator
 * other than `author_key_id` — a v2 signature binds the author key, so a row
 * carrying `author_key_id` is treated as v2 and a legacy row without it as v1.
 * New publishes always write a concrete `sig_version` (see routes/skills.ts),
 * so the column is only nullable for the brief window before backfill runs.
 */
export const migration035SkillVersionSigVersion: RegistryMigration = {
  version: 35,
  name: 'skill_version_sig_version',
  up: (db) => {
    db.exec(`ALTER TABLE skill_versions ADD COLUMN sig_version INTEGER;`)
    db.exec(
      `UPDATE skill_versions
          SET sig_version = CASE WHEN author_key_id IS NOT NULL THEN 2 ELSE 1 END;`,
    )
  },
}
