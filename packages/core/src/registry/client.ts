/**
 * Typed HTTP client for the Skillet registry (PROTOCOL §5/§6.1).
 *
 * Endpoints consumed (under `/api/v1/`, mounted on every Skillet-protocol
 * registry):
 *
 *   GET  /api/v1/skills/:author/:slug/manifest        — ETag/304, lists versions
 *   GET  /api/v1/skills/:author/:slug/versions/:hash  — full bundle + signature
 *   GET  /api/v1/sync/manifest?owner=<handle>         — union sync manifest
 *   GET  /api/v1/sync/content/:content_hash           — bundle by canonical hash
 *   GET  /api/v1/skills/:owner/:slug/diff?from=&to=   — server-rendered unified diff
 *   POST /api/v1/profiles                             — register an author handle
 *   POST /api/v1/skills                               — publish a signed bundle (§4)
 *   POST /api/v1/skills/:author/:slug/install         — bump install_count metric
 *
 * Design notes:
 * - Uses globalThis.fetch (Node ≥18). Injectable for tests via `fetchImpl`.
 * - ETag/If-None-Match wired through every cacheable read; the caller threads
 *   the previously-seen tag in and gets a `notModified: true` result back
 *   instead of having to interpret a 304 directly.
 * - All path-interpolated components are validated through `parseSkillRef`
 *   or hash-shape regex before joining — a hostile registry response cannot
 *   coerce the client into a different URL.
 * - Bundle normalisation: §2.1 lets the server return either `files`
 *   (multi-file canonical) or `content` (legacy single-file). The client
 *   surfaces a `DecodedBundle` either way so callers never branch on age.
 * - Content_hash is the canonical `sha256:<hex>` string everywhere the
 *   protocol uses it (PROTOCOL §2.2); the manifest endpoint's `latest_hash`
 *   ships raw hex for legacy reasons and is canonicalised on read.
 * - Bearer auth is supported via `token` on every method; until the
 *   server enforces it on the sync endpoints, an `?owner=` query stub is
 *   accepted on `getSyncManifest` so existing tests/dev runs work.
 */

import {
  CONTENT_HASH_PREFIX,
  REGISTRY_VERSION_PREFIX,
  canonicalContentHash,
  decodeBundle,
  type AuthorSignature,
  type BundleFiles,
  type ContentBundle,
  type DecodedBundle,
  type DiffResponse,
  type SignedDelegation,
  type SignedRevocation,
  type SkillManifest,
  type SyncManifest,
  resolveArtifactSchemaVersion,
} from '@skillet/protocol'
import { type Signature as Ed25519Envelope } from '../signing/envelope.js'
import { REGISTRY_API } from '../registry-api.js'
import { stableMachineId } from '../machine-identity.js'
import { parseSkillRef } from './identifier.js'

const HASH_RE = /^[0-9a-f]{64}$/
const PREFIXED_HASH_RE = /^sha256:[0-9a-f]{64}$/

/** Per-skill manifest enriched with the server's identity fields. */
export interface RegistryManifest extends SkillManifest {
  /** Hex Ed25519 key id; absent for unclaimed authors. */
  author_key_id?: string | null
  /** Base64 of the 32 raw Ed25519 public-key bytes; absent for unclaimed authors. */
  author_public_key?: string | null
  /** Per-version signature (and display-only semver label) carried on the manifest. */
  versions: Array<
    SkillManifest['versions'][number] & {
      signature?: AuthorSignature | null
      version_label?: string
    }
  >
}

/** A scan finding as carried on the publish response / scan_blocked body
 *  Snippets are never sent on the wire; file:line locates it. */
export interface ScanWireFinding {
  category: string
  confidence: 'low' | 'medium' | 'high'
  file: string
  lineStart: number
  lineEnd: number
  why: string
}

/** The shape of a 422 `scan_blocked` body (RegistryError.body when code is
 *  `scan_blocked`). `reason` distinguishes a leaked credential from a confirmed
 *  -dangerous verdict so the CLI can tailor the fix guidance. */
export interface ScanBlockedBody {
  error: 'scan_blocked'
  reason: 'secret' | 'quarantine'
  status: 'quarantined'
  message: string
  findings: ScanWireFinding[]
}

/** Cache-aware result wrapper — distinguishes 304 from 200 without exposing HTTP. */
export interface CacheableResult<T> {
  /** Strong ETag (quoted) as the server returned it. */
  etag: string | null
  /** True when the server responded 304. `value` is null in that case. */
  notModified: boolean
  value: T | null
}

/** A version response from `/api/v1/skills/:author/:slug/versions/:hash`. */
export interface VersionDetail {
  hash: string
  skill_id: string
  author: string
  slug: string
  bundle: DecodedBundle
  /** Canonical `sha256:<hex>` string the server says is the bundle's hash. */
  content_hash: string
  signature: AuthorSignature | null
  author_key_id: string | null
  /**
   * Base64 of the 32 raw Ed25519 public-key bytes (extension to §4).
   * Null when the publishing author has not yet claimed a key — in that case
   * the consumer MUST refuse TOFU pinning rather than fabricate one.
   */
  author_public_key: string | null
  /**
   * Inline SignedDelegation — present iff the version was signed by a
   * delegated DEVICE key. Lets the client verify device_sig ← cert ← primary
   * key offline. The client re-verifies cert_sig against its TOFU-pinned primary
   * key, never this registry-served material.
   */
  delegation: SignedDelegation | null
  metadata: Record<string, unknown>
  published_at: number
  published_by: string
  /** Display-only semver label ("X.Y.Z"); absent on older servers. */
  version_label?: string
}

/** One row of `GET /api/v1/delegations` (the caller's own delegations). */
export interface DelegationListItem {
  device_key_id: string
  label: string | null
  scopes: string[]
  issued_at: number
  expires_at: number
  revoked_at: number | null
  status: 'active' | 'expired' | 'revoked'
}

/** One row of `GET /api/v1/devices` (session-bound sync agents from connect/pair). */
export interface BearerDeviceListItem {
  device_id: string
  label: string | null
  created_at: number
  agents?: string[]
  agents_reported_at?: number | null
  client_kind?: string | null
  /** Every kind that has connected for this machine (additive, R4). */
  client_kinds?: string[] | null
  client_platform?: string | null
  /** Unix seconds of the device's last authenticated registry call. */
  last_seen_at?: number | null
  /** Stable machine identity; lets surfaces collapse one machine's rows. */
  machine_id?: string | null
}

/** One account-scoped update decision (server source of truth). `version_hash`
 *  is the canonical content hash; the local lock reconciles against it. */
export interface AccountDecision {
  skill_id: string
  version_hash: string
  state: 'approved' | 'rejected'
  source: 'web' | 'desktop' | 'cli' | 'auto'
  decided_at: number
}

export interface AccountDecisions {
  update_mode: 'auto' | 'manual'
  decisions: AccountDecision[]
  /**
   * Skill ids (author:slug) whose kit-removal is still undecided on the web
   * (R5). Devices HOLD these — no prune, no trash — until the user picks
   * Remove or Keep. Absent on older registries.
   */
  pending_removals?: string[]
}

/** Kit payload from GET /kits/by-handle/:owner/:slug. */
export interface RegistryKitView {
  id: string
  owner: string
  name: string
  slug: string
  description: string | null
  visibility: string
  subscribed?: boolean
  skills: Array<{
    skill_id: string
    description?: string | null
    visibility?: string
  }>
}

export interface RegistryClientOptions {
  /** Registry base URL, e.g. `https://registry.skillet.md`. No trailing slash. */
  baseUrl: string
  /** Optional Bearer token. Omit for public read paths. */
  token?: string
  /**
   * Client version sent as `X-Skillet-Client-Version` on every request so the
   * registry can evaluate a minimum-supported-version floor. Defaults to
   * `process.env.SKILLET_CLIENT_VERSION` (the CLI sets this to its build
   * version), so core never has to import the CLI's version constant.
   */
  clientVersion?: string
  /** Inject an alternate fetch impl for tests. Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch
}

export class RegistryError extends Error {
  readonly code: string
  readonly status?: number
  readonly body?: unknown
  constructor(code: string, message: string, status?: number, body?: unknown) {
    super(message)
    this.code = code
    this.status = status
    this.body = body
    this.name = 'RegistryError'
  }
}

export class RegistryClient {
  private readonly baseUrl: string
  private readonly token?: string
  private readonly clientVersion?: string
  private readonly machineId: string | null
  private readonly clientKind: 'cli' | 'desktop'
  private readonly fetchImpl: typeof fetch

  constructor(opts: RegistryClientOptions) {
    if (!opts.baseUrl || typeof opts.baseUrl !== 'string') {
      throw new Error('RegistryClient: baseUrl is required')
    }
    // Normalise — drop trailing slashes so `${baseUrl}${path}` is unambiguous.
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '')
    this.token = opts.token
    this.clientVersion = opts.clientVersion ?? process.env['SKILLET_CLIENT_VERSION'] ?? undefined
    // Identity convergence (R7): every authed request reports the machine and
    // client kind so the registry backfills device rows without a re-pair.
    // The desktop tray sets SKILLET_CLIENT_KIND=desktop on its sidecar spawn;
    // everything else is the CLI.
    this.machineId = stableMachineId()
    this.clientKind = process.env['SKILLET_CLIENT_KIND'] === 'desktop' ? 'desktop' : 'cli'
    const f = opts.fetchImpl ?? globalThis.fetch
    if (typeof f !== 'function') {
      throw new Error('RegistryClient: no fetch implementation available')
    }
    // Bind so the function keeps its receiver when stored on `this`.
    this.fetchImpl = f.bind(globalThis)
  }

  /**
   * The account this client's bearer resolves to, or null when anonymous,
   * offline, or the token is dead. Used by the update gate to resolve
   * "self" by account handle — web-first accounts have no local signing
   * key, so key identity alone cannot recognize their own skills.
   */
  async whoami(): Promise<{ user_id: string | null; handle: string | null } | null> {
    try {
      const res = await this.request('GET', '/whoami')
      if (res.status !== 200) return null
      const body = (await res.json()) as { user_id?: string | null; handle?: string | null }
      return { user_id: body.user_id ?? null, handle: body.handle ?? null }
    } catch {
      return null
    }
  }

  /** Public registry URL — useful when persisting where a skill came from. */
  get url(): string {
    return this.baseUrl
  }

  /**
   * GET /api/v1/skills/:author/:slug/manifest with optional `If-None-Match`.
   * Returns `notModified=true` when the server replies 304.
   */
  async getSkillManifest(
    ref: string,
    opts: { etag?: string | null } = {},
  ): Promise<CacheableResult<RegistryManifest>> {
    const { author, slug } = parseSkillRef(ref)
    const path = `/skills/${author}/${slug}/manifest`
    const res = await this.request('GET', path, { ifNoneMatch: opts.etag })
    if (res.status === 304) {
      return { etag: res.headers.get('etag'), notModified: true, value: null }
    }
    if (res.status !== 200) {
      await throwForStatus(res, `manifest for ${ref}`)
    }
    const body = (await res.json()) as RegistryManifest
    resolveArtifactSchemaVersion(body.schema_version, `manifest for ${ref}`)
    return {
      etag: res.headers.get('etag'),
      notModified: false,
      value: body,
    }
  }

  /**
   * GET /api/v1/skills/:author/:slug/versions/:hash.
   *
   * Accepts the hash as either `sha256:<hex>` or raw hex. The server stores
   * canonical hashes in their `sha256:`-prefixed form (PROTOCOL §2.2), so we
   * always send the prefixed form (URL-encoded). The result's `content_hash`
   * is always the canonical `sha256:<hex>` form so downstream verifies don't
   * have to branch on shape.
   */
  async getVersion(ref: string, hash: string): Promise<VersionDetail> {
    const { author, slug } = parseSkillRef(ref)
    const rawHash = stripHashPrefix(hash)
    if (!HASH_RE.test(rawHash)) {
      throw new RegistryError(
        'invalid_hash',
        `Hash ${JSON.stringify(hash)} must be 64 lowercase hex chars (optionally prefixed with sha256:)`,
      )
    }
    const prefixed = `${CONTENT_HASH_PREFIX}${rawHash}`
    const path = `/skills/${author}/${slug}/versions/${encodeURIComponent(prefixed)}`
    const res = await this.request('GET', path)
    if (res.status !== 200) {
      await throwForStatus(res, `version ${rawHash} for ${ref}`)
    }
    const body = (await res.json()) as {
      hash: string
      skill_id: string
      author: string
      slug: string
      files?: BundleFiles
      content?: string
      content_hash?: string
      signature: AuthorSignature | null
      author_key_id: string | null
      author_public_key?: string | null
      delegation?: SignedDelegation | null
      metadata?: Record<string, unknown>
      published_at: number
      published_by: string
      schema_version?: number
    }

    resolveArtifactSchemaVersion(body.schema_version, `version ${rawHash} for ${ref}`)

    const bundle = bundleFromResponse(body.files, body.content)
    return {
      hash: body.hash,
      skill_id: body.skill_id,
      author: body.author,
      slug: body.slug,
      bundle,
      content_hash:
        body.content_hash && PREFIXED_HASH_RE.test(body.content_hash)
          ? body.content_hash
          : `${CONTENT_HASH_PREFIX}${stripHashPrefix(body.hash)}`,
      signature: body.signature ?? null,
      author_key_id: body.author_key_id ?? null,
      author_public_key: body.author_public_key ?? null,
      delegation: body.delegation ?? null,
      metadata: body.metadata ?? {},
      published_at: body.published_at,
      published_by: body.published_by,
    }
  }

  /**
   * GET /api/v1/sync/manifest. PROTOCOL §6.1 — union of caller's default kit
   * + subscribed kits.
   *
   * Auth: `Authorization: Bearer` once the client has a session token. Until
   * then the server-side stub accepts `?owner=<handle>`; passing `owner` here
   * appends it to the query string for dev/test compatibility. New code SHOULD
   * use the bearer-token path.
   */
  async getSyncManifest(
    opts: { etag?: string | null; owner?: string; device?: string } = {},
  ): Promise<CacheableResult<SyncManifest>> {
    const params = new URLSearchParams()
    if (opts.owner) params.set('owner', opts.owner)
    if (opts.device) params.set('device', opts.device) // per-machine kit routing
    const qs = params.toString() ? `?${params.toString()}` : ''
    const res = await this.request('GET', `/sync/manifest${qs}`, {
      ifNoneMatch: opts.etag,
    })
    if (res.status === 304) {
      return { etag: res.headers.get('etag'), notModified: true, value: null }
    }
    if (res.status !== 200) {
      await throwForStatus(res, 'sync manifest')
    }
    const body = (await res.json()) as SyncManifest
    resolveArtifactSchemaVersion(body.schema_version, 'sync manifest')
    return { etag: res.headers.get('etag'), notModified: false, value: body }
  }

  /**
   * GET /api/v1/sync/content/:content_hash. Returns a decoded bundle alongside
   * the canonical hash the server stamped on it. Multi-file `files` is
   * preferred (PROTOCOL §2.1); legacy `content` is honoured as a fallback so
   * the client keeps working through the bundle-model migration.
   */
  async getContentBundle(
    contentHash: string,
  ): Promise<{ contentHash: string; bundle: DecodedBundle }> {
    const raw = stripHashPrefix(contentHash)
    if (!HASH_RE.test(raw)) {
      throw new RegistryError(
        'invalid_hash',
        `Hash ${JSON.stringify(contentHash)} must be 64 lowercase hex chars (optionally prefixed with sha256:)`,
      )
    }
    // The sync content route strips a `sha256:` prefix client-side, but the
    // version-detail route does not — keep both endpoints' URLs consistent
    // by always sending the prefixed form URL-encoded.
    const prefixed = `${CONTENT_HASH_PREFIX}${raw}`
    const res = await this.request('GET', `/sync/content/${encodeURIComponent(prefixed)}`)
    if (res.status !== 200) {
      await throwForStatus(res, `content bundle ${raw}`)
    }
    const body = (await res.json()) as ContentBundle
    resolveArtifactSchemaVersion(body.schema_version, 'sync content bundle')
    const bundle = bundleFromResponse(body.files, body.content)
    const requestedHash = PREFIXED_HASH_RE.test(contentHash)
      ? contentHash
      : `${CONTENT_HASH_PREFIX}${raw}`
    const recomputed = canonicalContentHash(bundle)
    if (recomputed !== requestedHash) {
      throw new RegistryError(
        'integrity_failed',
        `Content bundle hash mismatch (requested ${requestedHash}, recomputed ${recomputed})`,
      )
    }
    return {
      contentHash: requestedHash,
      bundle,
    }
  }

  /**
   * GET /api/v1/skills/:owner/:slug/diff?from=&to= — server-rendered unified
   * diff. Surfaced for completeness (§6.2); the consumer's graded-diff
   * UI computes the diff locally against materialized state, so this is used
   * only for cross-checks.
   */
  async getDiff(ref: string, from: string, to: string): Promise<DiffResponse> {
    const { author, slug } = parseSkillRef(ref)
    const f = stripHashPrefix(from)
    const t = stripHashPrefix(to)
    if (!HASH_RE.test(f) || !HASH_RE.test(t)) {
      throw new RegistryError(
        'invalid_hash',
        `Diff hashes must be 64 lowercase hex chars (got from=${from} to=${to})`,
      )
    }
    const qs = `?from=${f}&to=${t}`
    const res = await this.request('GET', `/skills/${author}/${slug}/diff${qs}`)
    if (res.status !== 200) {
      await throwForStatus(res, `diff for ${ref}`)
    }
    return (await res.json()) as DiffResponse
  }

  /**
   * POST /api/v1/profiles — register an author handle. Returns the created
   * profile body on 201. Throws RegistryError('handle_taken', ..., 409) when
   * the handle is already registered so the caller can detect re-login.
   */
  async createProfile(body: {
    id: string
    name: string
    avatar_url?: string
  }): Promise<Record<string, unknown>> {
    const res = await this.postRequest('/profiles', body)
    if (res.status === 409) {
      let b: unknown
      try {
        b = await res.json()
      } catch {
        b = null
      }
      throw new RegistryError('handle_taken', pickMessage(b) ?? 'Handle already registered', 409, b)
    }
    if (res.status !== 201) {
      await throwForStatus(res, `create profile ${body.id}`)
    }
    return (await res.json()) as Record<string, unknown>
  }

  /** Result of a successful publishSkill call. */
  // status 200 = content already known (idempotent no-op); 201 = new version
  async publishSkill(body: {
    author: string
    slug: string
    files: BundleFiles
    base_hash: string | null
    signature?: Ed25519Envelope
    publish_auth?: 'session'
    visibility?: 'private' | 'public'
    metadata?: Record<string, unknown>
  }): Promise<{
    hash: string
    skill_id: string
    version_url: string
    already_exists: boolean
    scan?: { status: 'clean' | 'flagged' | 'quarantined'; findings: ScanWireFinding[] }
  }> {
    const res = await this.postRequest('/skills', body)
    if (res.status === 409) {
      let b: unknown
      try {
        b = await res.json()
      } catch {
        b = null
      }
      throw new RegistryError('conflict', pickMessage(b) ?? 'Local is behind remote', 409, b)
    }
    // The publish gate hard-blocks a secret or quarantined verdict with
    // a 422 carrying the concrete findings. Surface it as a typed error so the
    // CLI can render the fix guidance instead of a generic HTTP failure.
    if (res.status === 422) {
      let b: unknown
      try {
        b = await res.json()
      } catch {
        b = null
      }
      const parsed = b as { error?: string; message?: string } | null
      if (parsed?.error === 'scan_blocked') {
        throw new RegistryError(
          'scan_blocked',
          parsed.message ?? 'Publish blocked by the scanner.',
          422,
          b,
        )
      }
    }
    if (res.status !== 200 && res.status !== 201) {
      await throwForStatus(res, `publish ${body.author}/${body.slug}`)
    }
    const payload = (await res.json()) as {
      hash: string
      skill_id: string
      version_url: string
      scan?: { status: 'clean' | 'flagged' | 'quarantined'; findings: ScanWireFinding[] }
    }
    return { ...payload, already_exists: res.status === 200 }
  }

  /**
   * POST /api/v1/skills/:author/:slug/proposals — submit a pending proposal.
   * Server returns 201 with `proposal_url` (not `review_url`).
   */
  async proposeSkill(body: {
    author: string
    slug: string
    files: BundleFiles
    base_hash: string | null
    signature: Ed25519Envelope
  }): Promise<{ proposal_id: string; proposal_url: string; state: string; proposed_hash: string }> {
    const { author, slug, ...rest } = body
    const path = `/skills/${encodeURIComponent(author)}/${encodeURIComponent(slug)}/proposals`
    const res = await this.postRequest(path, rest)
    if (res.status === 409) {
      let b: unknown
      try {
        b = await res.json()
      } catch {
        b = null
      }
      throw new RegistryError('conflict', pickMessage(b) ?? 'Local is behind remote', 409, b)
    }
    // Mirror publishSkill: the proposal secret gate hard-blocks with a 422
    // carrying concrete findings. Read the body ONCE — falling through to
    // throwForStatus after `res.json()` would re-read a consumed stream and lose
    // the server's real code/message.
    if (res.status === 422) {
      let b: unknown
      try {
        b = await res.json()
      } catch {
        b = null
      }
      const parsed = b as
        | { error?: string; message?: string; finding?: ScanWireFinding; findings?: ScanWireFinding[] }
        | null
      if (parsed?.error === 'scan_blocked') {
        // The proposal-create route emits a singular `finding`; publish/approve
        // use `findings`. Normalize to an array so one CLI parser handles both.
        const findings = parsed.findings ?? (parsed.finding ? [parsed.finding] : [])
        throw new RegistryError(
          'scan_blocked',
          parsed.message ?? 'Proposal blocked by the scanner.',
          422,
          { ...parsed, findings },
        )
      }
      // Any other 422 — surface the server's own code/message from the body we
      // already read (do NOT re-read via throwForStatus).
      throw new RegistryError(
        parsed?.error ?? 'unprocessable_entity',
        parsed?.message ?? `Proposal rejected (HTTP 422)`,
        422,
        b,
      )
    }
    if (res.status !== 201) {
      await throwForStatus(res, `propose ${author}/${slug}`)
    }
    const payload = (await res.json()) as {
      proposal_id: string
      proposal_url?: string
      state: string
      proposed_hash: string
    }
    return {
      proposal_id: payload.proposal_id,
      proposal_url:
        payload.proposal_url ?? `${REGISTRY_API}/skills/${author}/${slug}/proposals/${payload.proposal_id}`,
      state: payload.state,
      proposed_hash: payload.proposed_hash,
    }
  }

  /**
   * GET /api/v1/skills/:author/:slug/proposals — list proposals for a skill.
   */
  async listProposals(
    ref: string,
  ): Promise<
    Array<{
      proposal_id: string
      proposed_hash: string
      state: string
      proposer: string
      proposal_url: string
      created_at: number
    }>
  > {
    const { author, slug } = parseSkillRef(ref)
    const path = `/skills/${author}/${slug}/proposals`
    const res = await this.request('GET', path)
    if (res.status !== 200) {
      await throwForStatus(res, `list proposals for ${ref}`)
    }
    const body = (await res.json()) as {
      proposals: Array<{
        proposal_id: string
        proposed_hash: string
        state: string
        proposer: string
        proposal_url: string
        created_at: number
      }>
    }
    return body.proposals
  }

  /**
   * GET /api/v1/skills/:author/:slug/proposals/:proposalId — proposal detail.
   */
  async getProposal(
    ref: string,
    proposalId: string,
  ): Promise<{
    proposal_id: string
    proposed_hash: string
    base_hash: string | null
    state: string
    proposer: { handle: string; author_key_id: string | null }
    scan: { status: string }
    diff: Array<{ path: string; status: string; diff: string | null; binary: boolean }>
    created_at: number
    decided_by: string | null
    decided_at: number | null
    decision_note: string | null
  }> {
    const { author, slug } = parseSkillRef(ref)
    const path = `/skills/${author}/${slug}/proposals/${encodeURIComponent(proposalId)}`
    const res = await this.request('GET', path)
    if (res.status !== 200) {
      await throwForStatus(res, `get proposal ${proposalId} for ${ref}`)
    }
    return (await res.json()) as Awaited<ReturnType<RegistryClient['getProposal']>>
  }

  /**
   * POST /api/v1/delegations — register an author-signed device-key
   * delegation. Requires the caller's `claim`-scoped session token (the gate is
   * the same as /claim: a new device key is new authority). `already_exists`
   * is true on a 200 (idempotent re-POST of the identical cert).
   */
  async registerDelegation(body: {
    cert: SignedDelegation['cert']
    cert_sig: SignedDelegation['cert_sig']
    label?: string
  }): Promise<{
    device_key_id: string
    expires_at: number
    scopes: string[]
    already_exists: boolean
  }> {
    const res = await this.postRequest('/delegations', body)
    if (res.status === 409) {
      let b: unknown
      try {
        b = await res.json()
      } catch {
        b = null
      }
      throw new RegistryError(
        'device_key_in_use',
        pickMessage(b) ?? 'Device key id already in use',
        409,
        b,
      )
    }
    if (res.status !== 200 && res.status !== 201) {
      await throwForStatus(res, `register delegation ${body.cert.device_key_id}`)
    }
    const payload = (await res.json()) as {
      device_key_id: string
      expires_at: number
      scopes: string[]
    }
    return { ...payload, already_exists: res.status === 200 }
  }

  /**
   * GET /api/v1/delegations — list the caller's own delegations
   * (active + expired + revoked). Requires a session token.
   */
  async listDelegations(): Promise<DelegationListItem[]> {
    const res = await this.request('GET', '/delegations')
    if (res.status !== 200) {
      await throwForStatus(res, 'list delegations')
    }
    const body = (await res.json()) as { delegations?: DelegationListItem[] }
    return body.delegations ?? []
  }

  /**
   * GET /api/v1/authors/:handle/revoked-device-keys — public revoked device ids
   * for sync-time delegation refusal.
   */
  async listAuthorRevokedDeviceKeys(handle: string): Promise<string[]> {
    const normalized = handle.replace(/^@/, '').toLowerCase()
    const res = await this.request('GET', `/authors/${encodeURIComponent(normalized)}/revoked-device-keys`)
    if (res.status !== 200) {
      await throwForStatus(res, `list revoked device keys for @${normalized}`)
    }
    const body = (await res.json()) as { device_key_ids?: string[] }
    return body.device_key_ids ?? []
  }

  /**
   * GET /api/v1/devices — list bearer devices bound to the signed-in user
   * (machines linked via connect/pair or the connect wizard).
   */
  async listBearerDevices(): Promise<BearerDeviceListItem[]> {
    const res = await this.request('GET', '/devices')
    if (res.status !== 200) {
      await throwForStatus(res, 'list devices')
    }
    const body = (await res.json()) as { devices?: BearerDeviceListItem[] }
    return body.devices ?? []
  }

  /**
   * POST /api/v1/delegations/:device_key_id/revoke — submit an
   * author-signed revocation. Idempotent; a 404 means the device key is not the
   * caller's. Requires a session token.
   */
  async revokeDelegation(
    deviceKeyId: string,
    body: {
      revocation: SignedRevocation['revocation']
      revocation_sig: SignedRevocation['revocation_sig']
    },
  ): Promise<{ device_key_id: string; revoked_at: number }> {
    if (!/^[0-9a-f]{64}$/.test(deviceKeyId)) {
      throw new RegistryError(
        'invalid_device_key',
        `device_key_id ${JSON.stringify(deviceKeyId)} must be 64 lowercase hex chars`,
      )
    }
    const res = await this.postRequest(`/delegations/${deviceKeyId}/revoke`, body)
    if (res.status !== 200) {
      await throwForStatus(res, `revoke delegation ${deviceKeyId}`)
    }
    return (await res.json()) as { device_key_id: string; revoked_at: number }
  }

  /**
   * POST /api/v1/skills/:author/:slug/install — increment install_count once per
   * authenticated installer (user session, device, or kit-key). Anonymous calls
   * still increment on every request (legacy public-skill adds without a token).
   */
  async recordInstall(ref: string): Promise<void> {
    const { author, slug } = parseSkillRef(ref)
    const path = `/skills/${author}/${slug}/install`
    const res = await this.postRequest(path, {})
    if (res.status !== 200) {
      await throwForStatus(res, `record install for ${ref}`)
    }
  }

  /**
   * POST /api/v1/me/library/skills — save a skill to the caller's auto "Saved"
   * kit so `skillet add` produces a first-class Saved-kit member (synced,
   * consent-tracked, edit-capturable) rather than a bare install. Returns the
   * Saved kit ref/id, or null when the account has no claimed handle (403) —
   * the caller falls back to install-only in that case. Account-bound token
   * required.
   */
  async saveToLibrary(
    ref: string,
  ): Promise<{ kit_ref: string; kit_id: string; added: boolean } | null> {
    const { author, slug } = parseSkillRef(ref)
    const res = await this.postRequest('/me/library/skills', { author, slug })
    if (res.status === 403) return null // no claimed handle — install-only path
    if (res.status !== 200) {
      await throwForStatus(res, `save ${ref} to library`)
    }
    return (await res.json()) as { kit_ref: string; kit_id: string; added: boolean }
  }

  /** The account's update mode + recorded decisions — the device's reconciliation
   *  feed for the account-scoped approval model. Account-bound token required. */
  async getMyDecisions(): Promise<AccountDecisions> {
    const res = await this.request('GET', '/me/decisions')
    if (res.status !== 200) {
      await throwForStatus(res, 'account decisions')
    }
    return (await res.json()) as AccountDecisions
  }

  /** Record an approval for a published version, account-scoped. The server
   *  derives the canonical hash and the source; we only name the version. */
  async postApproval(skillId: string, versionHash: string): Promise<void> {
    const res = await this.postRequest('/approvals', {
      skill_id: skillId,
      version_hash: versionHash,
    })
    if (res.status !== 200) {
      await throwForStatus(res, `approve ${skillId}@${versionHash}`)
    }
  }

  async postRejection(skillId: string, versionHash: string): Promise<void> {
    const res = await this.postRequest('/rejections', {
      skill_id: skillId,
      version_hash: versionHash,
    })
    if (res.status !== 200) {
      await throwForStatus(res, `reject ${skillId}@${versionHash}`)
    }
  }

  /** Set the account update mode. Returns the new mode plus how many pending
   *  updates were applied (non-zero only when flipping to 'auto', which approves
   *  the pending queue). Account-bound token required. */
  async setUpdateMode(
    mode: 'auto' | 'manual',
  ): Promise<{ mode: 'auto' | 'manual'; applied: number }> {
    const res = await this.patchRequest('/me/update-mode', { mode })
    if (res.status !== 200) {
      await throwForStatus(res, `set update mode to ${mode}`)
    }
    return (await res.json()) as { mode: 'auto' | 'manual'; applied: number }
  }

  /** PATCH /api/v1/devices/:device_id — rename a device. Session renames any
   *  owned machine; a device token renames ITSELF (post plan 2026-07-08-002 the
   *  registry admits the device's own bearer). Returns the stored label
   *  (trimmed, control-chars stripped, 80-char clamped, empty → null). */
  async renameDevice(
    deviceId: string,
    label: string,
  ): Promise<{ device_id: string; label: string | null }> {
    const res = await this.patchRequest(`/devices/${encodeURIComponent(deviceId)}`, { label })
    if (res.status !== 200) {
      await throwForStatus(res, `rename device ${deviceId}`)
    }
    return (await res.json()) as { device_id: string; label: string | null }
  }

  /**
   * GET /api/v1/kits/by-handle/:owner/:slug — resolve a public kit permalink.
   */
  async getKitByHandle(owner: string, slug: string): Promise<RegistryKitView> {
    const path = `/kits/by-handle/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}`
    const res = await this.request('GET', path)
    if (res.status !== 200) {
      await throwForStatus(res, `kit @${owner}/${slug}`)
    }
    return (await res.json()) as RegistryKitView
  }

  /**
   * POST /api/v1/kits/:kitId/subscribe — follow a kit (session bearer required).
   */
  async subscribeKit(kitId: string): Promise<{ subscribed: boolean; kit_id: string }> {
    const res = await this.postRequest(`/kits/${encodeURIComponent(kitId)}/subscribe`, {})
    if (res.status === 201) {
      return (await res.json()) as { subscribed: boolean; kit_id: string }
    }
    await throwForStatus(res, `subscribe to kit ${kitId}`)
    throw new RegistryError('subscribe_failed', 'subscribe failed')
  }

  /**
   * PUT /api/v1/devices/:device_id/agents — report runtimes detected on this machine.
   */
  async reportDeviceAgents(deviceId: string, agents: string[]): Promise<void> {
    const res = await this.putRequest(`/devices/${encodeURIComponent(deviceId)}/agents`, {
      agents,
    })
    if (res.status !== 200) {
      await throwForStatus(res, `report device agents for ${deviceId}`)
    }
  }

  /**
   * PUT /api/v1/devices/:device_id/materializations — report per-skill,
   * per-runtime install outcome after a sync (powers the first-run reveal),
   * plus the set of skills this device currently keeps a local edit of
   * (`edited`, ref + baseline only). The registry reconciles the device's edit
   * flags to exactly that set — absence clears the flag (KTD2/R3).
   */
  async reportDeviceMaterializations(
    deviceId: string,
    materializations: Array<{ skill_slug: string; runtime: string; status: string }>,
    edited: Array<{ ref: string; baselineVersion: string | null; baselineHash: string }> = [],
  ): Promise<void> {
    const res = await this.putRequest(
      `/devices/${encodeURIComponent(deviceId)}/materializations`,
      { materializations, edited },
    )
    if (res.status !== 200) {
      await throwForStatus(res, `report device materializations for ${deviceId}`)
    }
  }

  private async request(
    method: 'GET',
    path: string,
    opts: { ifNoneMatch?: string | null } = {},
  ): Promise<Response> {
    const url = `${this.baseUrl}${REGISTRY_VERSION_PREFIX}${path}`
    const headers: Record<string, string> = { accept: 'application/json' }
    if (this.token) headers.authorization = `Bearer ${this.token}`
    if (this.clientVersion) headers['x-skillet-client-version'] = this.clientVersion
    if (this.machineId) headers['x-skillet-machine-id'] = this.machineId
    headers['x-skillet-client-kind'] = this.clientKind
    if (opts.ifNoneMatch) headers['if-none-match'] = opts.ifNoneMatch
    let res: Response
    try {
      res = await this.fetchImpl(url, { method, headers })
    } catch (err) {
      throw new RegistryError('network_error', `Registry request failed: ${(err as Error).message}`)
    }
    return res
  }

  /** Shared body-carrying request (POST/PUT/PATCH). The three verbs differ only
   *  in the method string, so they share one implementation. */
  private async bodyRequest(
    method: 'POST' | 'PUT' | 'PATCH',
    path: string,
    body: unknown,
  ): Promise<Response> {
    const url = `${this.baseUrl}${REGISTRY_VERSION_PREFIX}${path}`
    const headers: Record<string, string> = {
      accept: 'application/json',
      'content-type': 'application/json',
    }
    if (this.token) headers.authorization = `Bearer ${this.token}`
    if (this.clientVersion) headers['x-skillet-client-version'] = this.clientVersion
    if (this.machineId) headers['x-skillet-machine-id'] = this.machineId
    headers['x-skillet-client-kind'] = this.clientKind
    let res: Response
    try {
      res = await this.fetchImpl(url, { method, headers, body: JSON.stringify(body) })
    } catch (err) {
      throw new RegistryError('network_error', `Registry request failed: ${(err as Error).message}`)
    }
    return res
  }

  private postRequest(path: string, body: unknown): Promise<Response> {
    return this.bodyRequest('POST', path, body)
  }

  private putRequest(path: string, body: unknown): Promise<Response> {
    return this.bodyRequest('PUT', path, body)
  }

  private patchRequest(path: string, body: unknown): Promise<Response> {
    return this.bodyRequest('PATCH', path, body)
  }
}

/**
 * Strict shape conversion: prefer multi-file `files`, fall back to legacy
 * single-file `content`. A response with neither is malformed.
 */
function bundleFromResponse(
  files: BundleFiles | undefined,
  content: string | undefined,
): DecodedBundle {
  if (files && Object.keys(files).length > 0) {
    return decodeBundle(files)
  }
  if (typeof content === 'string') {
    // Legacy single-file: pack it back into the canonical bundle shape so the
    // hash + downstream materialization paths see one consistent input.
    return new Map([['SKILL.md', Buffer.from(content, 'utf8')]])
  }
  throw new RegistryError('malformed_response', 'Bundle response had neither `files` nor `content`')
}

function stripHashPrefix(s: string): string {
  return s.startsWith(CONTENT_HASH_PREFIX) ? s.slice(CONTENT_HASH_PREFIX.length) : s
}

async function throwForStatus(res: Response, what: string): Promise<never> {
  let body: unknown
  try {
    body = await res.json()
  } catch {
    body = await res.text().catch(() => null)
  }
  const code = pickCode(body) ?? `http_${res.status}`
  const message = pickMessage(body) ?? `${what} request failed (HTTP ${res.status})`
  throw new RegistryError(code, message, res.status, body)
}

function pickCode(body: unknown): string | null {
  if (body && typeof body === 'object' && 'error' in body) {
    const e = (body as { error: unknown }).error
    if (typeof e === 'string') return e
  }
  return null
}

function pickMessage(body: unknown): string | null {
  if (body && typeof body === 'object' && 'message' in body) {
    const m = (body as { message: unknown }).message
    if (typeof m === 'string') return m
  }
  return null
}
