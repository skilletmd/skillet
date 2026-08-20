import type { BundleFiles } from './bundle.js'
import type { ArtifactSchemaVersion } from './artifact-schema.js'

/** Basic eval outcome on a published version. */
export type EvalStatus = 'passed' | 'failed' | 'none'

export interface SkillManifest {
  /** Wire-format version for this manifest shape. */
  schema_version: ArtifactSchemaVersion
  author: string
  slug: string
  skill_id: string
  latest_hash: string | null
  install_count: number
  versions: SkillVersionRef[]
  /** Present when the request path was an alias for the canonical skill. */
  redirected_from?: string
  deprecated?: boolean
  deprecation_message?: string | null
}

export interface SkillVersionRef {
  hash: string
  published_at: number
  url: string
  /**
   * Server-side scan state. Absent for clean versions; present
   * when status is `pending`, `flagged`, or `quarantined`. Quarantined entries
   * MUST require explicit extra consent in the client's verify-before-write
   * path beyond the standard graded-diff approval.
   */
  scan?: ScanManifestInfo
  /**
   * Basic eval status. Absent or `none` ⇒ no badge. Static smoke
   * eval only — not full agent certification.
   */
  eval?: EvalStatus
  /** Version yanked from new installs; hash fetch still works for existing pins. */
  yanked?: boolean
}

export type ScanManifestStatus = 'pending' | 'flagged' | 'quarantined'

export interface ScanManifestInfo {
  status: ScanManifestStatus
  findings_summary: ScanFindingsSummary
}

export type ScanCategory =
  | 'injection'
  | 'exfil'
  | 'destructive'
  | 'obfuscation'
  | 'secret'
  | 'risky-call'

export type ScanSeverity = 'low' | 'medium' | 'high'

export interface ScanFindingsSummary {
  total: number
  counts: Partial<Record<ScanCategory, Partial<Record<ScanSeverity, number>>>>
  topConfidence: ScanSeverity | null
  /** Up to 5 highlight findings for graded-diff display. */
  highlights: Array<{
    category: ScanCategory
    confidence: ScanSeverity
    file: string
    why: string
  }>
}

export interface SkillPublishRequest {
  author: string
  slug: string
  /** Bundle wire format (§2.1): path → { enc, data }. MUST contain root `SKILL.md`. */
  files: BundleFiles
  /** Content hash of the version the client last saw; required when updating an existing skill. */
  base_hash?: string | null
  metadata?: Record<string, unknown>
}

export interface SkillPublishResponse {
  hash: string
  skill_id: string
  version_url: string
  schema_version?: ArtifactSchemaVersion
  message?: string
}

export interface SkillVersionDetail {
  hash: string
  skill_id: string
  author: string
  slug: string
  /** Wire-format version for version payloads. */
  schema_version: ArtifactSchemaVersion
  /** Bundle wire format (§2.1). Reconstructed from content-addressed blob storage (§2.4). */
  files: BundleFiles
  metadata: Record<string, unknown>
  published_at: number
  published_by: string
  /**
   * Context-weight metering (approximate, cross-vendor). Headline token count
   * and the standing "ambient" (name + trigger) portion for this version.
   * Display only; absent for versions not yet backfilled.
   */
  token_count?: number
  token_ambient?: number
  token_method?: string
}

export interface SkillConflictError {
  error: 'conflict'
  message: string
  latest_hash: string
}

export interface BundleErrorResponse {
  error: 'unsafe_path' | 'bundle_too_large' | 'instruction_too_large'
  message: string
}

export interface Kit {
  id: string
  owner: string
  name: string
  description: string | null
  skills: KitSkill[]
  created_at: number
}

export interface KitSkill {
  skill_id: string
  pinned_hash: string | null
  /** Resolves to pinned_hash if set, otherwise the skill's latest_hash. */
  current_hash: string | null
  added_at: number
}

export interface AuthorProfile {
  id: string
  name: string
  avatar_url: string | null
  created_at: number
  total_installs: number
  skills: PublishedSkill[]
}

export interface PublishedSkill {
  slug: string
  skill_id: string
  latest_hash: string | null
  install_count: number
  created_at: number
}

// ---------------------------------------------------------------------------
// Sync surface (PROTOCOL.md §6.1)
//
// The normative wire contract the registry client consumes. Per-item
// fields that depend on the bundle/canonical hash and on-wire
// signing are typed here NOW so all three workstreams agree on the shape; the
// server fills them in as those land.
// ---------------------------------------------------------------------------

/** Author signature envelope (PROTOCOL.md §4). */
export interface AuthorSignature {
  alg: 'ed25519'
  key_id: string
  /** base64-encoded detached signature over the content_hash string */
  sig: string
  /**
   * Signature scheme version. v1 signs utf8(content_hash); v2 binds
   * author_key_id + ref + version + content_hash (PROTOCOL.md §4, NF-004).
   * Consumers use this to pick v1 vs v2 verification. Optional for
   * back-compat with older servers that omit it (treated as v1).
   */
  sig_version?: 1 | 2
}

/** Policy a client applies before materializing this item (PROTOCOL.md §6.1). */
export type SyncItemPolicy = 'manual' | 'pinned'

export interface SyncManifestItem {
  /** Canonical skill ref, e.g. `@taylor/festival-ops` */
  ref: string
  /** Monotonic integer per skill (PROTOCOL.md §2.3). */
  version: number
  /**
   * Stored semver label ("major.minor.patch") for the served version. Display
   * only — never part of the manifest ETag, and absent on older servers.
   */
  version_label?: string
  /** Canonical bundle hash (PROTOCOL.md §2.2), `sha256:<hex>`. */
  content_hash: string
  /** Author Ed25519 signature over content_hash. */
  signature: AuthorSignature | null
  /** Author public-key id pinned client-side via TOFU. */
  author_key_id: string | null
  policy: SyncItemPolicy
  /**
   * Display ref of the kit the item came from (`@owner/slugified-kit-name`).
   * Null for skills the caller authors. DISPLAY ONLY — a kit rename or two kits
   * whose names slugify alike make this ambiguous, so never use it for identity
   * comparison; use `kit_id`.
   */
  source_kit: string | null
  /**
   * Stable id of the kit the item came from — the identity-safe counterpart to
   * the display-only `source_kit`. Absent for the caller's own profile skills
   * (no kit) and for older servers that predate this field.
   */
  kit_id?: string
  /**
   * The subscriber's per-kit update-trust preference set on the web ('auto' =
   * apply updates silently, 'gate' = review each). Null = no per-kit preference;
   * the client falls back to its local policy/global default. Only present for
   * skills reaching the caller via a kit subscription.
   */
  subscriber_trust?: 'auto' | 'gate' | null
  /** True when the skill's author is not the caller (transitive trust). */
  external_author: boolean
  /**
   * The skill's classified category key (e.g. `frontend`, `design`). Drives the
   * generated cover art so clients render the same cover as the web. Public
   * skills only; absent when unclassified or from a server predating this field.
   */
  category?: string | null
  /** Basic eval status when not `none`. */
  eval?: EvalStatus
  /** Skill is deprecated (soft sunset); bytes still sync for existing kits. */
  deprecated?: boolean
  /** Canonical ref redirected via alias tables. */
  redirected_from?: string
  /**
   * Context-weight metering (approximate, cross-vendor). token_count is the
   * headline (ambient + body); token_ambient is the name + trigger description
   * kept hot for every materialized skill. Display only. Absent on older
   * servers or versions not yet backfilled.
   */
  token_count?: number
  token_ambient?: number
  token_method?: string
}

export interface SyncManifest {
  /** Wire-format version for this manifest shape. */
  schema_version: ArtifactSchemaVersion
  /** Aggregate ETag for the manifest as a whole (`sha256:<hex>`). */
  etag: string
  /** Background-sync cadence hint; null means manual-only. */
  sync_interval_seconds: number | null
  /**
   * `user` is the only value our registry emits: the manifest is account-bound,
   * and an EMPTY manifest is an authoritative "this account/device should sync
   * nothing" (a deliberate zero-out). Optional for back-compat: older servers
   * omit it and clients fall back to a session-only heuristic. NOTE: this JSON
   * is not validated at parse time — an older self-hosted registry can still
   * send other strings (e.g. the retired `anonymous`) at runtime, so clients
   * must treat any unrecognized value as "never zero out" (see core's
   * `zeroOutAllowed`).
   */
  account_scope?: 'user'
  items: SyncManifestItem[]
}

/**
 * Content bundle returned by `GET /api/v1/sync/content/{content_hash}`.
 *
 * v1 transition: while storage is migrating to multi-file bundles, the
 * server keeps `content` (single-file) populated AND `files` once the bundle
 * model lands. Clients MUST prefer `files` when present.
 */
export interface ContentBundle {
  /** Wire-format version for bundle/content responses. */
  schema_version: ArtifactSchemaVersion
  content_hash: string
  /** Bundle path → encoded contents (PROTOCOL.md §2.1). */
  files?: Record<string, { enc: 'utf8' | 'base64'; data: string }>
  /** Legacy single-file content. */
  content?: string
}

/** One file's change in a version-to-version diff. */
export interface DiffResponseFile {
  path: string
  status: 'added' | 'removed' | 'modified' | 'unchanged'
  /** Unified-diff text for a text file; null for binary or unchanged files. */
  diff: string | null
  binary: boolean
}

/** Response shape for `GET /api/v1/skills/{owner}/{slug}/diff?from=&to=` —
 *  per-file graded diff feeding the "what's new" UI. `from` is null when `to`
 *  is the first published version. */
export interface DiffResponse {
  from: string | null
  to: string
  files: DiffResponseFile[]
}
