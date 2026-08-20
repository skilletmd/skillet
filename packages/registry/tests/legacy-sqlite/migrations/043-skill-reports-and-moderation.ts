import type { RegistryMigration } from '../migrate-runner.js';

/**
 * Skill abuse reporting + moderation.
 *
 * Three pieces, one migration:
 *
 *   1. `skill_reports` — the private intake queue. One row per report from a
 *      signed-in user. Never shown publicly; the reporter is never echoed
 *      outward. `category` is a small safety-focused set plus `copyright`
 *      (the in-app takedown fast path — the formal DMCA process lives in
 *      docs/legal/dmca-policy.md). `claims_ownership` is set only on the
 *      copyright branch (the ownership acknowledgement). `version_hash` is a
 *      plain nullable column — a snapshot of the version the reporter saw, NOT
 *      an FK: migration 034 re-keyed `skill_versions` to the composite PK
 *      (skill_id, hash), so a single-column FK to `hash` would fail at CREATE
 *      TABLE.
 *
 *   2. `skill_moderation_actions` — append-only audit of enforcement actions
 *      (quarantine / unquarantine / unlist / relist). `public_reason` is
 *      admin-authored and surfaces on the public moderation log; it must never
 *      echo the reporter's text or identity. Dismissals are NOT written here —
 *      a dismissed report leaves no enforcement trace.
 *
 *   3. `skills.moderation_status` — the single source of truth for enforcement.
 *      `none | unlisted | quarantined`. Serve-guards and the publish gate read
 *      it, discovery/search/catalog exclude on it, and the public log renders
 *      from it. Independent of `visibility` (private|public) — the two axes
 *      never write each other. Plain ADD COLUMN; existing rows default to
 *      `none`.
 */
export const migration043SkillReportsAndModeration: RegistryMigration = {
  version: 43,
  name: 'skill_reports_and_moderation',
  up: (db) => {
    db.exec(`
      CREATE TABLE skill_reports (
        id             TEXT PRIMARY KEY,
        skill_id       TEXT NOT NULL REFERENCES skills(id),
        version_hash   TEXT,
        reported_by    TEXT NOT NULL REFERENCES users(id),
        category       TEXT NOT NULL
                         CHECK (category IN
                           ('malware','prompt_injection','spam','abusive','copyright','other')),
        reason         TEXT,
        claims_ownership INTEGER,
        status         TEXT NOT NULL DEFAULT 'open'
                         CHECK (status IN ('open','resolved','dismissed')),
        admin_notes    TEXT,
        created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
        resolved_at    INTEGER
      );
    `);
    db.exec(`CREATE INDEX idx_skill_reports_status ON skill_reports(status);`);
    db.exec(`CREATE INDEX idx_skill_reports_skill ON skill_reports(skill_id);`);
    // Report rate limiter keys on (reported_by, created_at).
    db.exec(
      `CREATE INDEX idx_skill_reports_reporter ON skill_reports(reported_by, created_at);`,
    );

    db.exec(`
      CREATE TABLE skill_moderation_actions (
        id            TEXT PRIMARY KEY,
        skill_id      TEXT NOT NULL REFERENCES skills(id),
        action        TEXT NOT NULL
                        CHECK (action IN ('quarantine','unquarantine','unlist','relist')),
        public_reason TEXT,
        acted_by      TEXT NOT NULL REFERENCES users(id),
        created_at    INTEGER NOT NULL DEFAULT (unixepoch())
      );
    `);
    db.exec(
      `CREATE INDEX idx_skill_moderation_actions_skill
         ON skill_moderation_actions(skill_id, created_at);`,
    );

    db.exec(`
      ALTER TABLE skills ADD COLUMN moderation_status TEXT NOT NULL DEFAULT 'none'
        CHECK (moderation_status IN ('none','unlisted','quarantined'));
    `);
  },
};
