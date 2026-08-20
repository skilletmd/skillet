import type { DatabaseSync } from '../../src/db/sqlite-handle.js'
import { query, queryOne } from '../legacy-sqlite-query.js'


export function migrateRegistryBaseline(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS authors (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      avatar_url TEXT,
      bio        TEXT,
      profile_url TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS skills (
      id            TEXT PRIMARY KEY,
      author_id     TEXT NOT NULL REFERENCES authors(id),
      slug          TEXT NOT NULL,
      description   TEXT,
      latest_hash   TEXT,
      visibility    TEXT NOT NULL DEFAULT 'private',
      install_count INTEGER NOT NULL DEFAULT 0,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(author_id, slug)
    );

    -- Content-addressed blob store (§2.4). Each unique file body lives here
    -- exactly once, keyed by its sha256: hash. A version is a manifest of
    -- (path → blob_hash). Refcount lets us safely retire unreferenced blobs
    -- when secret-leak tombstones (§7.3) eventually wire up.
    CREATE TABLE IF NOT EXISTS blobs (
      hash       TEXT PRIMARY KEY,
      bytes      BLOB NOT NULL,
      size       INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS skill_versions (
      hash             TEXT PRIMARY KEY,
      skill_id         TEXT NOT NULL REFERENCES skills(id),
      -- §4 author signing — required on every new row. NULL is only present
      -- on legacy rows; v1 enforcement gates publish on these
      -- being supplied. See routes/skills.ts for the 422 signature_invalid
      -- guard that backs the schema.
      signature_alg    TEXT,
      signature_key_id TEXT,
      signature_b64    TEXT,
      author_key_id    TEXT,
      metadata_json    TEXT NOT NULL DEFAULT '{}',
      published_at     INTEGER NOT NULL DEFAULT (unixepoch()),
      published_by     TEXT NOT NULL REFERENCES authors(id)
    );

    -- Per-version manifest: (path → blob_hash). The composite primary key
    -- enforces one entry per (version, path) and gives us cheap lookups in
    -- both directions.
    CREATE TABLE IF NOT EXISTS skill_version_files (
      version_hash TEXT NOT NULL REFERENCES skill_versions(hash) ON DELETE CASCADE,
      path         TEXT NOT NULL,
      blob_hash    TEXT NOT NULL REFERENCES blobs(hash),
      PRIMARY KEY (version_hash, path)
    );

    CREATE INDEX IF NOT EXISTS idx_skill_version_files_blob
      ON skill_version_files (blob_hash);

    CREATE TABLE IF NOT EXISTS kits (
      id          TEXT PRIMARY KEY,
      owner_id    TEXT NOT NULL REFERENCES authors(id),
      name        TEXT NOT NULL,
      description TEXT,
      visibility  TEXT NOT NULL DEFAULT 'private',
      profile_hidden INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS kit_subscriptions (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind       TEXT NOT NULL CHECK(kind IN ('kit', 'author')),
      kit_id     TEXT REFERENCES kits(id) ON DELETE CASCADE,
      author_id  TEXT REFERENCES authors(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      -- Per-subscription update-trust preference, set from the web. NULL = no
      -- preference (client falls back to its local policy / global default).
      trust_mode TEXT CHECK(trust_mode IN ('auto', 'gate')),
      CHECK (
        (kind = 'kit' AND kit_id IS NOT NULL AND author_id IS NULL) OR
        (kind = 'author' AND author_id IS NOT NULL AND kit_id IS NULL)
      )
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_kit_sub_user_kit
      ON kit_subscriptions(user_id, kit_id) WHERE kind = 'kit';
    CREATE UNIQUE INDEX IF NOT EXISTS idx_kit_sub_user_author
      ON kit_subscriptions(user_id, author_id) WHERE kind = 'author';

    CREATE TABLE IF NOT EXISTS kit_skills (
      kit_id      TEXT NOT NULL REFERENCES kits(id) ON DELETE CASCADE,
      skill_id    TEXT NOT NULL REFERENCES skills(id),
      pinned_hash TEXT REFERENCES skill_versions(hash),
      added_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY(kit_id, skill_id)
    );

    -- Immutable, numbered snapshots of a kit's recipe — one row per edit so a
    -- kit has a GitHub-style version history. snapshot_json stores the recipe
    -- (name/description/visibility + the skill list with pins), NOT skill bytes:
    -- those live forever in skill_versions and are referenced by hash, so each
    -- snapshot is a small pointer-list. version is a bare 1-indexed integer
    -- (v1, v2, …) shown to users instead of a hash. summary is the "what
    -- changed" line for the changelog.
    CREATE TABLE IF NOT EXISTS kit_versions (
      id            TEXT PRIMARY KEY,
      kit_id        TEXT NOT NULL REFERENCES kits(id) ON DELETE CASCADE,
      version       INTEGER NOT NULL,
      snapshot_json TEXT NOT NULL,
      summary       TEXT,
      editor_id     TEXT REFERENCES authors(id),
      created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(kit_id, version)
    );

    CREATE INDEX IF NOT EXISTS idx_kit_versions_kit
      ON kit_versions (kit_id, version DESC);

    -- §3 Auth: three token classes. Tokens are stored only as sha256(secret);
    -- the raw secret is shown to the caller exactly once at mint.

    -- User accounts: backed by GitHub OAuth (handle = claimed login).
    -- two_factor reflects the OAuth boundary check (PROTOCOL §3 / acceptance §6).
    CREATE TABLE IF NOT EXISTS users (
      id              TEXT PRIMARY KEY,
      handle          TEXT UNIQUE,
      author_key_id   TEXT,
      author_public_key TEXT,
      github_id       TEXT UNIQUE,
      two_factor      INTEGER NOT NULL DEFAULT 0,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- Anonymous device identity (PROTOCOL §3). Optionally bound to a user
    -- after claim/login. Read+sync only; cannot publish or claim.
    CREATE TABLE IF NOT EXISTS devices (
      id            TEXT PRIMARY KEY,
      token_hash    TEXT NOT NULL UNIQUE,
      user_id       TEXT REFERENCES users(id),
      label         TEXT,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      last_seen_at  INTEGER
    );

    -- User sessions (GitHub-OAuth-backed in production; dev-minted in tests).
    -- publish/claim require this class.
    CREATE TABLE IF NOT EXISTS sessions (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL REFERENCES users(id),
      token_hash    TEXT NOT NULL UNIQUE,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      expires_at    INTEGER,
      revoked_at    INTEGER
    );

    -- Kit-scoped bearer keys for agents/CI (PROTOCOL §8.1).
    -- read+sync only, scoped to ONE kit, named, revocable, optional expiry.
    CREATE TABLE IF NOT EXISTS kit_keys (
      id            TEXT PRIMARY KEY,
      kit_id        TEXT NOT NULL REFERENCES kits(id) ON DELETE CASCADE,
      token_hash    TEXT NOT NULL UNIQUE,
      label         TEXT NOT NULL,
      created_by    TEXT NOT NULL REFERENCES users(id),
      created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      expires_at    INTEGER,
      revoked_at    INTEGER
    );

    -- GitHub OAuth CSRF state. UNUSED — the GitHub OAuth pickup login
    -- (/api/v1/auth/github/start + /callback) was removed; kept only because
    -- migrations are append-only. CLI login is magic-link; the web uses NextAuth.
    CREATE TABLE IF NOT EXISTS oauth_states (
      state        TEXT PRIMARY KEY,
      pickup_id    TEXT,
      created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      expires_at   INTEGER NOT NULL,
      consumed_at  INTEGER
    );

    -- CLI login pickup tickets. The magic-link verify flow parks the freshly
    -- minted session secret here (only after the email-clicker confirms the CLI
    -- user code, H2), keyed by the caller's pickup_id, and the CLI polls
    -- /api/v1/auth/session/pickup to retrieve it. session_token_secret is held
    -- briefly in plaintext: the whole point is that the CLI does not yet hold it.
    -- picked_up_at + a short expiry mean a row is readable at most once and only
    -- inside the login window.
    CREATE TABLE IF NOT EXISTS session_pickups (
      pickup_id            TEXT PRIMARY KEY,
      session_token_secret TEXT,
      user_id              TEXT REFERENCES users(id),
      handle               TEXT,
      two_factor           INTEGER NOT NULL DEFAULT 0,
      created_at           INTEGER NOT NULL DEFAULT (unixepoch()),
      expires_at           INTEGER NOT NULL,
      picked_up_at         INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_devices_user_id ON devices(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_kit_keys_kit_id ON kit_keys(kit_id);

    -- PROTOCOL §8.2 — humans bound to a kit. Owner edits, members sync;
    -- no roles in v1. PK enforces idempotency of (kit_id, user_id).
    CREATE TABLE IF NOT EXISTS kit_members (
      kit_id      TEXT NOT NULL REFERENCES kits(id) ON DELETE CASCADE,
      user_id     TEXT NOT NULL REFERENCES users(id),
      invited_by  TEXT REFERENCES users(id),
      invited_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      accepted_at INTEGER,
      PRIMARY KEY(kit_id, user_id)
    );

    -- PROTOCOL §8.2 — pending invites. A handle invite to a user who hasn't
    -- signed up yet stays here until /claim seeds the row in kit_members.
    -- email-keyed invites resolve at the (future) email-binding step.
    -- Agent invites that minted a kit_key carry the back-reference so a
    -- revoke can find the original invite row.
    CREATE TABLE IF NOT EXISTS kit_invites (
      id          TEXT PRIMARY KEY,
      kit_id      TEXT NOT NULL REFERENCES kits(id) ON DELETE CASCADE,
      kind        TEXT NOT NULL CHECK (kind IN ('human','agent')),
      email       TEXT,
      handle      TEXT,
      label       TEXT,
      invited_by  TEXT NOT NULL REFERENCES users(id),
      expires_at  INTEGER,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      redeemed_at INTEGER,
      kit_key_id  TEXT REFERENCES kit_keys(id)
    );

    CREATE INDEX IF NOT EXISTS idx_kit_invites_handle ON kit_invites(handle);
    CREATE INDEX IF NOT EXISTS idx_kit_invites_email ON kit_invites(email);
    CREATE INDEX IF NOT EXISTS idx_kit_members_user_id ON kit_members(user_id);

    -- PROTOCOL §7.4 — per-account publish-velocity log. One row per successful
    -- publish, keyed by user_id (NOT device or IP). The limiter and burst
    -- alerter both read sliding windows from this table; we keep it append-only
    -- so the read is a single indexed COUNT/SELECT against (user_id, published_at).
    CREATE TABLE IF NOT EXISTS publish_log (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL REFERENCES users(id),
      skill_id      TEXT NOT NULL REFERENCES skills(id),
      content_hash  TEXT NOT NULL,
      published_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_publish_log_user_time
      ON publish_log (user_id, published_at);

    -- PROTOCOL §7.4 / §8 — durable record of every security alert raised by
    -- the registry (burst publish, kit-key anomaly, etc.). v1 sink is also a
    -- structured stdout line; the table makes a follow-up Slack/pager wiring
    -- a pure read with no replay risk.
    CREATE TABLE IF NOT EXISTS alerts (
      id           TEXT PRIMARY KEY,
      kind         TEXT NOT NULL,
      user_id      TEXT REFERENCES users(id),
      payload_json TEXT NOT NULL DEFAULT '{}',
      raised_at    INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_alerts_raised_at
      ON alerts (raised_at);
    CREATE INDEX IF NOT EXISTS idx_alerts_kind_user
      ON alerts (kind, user_id);
    CREATE INDEX IF NOT EXISTS idx_oauth_states_expires ON oauth_states(expires_at);
    CREATE INDEX IF NOT EXISTS idx_session_pickups_expires ON session_pickups(expires_at);

    -- multi-key-per-author. One row per (user, key). The UNIQUE constraint
    -- on (user_id, key_id) makes the migration backfill INSERT OR IGNORE idempotent.
    -- revoked_at NULL = active; non-NULL = revoked and rejected by verifyPublishSignature.
    CREATE TABLE IF NOT EXISTS author_keys (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key_id      TEXT NOT NULL,
      public_key  TEXT NOT NULL,
      label       TEXT NOT NULL DEFAULT 'unnamed',
      created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      revoked_at  INTEGER,
      UNIQUE(user_id, key_id)
    );
    CREATE INDEX IF NOT EXISTS idx_author_keys_user_id ON author_keys(user_id);

    -- Server-side harm scan. One row per published version. Inserted
    -- as 'pending' at publish time; the async runner upserts to clean/flagged/
    -- quarantined. findings_json carries the full Finding[] + FindingsSummary
    -- so the manifest serializer can shape the response without re-scanning.
    CREATE TABLE IF NOT EXISTS skill_version_scans (
      skill_version_id TEXT PRIMARY KEY REFERENCES skill_versions(hash) ON DELETE CASCADE,
      status           TEXT NOT NULL,
      findings_json    TEXT NOT NULL DEFAULT '[]',
      scanned_at       INTEGER
    );

    -- proposal lifecycle — pending change proposals before publish.
    -- A proposal enters 'pending', is decided (approved/changes_requested/rejected)
    -- by the skill owner. Approved proposals mint a skill_versions row through
    -- the normal publish path.
    CREATE TABLE IF NOT EXISTS skill_proposals (
      id                 TEXT PRIMARY KEY,
      skill_id           TEXT NOT NULL REFERENCES skills(id),
      base_hash          TEXT,
      proposed_hash      TEXT NOT NULL,
      state              TEXT NOT NULL DEFAULT 'pending'
                         CHECK (state IN ('pending','approved','changes_requested','rejected')),
      proposer_author_id TEXT NOT NULL REFERENCES authors(id),
      signature_alg      TEXT,
      signature_key_id   TEXT,
      signature_b64      TEXT,
      author_key_id      TEXT,
      created_at         INTEGER NOT NULL DEFAULT (unixepoch()),
      decided_by         TEXT REFERENCES authors(id),
      decided_at         INTEGER,
      decision_note      TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_skill_proposals_skill
      ON skill_proposals (skill_id, state);

    -- Per-proposal manifest: same shape as skill_version_files but keyed by
    -- proposal_id. Bundles are stored content-addressed in the shared blobs
    -- table; this table is the path→blob_hash map for a proposal's bundle.
    CREATE TABLE IF NOT EXISTS proposal_files (
      proposal_id TEXT NOT NULL REFERENCES skill_proposals(id) ON DELETE CASCADE,
      path        TEXT NOT NULL,
      blob_hash   TEXT NOT NULL REFERENCES blobs(hash),
      PRIMARY KEY (proposal_id, path)
    );

    CREATE INDEX IF NOT EXISTS idx_proposal_files_blob
      ON proposal_files (blob_hash);

    -- Harm scan results for proposals — same shape as skill_version_scans.
    -- Inserted as 'pending' at propose time; upserted after async run.
    -- Re-run synchronously at approve time to gate the publish decision.
    CREATE TABLE IF NOT EXISTS proposal_scans (
      proposal_id   TEXT PRIMARY KEY REFERENCES skill_proposals(id) ON DELETE CASCADE,
      status        TEXT NOT NULL,
      findings_json TEXT NOT NULL DEFAULT '[]',
      scanned_at    INTEGER
    );

    -- content-hash scan-result cache. Scanning is pure over a bundle's
    -- (path, bytes); identical content produces identical findings. We key on a
    -- content hash of the bundle manifest (path → blob_hash) plus the detector
    -- corpus version, and reuse the cached status + findings_json on a hit
    -- instead of re-running detectors. A bump of DETECTOR_CORPUS_VERSION changes
    -- the second key column, making every prior entry unreachable → forced
    -- re-scan. Decoupled from skill_version_scans/proposal_scans so a fork or a
    -- republish of unchanged content shares one cache row across many versions.
    CREATE TABLE IF NOT EXISTS scan_result_cache (
      content_key    TEXT NOT NULL,
      corpus_version INTEGER NOT NULL,
      status         TEXT NOT NULL,
      findings_json  TEXT NOT NULL,
      scanned_at     INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (content_key, corpus_version)
    );

    CREATE INDEX IF NOT EXISTS idx_scan_result_cache_corpus
      ON scan_result_cache (corpus_version);

    -- cache hit-rate counters, one row per corpus version. A new corpus
    -- version starts a fresh tally so hit rate reflects the active detector set.
    CREATE TABLE IF NOT EXISTS scan_cache_metrics (
      corpus_version INTEGER PRIMARY KEY,
      hits           INTEGER NOT NULL DEFAULT 0,
      misses         INTEGER NOT NULL DEFAULT 0
    );

    -- provenance for versions minted from proposals. Records both the
    -- proposer and the approver so forensic queries don't rely on metadata_json.
    -- Only populated for proposal-minted versions; direct publishes have no row.
    CREATE TABLE IF NOT EXISTS skill_version_provenance (
      version_hash TEXT PRIMARY KEY REFERENCES skill_versions(hash) ON DELETE CASCADE,
      proposed_by  TEXT NOT NULL REFERENCES authors(id),
      approved_by  TEXT NOT NULL REFERENCES authors(id),
      proposal_id  TEXT REFERENCES skill_proposals(id)
    );

    -- org-level teams above kits (Paperclip company parity).
    -- Owner is also seeded in organization_members with role 'owner'.
    CREATE TABLE IF NOT EXISTS organizations (
      id            TEXT PRIMARY KEY,
      slug          TEXT NOT NULL UNIQUE,
      name          TEXT NOT NULL,
      owner_user_id TEXT NOT NULL REFERENCES users(id),
      created_at    INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS organization_members (
      org_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id     TEXT NOT NULL REFERENCES users(id),
      role        TEXT NOT NULL CHECK (role IN ('owner','admin','member')) DEFAULT 'member',
      invited_by  TEXT REFERENCES users(id),
      invited_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      accepted_at INTEGER,
      PRIMARY KEY (org_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS organization_invites (
      id          TEXT PRIMARY KEY,
      org_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      email       TEXT,
      handle      TEXT,
      role        TEXT NOT NULL CHECK (role IN ('admin','member')) DEFAULT 'member',
      invited_by  TEXT NOT NULL REFERENCES users(id),
      expires_at  INTEGER,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      redeemed_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_organizations_slug ON organizations (slug);
    CREATE INDEX IF NOT EXISTS idx_organization_members_user_id
      ON organization_members (user_id);
    CREATE INDEX IF NOT EXISTS idx_organization_invites_handle
      ON organization_invites (handle);
    CREATE INDEX IF NOT EXISTS idx_organization_invites_email
      ON organization_invites (email);

    -- linked social identities (GitHub, Google).
    -- email_verified records that the IdP confirmed the user controls
    -- this email. It is the publish/claim gate (replacing the GitHub-2FA gate).
    -- Fail-closed default 0: an identity is only verified when an explicit
    -- verified signal is recorded at link time.
    CREATE TABLE IF NOT EXISTS user_identities (
      user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider            TEXT NOT NULL CHECK (provider IN ('github','google')),
      provider_subject_id TEXT NOT NULL,
      email               TEXT,
      email_verified      INTEGER NOT NULL DEFAULT 0,
      created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (provider, provider_subject_id)
    );

    CREATE INDEX IF NOT EXISTS idx_user_identities_user_id
      ON user_identities (user_id);

    -- author-signed device-key delegations. The registry STORES the
    -- delegation but is never trusted to MINT authority: forging a delegation
    -- requires the primary author PRIVATE key (CLI keystore only). Authority is
    -- recomputed from cert_json and verified against cert_sig + the user's
    -- author_public_key at every use — the denormalized columns below are
    -- indexing/listing hints ONLY and MUST NOT be the verification input (§9.1).
    CREATE TABLE IF NOT EXISTS author_delegations (
      device_key_id      TEXT PRIMARY KEY,            -- 64hex; == hex(device_pub)
      user_id            TEXT NOT NULL REFERENCES users(id),
      -- Denormalized for indexing / listing ONLY. NOT authoritative.
      author_key_id      TEXT NOT NULL,
      device_pub         TEXT NOT NULL,               -- base64 raw 32 bytes (mirror of cert.device_pub)
      scopes             TEXT NOT NULL,               -- JSON array, mirror of cert.scopes
      -- Authoritative, signature-covered material:
      cert_json          TEXT NOT NULL,               -- canonical DelegationCert JSON (the SIGNED bytes' source)
      cert_sig_alg       TEXT NOT NULL,               -- 'ed25519'
      cert_sig_key_id    TEXT NOT NULL,               -- == author_key_id
      cert_sig_b64       TEXT NOT NULL,               -- author primary-key sig over signatureBytes(certHash)
      label              TEXT,                         -- human label e.g. "Sarah's MacBook (browser)"
      issued_at          INTEGER NOT NULL,
      expires_at         INTEGER NOT NULL,
      -- Revocation (author-signed; §3):
      revoked_at         INTEGER,                      -- NULL = active
      revocation_sig_b64 TEXT,                          -- author sig over the revocation statement
      revocation_json    TEXT,                          -- canonical RevocationStatement JSON
      created_at         INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_author_delegations_user
      ON author_delegations(user_id);
    CREATE INDEX IF NOT EXISTS idx_author_delegations_author_key
      ON author_delegations(author_key_id);

    -- server-issued one-time nonces for proof-of-possession co-sign.
    -- A nonce is minted at GET /api/v1/auth/keys/nonce and consumed at the next
    -- POST /api/v1/auth/keys for that user. consumed_at != NULL means replayed.
    CREATE TABLE IF NOT EXISTS key_bind_nonces (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      nonce       TEXT NOT NULL UNIQUE,
      expires_at  INTEGER NOT NULL,
      consumed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_key_bind_nonces_user
      ON key_bind_nonces (user_id, expires_at);

    -- per-user bind-attempt log for rate limiting POST /api/v1/auth/keys.
    -- Every attempt (including failed PoP) is appended so a leaked session cannot
    -- churn the endpoint; the rate limiter reads sliding windows from this table.
    CREATE TABLE IF NOT EXISTS key_bind_attempts (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL REFERENCES users(id),
      attempted_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_key_bind_attempts_user_time
      ON key_bind_attempts (user_id, attempted_at);

    -- A user follows an author or an org. Follower is a user;
    -- subject is an author handle ('author') or an org slug ('org'). 'skill' is
    -- reserved for a later watch-a-skill feature.
    CREATE TABLE IF NOT EXISTS follows (
      follower_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subject_kind     TEXT NOT NULL CHECK (subject_kind IN ('author','org','skill')),
      subject_id       TEXT NOT NULL,
      is_private       INTEGER NOT NULL DEFAULT 0,
      created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (follower_user_id, subject_kind, subject_id)
    );
    CREATE INDEX IF NOT EXISTS idx_follows_subject ON follows (subject_kind, subject_id);

    -- Denormalized follower counts, maintained in-txn with follow/unfollow.
    CREATE TABLE IF NOT EXISTS follow_counts (
      subject_kind TEXT NOT NULL,
      subject_id   TEXT NOT NULL,
      followers    INTEGER NOT NULL DEFAULT 0,
      subscribers  INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (subject_kind, subject_id)
    );
  `);

  // a version minted from a device-keyed proposal carries the full
  // SignedDelegation inline so a client can reconstruct the trust chain offline
  // (fresh checkout / lockfile / CI) without re-fetching the cert from a
  // registry it does not trust. NULL for the common primary-key-signed case.
  const versionCols = query<{ name: string }>(db, 'PRAGMA table_info(skill_versions)');
  if (!versionCols.some((c) => c.name === 'delegation_json')) {
    db.exec(`ALTER TABLE skill_versions ADD COLUMN delegation_json TEXT`);
  }

  // add visibility column to existing databases (new DBs already have it from CREATE TABLE).
  // Fail-closed: existing rows get 'private' (the DEFAULT), ensuring no previously-published
  // skill is suddenly public-readable without an explicit visibility='public' publish.
  const skillCols = query<{ name: string }>(db, 'PRAGMA table_info(skills)');
  if (!skillCols.some((c) => c.name === 'visibility')) {
    db.exec(`ALTER TABLE skills ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private'`);
  }

  const authorCols = query<{ name: string }>(db, 'PRAGMA table_info(authors)');
  if (!authorCols.some((c) => c.name === 'bio')) {
    db.exec(`ALTER TABLE authors ADD COLUMN bio TEXT`);
  }
  if (!authorCols.some((c) => c.name === 'profile_url')) {
    db.exec(`ALTER TABLE authors ADD COLUMN profile_url TEXT`);
  }

  // optional org ownership on kits (null = personal kit owned by owner_id only).
  const kitCols = query<{ name: string }>(db, 'PRAGMA table_info(kits)');
  if (!kitCols.some((c) => c.name === 'org_id')) {
    db.exec(`ALTER TABLE kits ADD COLUMN org_id TEXT REFERENCES organizations(id)`);
  }
  // kit visibility for public subscribe + author-as-kit subscriptions.
  if (!kitCols.some((c) => c.name === 'visibility')) {
    db.exec(`ALTER TABLE kits ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private'`);
  }
  // Owner toggle: hide a kit from the owner's public profile without changing
  // its visibility. 0 = shown (default), 1 = hidden from profile.
  if (!kitCols.some((c) => c.name === 'profile_hidden')) {
    db.exec(`ALTER TABLE kits ADD COLUMN profile_hidden INTEGER NOT NULL DEFAULT 0`);
  }

  // Linked kits: a kit that mirrors a GitHub repo, re-pullable into Skillet.
  // source_type = 'owned' (default) | 'linked'. The repo is the author's editor;
  // Skillet stays the canonical signed/scanned/versioned artifact (resync IN only).
  if (!kitCols.some((c) => c.name === 'source_type')) {
    db.exec(`ALTER TABLE kits ADD COLUMN source_type TEXT NOT NULL DEFAULT 'owned'`);
  }
  if (!kitCols.some((c) => c.name === 'source_repo')) {
    db.exec(`ALTER TABLE kits ADD COLUMN source_repo TEXT`);
  }
  if (!kitCols.some((c) => c.name === 'source_ref')) {
    db.exec(`ALTER TABLE kits ADD COLUMN source_ref TEXT`);
  }
  if (!kitCols.some((c) => c.name === 'source_path')) {
    db.exec(`ALTER TABLE kits ADD COLUMN source_path TEXT`);
  }
  if (!kitCols.some((c) => c.name === 'last_synced_sha')) {
    db.exec(`ALTER TABLE kits ADD COLUMN last_synced_sha TEXT`);
  }

  // Per-subscription update-trust preference (set from web). NULL = no preference.
  const subCols = query<{ name: string }>(db, 'PRAGMA table_info(kit_subscriptions)');
  if (subCols.length > 0 && !subCols.some((c) => c.name === 'trust_mode')) {
    db.exec(`ALTER TABLE kit_subscriptions ADD COLUMN trust_mode TEXT CHECK(trust_mode IN ('auto', 'gate'))`);
  }
  migrateKitSubscriptions(db);

  // add email_verified to existing databases (new DBs already have it
  // from CREATE TABLE). Existing rows came from a github/google OAuth round-trip
  // — both providers only release a verified email — so backfill them to 1 to
  // avoid locking already-published authors out of publish/claim. New inserts
  // set the column explicitly; the column DEFAULT (0) stays fail-closed.
  const identityCols = query<{ name: string }>(db, 'PRAGMA table_info(user_identities)');
  if (!identityCols.some((c) => c.name === 'email_verified')) {
    db.exec(`ALTER TABLE user_identities ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0`);
    db.exec(`UPDATE user_identities SET email_verified = 1`);
  }

  // Backfill legacy users.github_id into user_identities (idempotent).
  // A legacy github_id implies a completed GitHub OAuth, so the email is
  // provider-verified — backfill email_verified = 1.
  db.exec(`
    INSERT OR IGNORE INTO user_identities (user_id, provider, provider_subject_id, email, email_verified, created_at)
    SELECT id, 'github', github_id, NULL, 1, unixepoch()
    FROM users
    WHERE github_id IS NOT NULL
  `);

  migrateIdentityProviders(db);
  migrateTwitterIdentityProvider(db);
  migrateMagicLinkTokens(db);
  migrateMachinePairCodes(db);
  migrateSkillStudioColumns(db);
  migrateReferenceStability(db);
  migrateBlobStorageLoc(db);
  migrateAuthorKeys(db);
}

function migrateBlobStorageLoc(db: DatabaseSync): void {
  const cols = query<{ name: string }>(db, 'PRAGMA table_info(blobs)');
  if (!cols.some((c) => c.name === 'storage_loc')) {
    db.exec(`ALTER TABLE blobs ADD COLUMN storage_loc TEXT NOT NULL DEFAULT 'inline'`);
  }
}

function migrateReferenceStability(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS handle_aliases (
      old_handle  TEXT PRIMARY KEY,
      new_handle  TEXT NOT NULL,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS skill_aliases (
      from_skill_id TEXT PRIMARY KEY,
      to_skill_id   TEXT NOT NULL REFERENCES skills(id),
      created_at    INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);

  const versionCols = query<{ name: string }>(db, 'PRAGMA table_info(skill_versions)');
  if (!versionCols.some((c) => c.name === 'yanked_at')) {
    db.exec(`ALTER TABLE skill_versions ADD COLUMN yanked_at INTEGER`);
  }
  if (!versionCols.some((c) => c.name === 'yank_reason')) {
    db.exec(`ALTER TABLE skill_versions ADD COLUMN yank_reason TEXT`);
  }

  const userCols = query<{ name: string }>(db, 'PRAGMA table_info(users)');
  if (!userCols.some((c) => c.name === 'suspended_at')) {
    db.exec(`ALTER TABLE users ADD COLUMN suspended_at INTEGER`);
  }
}

function migrateMachinePairCodes(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS machine_pair_codes (
      code                  TEXT PRIMARY KEY,
      user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at            INTEGER NOT NULL DEFAULT (unixepoch()),
      expires_at            INTEGER NOT NULL,
      redeemed_at           INTEGER,
      redeemed_device_id    TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_machine_pair_codes_user
      ON machine_pair_codes (user_id, expires_at);
  `);
}

function migrateKitSubscriptions(db: DatabaseSync): void {
  const tables = queryOne<{ name: string }>(
    db,
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'kit_subscriptions'",
  );
  if (tables) return;
  db.exec(`
    CREATE TABLE kit_subscriptions (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind       TEXT NOT NULL CHECK(kind IN ('kit', 'author')),
      kit_id     TEXT REFERENCES kits(id) ON DELETE CASCADE,
      author_id  TEXT REFERENCES authors(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      CHECK (
        (kind = 'kit' AND kit_id IS NOT NULL AND author_id IS NULL) OR
        (kind = 'author' AND author_id IS NOT NULL AND kit_id IS NULL)
      )
    );
    CREATE UNIQUE INDEX idx_kit_sub_user_kit
      ON kit_subscriptions(user_id, kit_id) WHERE kind = 'kit';
    CREATE UNIQUE INDEX idx_kit_sub_user_author
      ON kit_subscriptions(user_id, author_id) WHERE kind = 'author';
  `);
}

function migrateSkillStudioColumns(db: DatabaseSync): void {
  const skillCols = query<{ name: string }>(db, 'PRAGMA table_info(skills)');
  if (!skillCols.some((c) => c.name === 'org_id')) {
    db.exec(`ALTER TABLE skills ADD COLUMN org_id TEXT REFERENCES organizations(id)`);
  }
  if (!skillCols.some((c) => c.name === 'created_by_user_id')) {
    db.exec(`ALTER TABLE skills ADD COLUMN created_by_user_id TEXT REFERENCES users(id)`);
  }
  if (!skillCols.some((c) => c.name === 'deprecated_at')) {
    db.exec(`ALTER TABLE skills ADD COLUMN deprecated_at INTEGER`);
  }
  if (!skillCols.some((c) => c.name === 'deprecation_message')) {
    db.exec(`ALTER TABLE skills ADD COLUMN deprecation_message TEXT`);
  }

  // Backfill authors rows for orgs created earlier.
  db.exec(`
    INSERT OR IGNORE INTO authors (id, name)
    SELECT slug, name FROM organizations
  `);
}

function migrateIdentityProviders(db: DatabaseSync): void {
  const ddl = queryOne<{ sql: string }>(
    db,
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'user_identities'`,
  );
  if (!ddl?.sql || ddl.sql.includes("'email'")) return;

  db.exec(`
    CREATE TABLE user_identities_v2 (
      user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider            TEXT NOT NULL CHECK (provider IN ('github','google','email')),
      provider_subject_id TEXT NOT NULL,
      email               TEXT,
      email_verified      INTEGER NOT NULL DEFAULT 0,
      created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (provider, provider_subject_id)
    );
    INSERT INTO user_identities_v2
      (user_id, provider, provider_subject_id, email, email_verified, created_at)
      SELECT user_id, provider, provider_subject_id, email, email_verified, created_at
      FROM user_identities;
    DROP TABLE user_identities;
    ALTER TABLE user_identities_v2 RENAME TO user_identities;
    CREATE INDEX IF NOT EXISTS idx_user_identities_user_id
      ON user_identities (user_id);
  `);
}

function migrateTwitterIdentityProvider(db: DatabaseSync): void {
  const ddl = queryOne<{ sql: string }>(
    db,
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'user_identities'`,
  );
  if (!ddl?.sql || ddl.sql.includes("'twitter'")) return;

  db.exec(`
    CREATE TABLE user_identities_v3 (
      user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider            TEXT NOT NULL CHECK (provider IN ('github','google','email','twitter')),
      provider_subject_id TEXT NOT NULL,
      email               TEXT,
      email_verified      INTEGER NOT NULL DEFAULT 0,
      created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (provider, provider_subject_id)
    );
    INSERT INTO user_identities_v3
      (user_id, provider, provider_subject_id, email, email_verified, created_at)
      SELECT user_id, provider, provider_subject_id, email, email_verified, created_at
      FROM user_identities;
    DROP TABLE user_identities;
    ALTER TABLE user_identities_v3 RENAME TO user_identities;
    CREATE INDEX IF NOT EXISTS idx_user_identities_user_id
      ON user_identities (user_id);
  `);
}

function migrateAuthorKeys(db: DatabaseSync): void {
  // Backfill existing users' primary CLI keys into author_keys.
  // INSERT OR IGNORE + UNIQUE(user_id, key_id) makes this idempotent on restart.
  db.exec(`
    INSERT OR IGNORE INTO author_keys (id, user_id, key_id, public_key, label, created_at)
    SELECT lower(hex(randomblob(16))), id, author_key_id, author_public_key, 'cli-primary', unixepoch()
    FROM users
    WHERE author_key_id IS NOT NULL AND author_public_key IS NOT NULL
  `);
}

function migrateMagicLinkTokens(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS magic_link_tokens (
      id          TEXT PRIMARY KEY,
      email       TEXT NOT NULL,
      token_hash  TEXT NOT NULL UNIQUE,
      pickup_id   TEXT,
      request_ip  TEXT,
      expires_at  INTEGER NOT NULL,
      redeemed_at INTEGER,
      user_code_hash TEXT,
      confirm_attempts INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_magic_link_tokens_email
      ON magic_link_tokens (email, created_at);
  `);
  // request_ip was added after #150 shipped without it. Backfill the
  // column on pre-existing tables (CREATE TABLE IF NOT EXISTS is a no-op there).
  const cols = query<{ name: string }>(db, `PRAGMA table_info(magic_link_tokens)`);
  if (!cols.some((c) => c.name === 'request_ip')) {
    db.exec(`ALTER TABLE magic_link_tokens ADD COLUMN request_ip TEXT`);
  }
  // H2 device-authorization confirm: the CLI pickup login parks its session only
  // after the email-clicker enters the short code shown in their terminal, so an
  // unauthenticated /send for another mailbox can't claim a session.
  if (!cols.some((c) => c.name === 'user_code_hash')) {
    db.exec(`ALTER TABLE magic_link_tokens ADD COLUMN user_code_hash TEXT`);
  }
  // H2 confirm brute-force cap: count wrong-code attempts so a confirmation
  // locks after a few misses (defense-in-depth on top of the code's entropy).
  if (!cols.some((c) => c.name === 'confirm_attempts')) {
    db.exec(`ALTER TABLE magic_link_tokens ADD COLUMN confirm_attempts INTEGER NOT NULL DEFAULT 0`);
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_magic_link_tokens_request_ip
      ON magic_link_tokens (request_ip, created_at);
  `);
}

