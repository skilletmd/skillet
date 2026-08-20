import { PERMISSION_ORDER } from '@skillet/protocol'

export interface SkillVersion {
  version: string
  publishedAt: string
  changelog?: string
  /** Content hash of this version — powers the expand-to-diff view. Absent on
   *  older registries that don't return per-version hashes. */
  hash?: string
}

export type Runtime = 'claude' | 'chatgpt' | 'codex' | 'cursor' | 'windsurf' | 'hermes'
export type SignatureStatus = 'verified' | 'unverified'

/** Generic async-fetch lifecycle, shared by the search surfaces. */
export type AsyncStatus = 'idle' | 'loading' | 'ready' | 'error'

// ---------------------------------------------------------------------------
// Public scan surface (registry PR #214).
//
// The registry runs a static harm scan per published version and exposes the
// result publicly: a badge status on the catalog summary, and the per-finding
// detail on a separate scan endpoint. `pending` means the latest version's
// content has not finished scanning — the UI renders no badge in that case,
// never a stale one. `null` (summary only) is a legacy un-scanned version.
// ---------------------------------------------------------------------------

/** Full public scan status. `pending` renders no badge; only the three terminal states do. */
export type ScanStatus = 'pending' | 'clean' | 'flagged' | 'quarantined'
/** Badge-displayable subset of {@link ScanStatus} (excludes `pending`). */
export type SecurityStatus = 'clean' | 'flagged' | 'quarantined'
/** Per-finding confidence from the static scanner. */
export type FindingConfidence = 'low' | 'medium' | 'high'

/** One public finding row. */
export interface SecurityFinding {
  /** e.g. "risky-call", "exfil", "supply-chain". */
  category: string
  confidence: FindingConfidence
  /** Relative path within the skill bundle. */
  file: string
  /** First flagged line, when the scanner reports one. */
  line?: number
  /** 1–2 sentence human-readable explanation. */
  why: string
  /** Short flagged excerpt for an inline "peek". Present only when the registry
   *  served it (never for `secret` findings; gated for quarantined). */
  snippet?: string
  /** Author's explanation of why this flagged pattern is intentional. Public
   *  skills only; surfaced under the finding so installers see the rationale. */
  note?: string
  /** Aggregate (kit) mode only: the member skill this finding came from, so the
   *  kit panel can name which skill is flagged. Absent on single-skill reports. */
  skill?: { author: string; slug: string }
}

/**
 * Closed set of installer-facing capability keys. Mirrors the registry public
 * taxonomy (`PublicCapabilityEntry.capability`); intentionally disjoint from the
 * threat `category` on {@link SecurityFinding}. Expanding the set is follow-up work.
 */
export type CapabilityKey =
  | 'runs-shell'
  | 'network'
  | 'writes-files'
  | 'deletes-files'
  | 'reads-secrets'
  | 'install-hooks'
  | 'connects-mcp-server'
  | 'executes-generated'
  | 'injects-output-content'

/** One location backing a capability — drives the file-viewer drill-down. */
export interface SkillCapabilityEvidence {
  file: string
  lineStart: number
  lineEnd: number
  /** `code` = a bundled script; `instructions` = SKILL.md / markdown prose. */
  source: 'code' | 'instructions'
  /** The flagged lines themselves (≤3, dedented), resolved server-side from the
   *  bundle so the trust panel never needs whole-file text on the client. */
  snippet?: string
}

/** A member skill that contributes a capability to a kit's union (aggregate
 *  mode only). `risky` is that capability's risk *in this member*. */
export interface SkillCapabilityContributor {
  author: string
  slug: string
  risky: boolean
}

/** One installer-facing capability the skill exercises ("what can this do?"). */
export interface SkillCapability {
  capability: CapabilityKey
  /** True when a co-located threat finding makes this capability risky. */
  risky: boolean
  evidence: SkillCapabilityEvidence[]
  /** Aggregate (kit) mode only: the member skills that contribute this
   *  capability, risky-first. Absent on single-skill reports. */
  skills?: SkillCapabilityContributor[]
}

/**
 * Trust qualifier on a capability inventory (mirrors the registry
 * `CapabilityReport.analysis`). It is NOT about how many capabilities were
 * found — it is about whether everything executable was actually inspected:
 *   - `'full'`    → every executable-shaped file was inspected, so an EMPTY
 *     manifest is a real "nothing detected".
 *   - `'partial'` → at least one executable-shaped file went UN-inspected
 *     (unhandled language, oversized, or binary), so an empty manifest means
 *     "nothing found in what we could read" — never "this skill is inert".
 */
export type CapabilityAnalysis = 'full' | 'partial'

/**
 * A computed capability inventory: the detected capabilities AND the analysis
 * qualifier that says whether the manifest is complete. `null` (not this shape)
 * means never computed — see the four-state contract on {@link Skill.capabilities}.
 */
export interface SkillCapabilityReport {
  capabilities: SkillCapability[]
  analysis: CapabilityAnalysis
  /** Aggregate (kit) mode only: the union of member skills' threat findings,
   *  each tagged with its source skill. Absent on single-skill reports (their
   *  findings live on `Skill.security`). */
  findings?: SecurityFinding[]
  /** Aggregate (kit) mode only: the union of member skills' unscanned files,
   *  each tagged with its source skill. Absent on single-skill reports. */
  blindSpots?: BlindSpot[]
  /** Aggregate (kit) mode only: member skills that have no computed report at all
   *  (not yet scanned / no report for the pinned version). They roll the kit's
   *  analysis up to `partial` but contribute no capabilities or blind-spot files,
   *  so the panel names them instead of saying "some files couldn't be scanned". */
  unscannedSkills?: { author: string; slug: string }[]
  /** Aggregate (kit) mode only: member skills with no installable version at all
   *  (every version held by the scanner or yanked, so the kit resolves no hash).
   *  Distinct from {@link unscannedSkills} — these WERE scanned. */
  unavailableSkills?: { author: string; slug: string }[]
}

/**
 * A file the scanner couldn't inspect (binary-shaped, oversized, or an
 * unsupported language) — surfaced as the "Unscanned files" list. On a kit it
 * carries the member skill it came from; on a single skill `skill` is absent.
 */
export interface BlindSpot {
  file: string
  skill?: { author: string; slug: string }
}

/**
 * The single canonical chip order, shared by every capability surface (a skill's
 * manifest AND a kit's union of member capabilities). Sourced from the ONE
 * authoritative order in `@skillet/protocol` (`PERMISSION_ORDER`) so the web,
 * the registry, and the shared vocabulary never drift. The `CapabilityKey` cast
 * keeps the typed export — the ids in `PERMISSION_ORDER` ARE the capability keys.
 */
export const CAPABILITY_ORDER = PERMISSION_ORDER as readonly CapabilityKey[]

// Compile-time exhaustiveness guard (types only — erased at runtime). The order
// is sourced from the protocol's PERMISSION_ORDER, whose element type is the
// canonical id union. Asserting CapabilityKey and that union are mutually
// assignable means adding a key to CapabilityKey without ordering it in
// PERMISSION_ORDER (or the reverse) is a TS error here, not a silently-dropped chip.
type _OrderedCapabilityId = (typeof PERMISSION_ORDER)[number]
type _Assert<A extends B, B> = A
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- compile-time PERMISSION_ORDER sync
type _KeysAreOrdered = _Assert<CapabilityKey, _OrderedCapabilityId>
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- compile-time PERMISSION_ORDER sync
type _OrderedAreKeys = _Assert<_OrderedCapabilityId, CapabilityKey>

/** Detail-page security payload, mapped from the registry scan endpoint. */
export interface SkillSecurity {
  status: ScanStatus
  /** ISO 8601, or null while pending. */
  scannedAt: string | null
  findingCount: number
  findings: SecurityFinding[]
}

export interface Skill {
  author: string
  slug: string
  title: string
  description: string
  visibility?: 'private' | 'public'
  /** MDX long-form description. Real API slot: GET /v1/skills/:author/:slug/readme */
  longDescription?: string
  installCount: number
  latestVersion: string
  versions: SkillVersion[]
  tags?: string[]
  /** Declarative activation cues from SKILL.md `triggers:`. */
  triggers?: string[]
  /** Runtimes this skill targets. Real API slot: Skill.runtimes[] */
  runtimes?: Runtime[]
  /** Auto-assigned primary browse category (taxonomy key); null when private/unclassified. */
  category?: string | null
  /** Hub browse categories. Real API slot: Skill.categories[] */
  categories?: string[]
  /** One-click install / download URL. Real API slot: Skill.installUrl */
  installUrl?: string
  signatureStatus?: SignatureStatus
  /** Basic static eval status from latest version. */
  evalStatus?: 'passed' | 'failed' | 'none'
  /**
   * Invocation facts — how the skill triggers, orthogonal to the security scan.
   * `modelInvoked`: the agent can fire it on its own. `hasCommand`: the human can
   * run it by name. Undefined when not fetched; the page treats undefined as the
   * default (Automatic, no command).
   */
  modelInvoked?: boolean
  hasCommand?: boolean
  /**
   * Lifecycle: soft-sunset state. Present only in
   * the owner-authenticated detail — the public catalog hides deprecated skills
   * entirely, so for visitors this is always undefined.
   */
  deprecated?: boolean
  /**
   * Admin moderation state. `quarantined` → downloads are blocked (enforced by
   * the registry); the page surfaces the block instead of an install path.
   * Absent → `none`.
   */
  moderationStatus?: 'none' | 'unlisted' | 'quarantined'
  /** Owner-authored sunset note shown to owners on the skill page. */
  deprecationMessage?: string | null
  /** ISO timestamp the skill was deprecated. Present with {@link deprecated}. */
  deprecatedAt?: string | null
  /**
   * Public scan result for the detail page. Absent until the
   * registry scan endpoint resolves; `status: 'pending'` suppresses the badge.
   */
  security?: SkillSecurity
  /**
   * Installer-facing capability inventory ("what can this skill do?"). Loaded
   * for EVERY skill, clean ones included — independent of the threat-finding
   * gating on {@link SkillSecurity}. Four-state contract:
   *   - `undefined` → not fetched (no version hash / registry offline)
   *   - `null`      → analyzed lane absent (older version, never computed)
   *   - `[]`        → analyzed, nothing detected → "No capabilities detected"
   *   - non-empty   → detected capabilities, each with evidence locations
   */
  capabilities?: SkillCapability[] | null
  /**
   * Analysis qualifier for {@link capabilities} (registry `capabilities_analysis`).
   * Preserves null-vs-empty alongside `capabilities`:
   *   - `undefined`  → not fetched (mirrors `capabilities: undefined`)
   *   - `null`       → never computed (mirrors `capabilities: null`)
   *   - `'full'`     → everything executable was inspected — empty = truly inert
   *   - `'partial'`  → some files couldn't be inspected — an empty manifest is
   *     NOT a proof of inertness; the UI must not claim "No capabilities detected"
   */
  capabilitiesAnalysis?: CapabilityAnalysis | null
  /** Files the scanner couldn't inspect (the detail behind a `partial` analysis),
   *  surfaced as the "Unscanned files" list. `[]`/absent → no such files. */
  capabilitiesBlindSpots?: BlindSpot[]
  /** Handles of people the viewer follows who curate this skill in a public kit. */
  usedByYou?: string[]
  usedByYouCount?: number
  /** Everyone who curates this skill in a public kit, people you follow first. */
  usedByPeople?: Array<{
    handle: string
    name?: string | null
    avatarUrl?: string | null
    followed: boolean
  }>
  usedByCount?: number
  /** Mirror: this skill is a synced, unverified copy from a public repo (unclaimed). */
  isMirror?: boolean
  /** GitHub-synced from the owner's connected repo (ownership-verified, unsigned). */
  githubSynced?: boolean
  /** True while the sync is live; false once disconnected (frozen snapshot). */
  githubSyncedLive?: boolean
  /** Mirror: source URL for this skill's directory on GitHub. */
  mirrorSourceUrl?: string | null
  /** Mirror: source license. */
  mirrorLicense?: string | null
  /** A newer upstream version was scanned as a secret/quarantine and held back;
   *  the mirror stays installable on its last clean version. */
  mirrorUpstreamBlocked?: boolean
  /**
   * Approx token weight of the latest version (registry `token_count`) — the
   * full SKILL.md plus bundled scripts, a cross-vendor estimate, never an exact
   * per-model count. Absent until the registry backfills it.
   */
  tokenCount?: number
  /**
   * Approx always-on token cost (registry `token_ambient`): the name + trigger
   * kept in context for every skill, before any run. Absent until backfilled.
   */
  tokenAmbient?: number
  /** Estimation method label (registry `token_method`). Absent until backfilled. */
  tokenMethod?: string
  publishedAt: string
  updatedAt: string
}

/**
 * Compact, web-facing summary of a published skill as returned by the live
 * catalog endpoint `GET /v1/skills`. Field names mirror the wire
 * shape exactly (`install_count`, `latest_hash`, `created_at`) — do not
 * remap to the richer {@link Skill} type, which is the local mock/detail
 * shape and carries fields (categories, versions, title) the catalog does
 * not expose.
 */
export interface SkillSummary {
  author: string
  slug: string
  skill_id: string
  /** Human display title (SKILL.md frontmatter name). Falls back to a humanized slug. */
  title?: string | null
  description: string | null
  visibility?: 'private' | 'public'
  latest_hash: string | null
  /**
   * Latest version number — a bare 1-indexed count of published versions, shown
   * as v1, v2, … instead of a hash. Absent on legacy responses; 0 = nothing
   * published yet.
   */
  version?: number
  /**
   * Registry-computed semver label ("major.minor.patch") for the latest
   * version. Display only — preferred over the bare count when present;
   * null/absent on older registries.
   */
  version_label?: string | null
  install_count: number
  /** Unix epoch seconds. */
  created_at: number
  /**
   * Real "used by" faces — people who curate this skill in a public kit. Powers
   * the catalog card facepile. Snake-cased to mirror the registry wire shape;
   * absent on legacy/mock responses (the card then shows a count only, never
   * fabricated faces).
   */
  used_by?: Array<{ handle: string; name?: string | null; avatar_url?: string | null }>
  used_by_count?: number
  signatureStatus: SignatureStatus
  /**
   * Public scan badge status from the latest scanned version
   * (registry PR #214). `null`/absent = legacy un-scanned; `pending` renders no
   * badge. Mirrors the registry summary wire field exactly.
   */
  scanStatus?: ScanStatus | null
  /**
   * Admin moderation state (whole-skill). `quarantined` blocks downloads;
   * `unlisted` hides from discovery. Absent on legacy responses → treat as
   * `none`. Mirrors the registry summary wire field exactly.
   */
  moderationStatus?: 'none' | 'unlisted' | 'quarantined'
  /** Auto-assigned browse category (taxonomy key); null/absent when private or unclassified. */
  category?: string | null
  /**
   * Owner-only: the skill is unlisted (deprecated). The public author list never
   * returns deprecated skills, so this is only ever `true` on an owner/manager
   * view. Absent on legacy responses → treat as `false`.
   */
  deprecated?: boolean
  /**
   * Flagged-finding count, when the registry exposes it on the summary. Absent
   * on the catalog summary today (count lives on the detail scan endpoint), so
   * the card badge degrades to a count-less "flagged" when this is missing.
   */
  securityFindingCount?: number
}

/** Envelope returned by `GET /v1/skills` — most-installed first. */
export interface SkillCatalogResponse {
  skills: SkillSummary[]
  total: number
  limit: number
  offset: number
}

export interface AuthorProfileKit {
  id: string
  /** URL slug, unique per owner. Permalink is `/kits/{owner}/{slug}`. */
  slug?: string
  /** Curator handle (the profile owner for owned kits, someone else for subscribed). */
  owner?: string
  name: string
  description?: string | null
  visibility: 'public' | 'private'
  skillCount: number
  /** Skill refs (author/slug) for the generated cover. */
  skillRefs?: string[]
  /** Member skills' categories, parallel to skillRefs — drives the cover hues so
   *  the cover matches the kit's permalink. */
  skillCategories?: (string | null)[]
  /** Plurality category of the kit's skills — drives the cover glyph. */
  category?: string | null
  /** The kit owner's avatar photo — shown beside @owner in the card subtitle. */
  avatarUrl?: string | null
  subscribed?: boolean
}

/** A virtual "everything @owner publishes" kit reference. */
export interface ProfileAuthorKit {
  owner: string
  name: string
  skillCount: number
  /** Owner-only count of unpublished skills. An author kit is what subscribers
   *  receive, so it is served public-only; this keeps the owner's own work
   *  visible to them without ever folding it into the subscription. */
  privateCount?: number
  skillRefs: string[]
  /** Member skills' categories, parallel to skillRefs — drives the cover hues. */
  skillCategories?: (string | null)[]
  subscribed: boolean
  isTeam?: boolean
  /** Owner's avatar — author kits render it as a round cover (a person). */
  avatarUrl?: string | null
}

export interface AuthorProfile {
  username: string
  displayName: string
  kind?: 'user' | 'team'
  bio?: string
  avatarUrl?: string
  profileUrl?: string
  skills: Skill[]
  teams?: Array<{ slug: string; name: string; role: string }>
  /** A team page's public member roster (owner/admin first). Absent on user pages. */
  members?: Array<{ handle: string; name: string; avatarUrl: string | null; role: string }>
  kits?: AuthorProfileKit[]
  /** Kits this profile owner subscribes to (public-only for outside viewers). */
  subscribedKits?: AuthorProfileKit[]
  /** Author kits ("everything @X publishes") this profile owner subscribes to. */
  subscribedAuthorKits?: ProfileAuthorKit[]
  /** Skills the profile owner saved one-click (public-only for outside viewers). */
  savedSkills?: Array<{
    skill_id: string
    description: string | null
    category: string | null
    install_count: number
  }>
  /** Back-compat: the publicly shown runtime keys (= runtimes.map(r => r.key)). */
  detectedRuntimes?: string[]
  /** Curated public "Runs on" list; `verified` = detected on a connected device. */
  runtimes?: Array<{ key: string; verified: boolean }>
  /** Owner-only: full device-detected union (palette source for the settings UI). */
  detectedAgentsAll?: string[]
  /** Owner-only: raw curated selection; `null`/absent = uncurated (legacy fallback). */
  shownAgents?: string[] | null
  /** Whether the viewer shows their detected runtimes publicly (legacy owner flag). */
  agentsPublic?: boolean
  /** Public handles for connected GitHub / X accounts, for profile links. */
  socials?: { github?: string; twitter?: string }
  totalInstalls: number
  joinedAt: string
  /** Trust graph: follower count for this profile. */
  followers?: number
  /** Trust graph: number of authors this profile follows. */
  following?: number
  /** Trust graph: whether the viewing session already follows this profile. */
  followedByMe?: boolean
  /** Trust graph: handles of people the viewer follows who also follow this profile. */
  followedByYou?: string[]
  followedByYouCount?: number
  /** Author's pinned Ed25519 key fingerprint (TOFU). Real API slot: AuthorProfile.keyId */
  keyId?: string
  /** Whether the author's Ed25519 key has been pinned. Real API slot: AuthorProfile.verified */
  verified?: boolean
  /** Mirror: this handle is a synced, unclaimed brand imported from a public repo. */
  isMirror?: boolean
  /** Mirror: the source repo URL (e.g. github.com/cloudflare/skills). */
  mirrorSourceUrl?: string | null
  /** Mirror: the source license (e.g. Apache-2.0). */
  mirrorLicense?: string | null
  /** Mirror: GitHub source owner type — gates the claim affordances ('User' can
   *  offer a personal-account path; 'Organization' / null cannot). */
  sourceOwnerType?: 'User' | 'Organization' | null
}

// ---------------------------------------------------------------------------
// Proposal lifecycle.
//
// A proposal is an untrusted change bundle that enters `pending` and must be
// explicitly approved by the skill owner before a version is minted. These
// shapes mirror the registry wire contract exactly (snake_case) so the web
// reads the proposal GET endpoints without a remap layer:
//   GET  /v1/skills/:author/:slug/proposals          → ProposalSummary[]
//   GET  /v1/skills/:author/:slug/proposals/:id       → ProposalDetail
//   POST /v1/skills/:author/:slug/proposals/:id/decision
// Shared by the notification surface and the review surface
// so the two never diverge on field names. Do not fork these.
// ---------------------------------------------------------------------------

/** Lifecycle state of a proposal. Only `pending` proposals await a decision. */
export type ProposalState = 'pending' | 'approved' | 'changes_requested' | 'rejected'

/** Harm-scan verdict on the proposed bundle. `pending` = async scan not done. */
export type ProposalScanStatus = 'pending' | 'clean' | 'flagged' | 'quarantined'

export interface ProposalScan {
  status: ProposalScanStatus
  /** Present once the scan has run; absent while `pending`. */
  findings_summary?: {
    total: number
    by_category?: Record<string, number>
    highest_confidence?: string | null
  }
}

/** One entry in `GET .../proposals` — enough to notify + count, no diff. */
export interface ProposalSummary {
  proposal_id: string
  skill_id: string
  base_hash: string | null
  proposed_hash: string
  state: ProposalState
  /** Proposer handle (author id). */
  proposer: string
  /** Unix epoch seconds. */
  created_at: number
  decided_by: string | null
  decided_at: number | null
  decision_note: string | null
  /** API-relative detail URL, e.g. `/api/v1/skills/:author/:slug/proposals/:id`. */
  proposal_url: string
  scan: ProposalScan
}

export interface ProposalListResponse {
  proposals: ProposalSummary[]
}

/** A single proposed change to a bundle file, graded against the base version. */
export interface ProposalFileDiff {
  path: string
  status: 'added' | 'removed' | 'modified' | 'unchanged'
  /** Unified diff text for text files; `null` for binary or unchanged files. */
  diff: string | null
  binary: boolean
}

/** Detail envelope from `GET .../proposals/:id` — adds proposer key + diff. */
export interface ProposalDetail {
  proposal_id: string
  skill_id: string
  base_hash: string | null
  proposed_hash: string
  state: ProposalState
  proposer: {
    handle: string
    author_key_id: string | null
    author_public_key: string | null
  }
  signature: { alg: string; key_id: string; sig: string } | null
  created_at: number
  decided_by: string | null
  decided_at: number | null
  decision_note: string | null
  scan: ProposalScan
  diff: ProposalFileDiff[]
  /** Whether the authenticated viewer may decide this proposal (owner/manager
   *  with a handle + verified email). Per-action invariants (e.g. a proposer
   *  can't approve their own change) stay server-enforced. Optional in the
   *  wire type, but the client fails closed — absent reads as read-only. */
  can_decide?: boolean
}
