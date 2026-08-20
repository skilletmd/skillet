import type { RegistryMigration } from '../migrate-runner.js'

/**
 * Mirror review queue: the net-new schema for the two-inflow
 * candidate pipeline (a discovery pass + public logged-in submissions) that is
 * auto-screened then admin-approved before any candidate becomes a public
 * reserved-claimable mirror.
 *
 * A candidate carries the GitHub source it came from, the handle DERIVED from
 * the GitHub owner login (never submitter-supplied — KTD5), the seed-captured
 * numeric `source_owner_id` (so a later source-repo transfer to a *different*
 * owner is detectable at approval time — KTD9), and its lifecycle `status`:
 *   submitted        — enqueued (discovery pass), not yet screened
 *   pending_review   — auto-screen passed; awaiting an admin decision
 *   approved         — admin approved (transient; promotion runs in the same call)
 *   rejected         — admin rejected
 *   rejected_screen  — auto-screen (at submit OR re-screen at approval) failed
 *   live             — promoted to a reserved claimable mirror
 *
 * Dedupe is on `normalized_repo_key` (lowercased owner/repo, host + `.git`
 * stripped) but scoped to in-flight + live states via a PARTIAL UNIQUE INDEX, so
 * case/URL-form variants collapse to one in-flight row while a candidate left in
 * a terminal rejected state can still be resubmitted later.
 *
 * Pure schema only — safe to run with empty data.
 */
export const migration038MirrorReviewQueue: RegistryMigration = {
  version: 38,
  name: 'mirror_review_queue',
  up: (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS mirror_review_queue (
        id                  TEXT PRIMARY KEY,
        source_repo         TEXT NOT NULL,
        normalized_repo_key TEXT NOT NULL,
        source_owner_login  TEXT,
        source_owner_id     INTEGER,
        derived_handle      TEXT,
        owner_type          TEXT,
        license             TEXT,
        status              TEXT NOT NULL CHECK (
          status IN ('submitted','pending_review','approved','rejected','rejected_screen','live')
        ),
        submitted_by        TEXT,
        screen_notes        TEXT,
        decided_by          TEXT,
        decided_at          INTEGER,
        created_at          INTEGER NOT NULL DEFAULT (unixepoch())
      );

      -- In-flight dedupe: at most one row per repo while it is submitted /
      -- pending_review / approved / live. Excludes terminal-rejected states so a
      -- previously rejected candidate can be resubmitted.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_mirror_review_queue_inflight
        ON mirror_review_queue (normalized_repo_key)
        WHERE status IN ('submitted','pending_review','approved','live');

      CREATE INDEX IF NOT EXISTS idx_mirror_review_queue_status
        ON mirror_review_queue (status);
    `)
  },
}
