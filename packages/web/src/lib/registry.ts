import { cache } from 'react'
import type {
  AuthorProfile,
  CapabilityAnalysis,
  CapabilityKey,
  FindingConfidence,
  ScanStatus,
  SecurityFinding,
  SignatureStatus,
  Skill,
  SkillCapabilityReport,
  SkillSecurity,
  SkillSummary,
} from './types'
import { formatVersion } from './format'
import { humanizeSlug } from './humanize-slug'
import { RegistryUnavailableError, logRegistryDegrade } from './registry-errors'
import { REGISTRY_API } from './registry-prefix'
import { encodeRegistrySegment, registrySkillSubPath } from './registry-path-segments'
import { MOCK_AUTHORS, MOCK_SKILLS, REGISTRY_BASE_URL } from './registry-mock'
import { mapDiscoverFeedEvents, type FeedEventResponse } from './registry-feed-mapper'
import {
  mapNotificationEvents,
  type NotificationEventResponse,
  type NotificationsResult,
} from './registry-notifications'
import type { SkillCatalogParams } from './registry-catalog'
import type {
  FeedEvent,
  FeedResult,
  FeedView,
  FollowSuggestion,
} from './registry-feed-types'

export { RegistryUnavailableError } from './registry-errors'
export type {
  DirectoryCatalog,
  KitCatalogEntry,
  PersonCatalogEntry,
  SkillCatalogParams,
} from './registry-catalog'
export type {
  FeedEvent,
  FeedFollowEvent,
  FeedFollowTarget,
  FeedResult,
  FeedSkill,
  FeedSignalEvent,
  FeedSkillEvent,
  FeedStoryEvent,
  FeedSubscribeEvent,
  FeedView,
} from './registry-feed-types'

async function catalog<T>(load: () => Promise<T>): Promise<T> {
  return load()
}

export async function getSkillCatalog(params: SkillCatalogParams = {}) {
  const { getSkillCatalog: load } = await import('./registry-catalog')
  return catalog(() => load(params))
}

export async function getKitCatalog(
  params: Parameters<(typeof import('./registry-catalog'))['getKitCatalog']>[0] = {},
) {
  const { getKitCatalog: load } = await import('./registry-catalog')
  return catalog(() => load(params))
}

export async function getPeopleCatalog(
  params: Parameters<(typeof import('./registry-catalog'))['getPeopleCatalog']>[0] = {},
) {
  const { getPeopleCatalog: load } = await import('./registry-catalog')
  return catalog(() => load(params))
}

export async function getKitsForSkill(author: string, slug: string) {
  const { getKitsForSkill: load } = await import('./registry-catalog')
  return catalog(() => load(author, slug))
}

export type {
  CategoryStat,
  GrowthPoint,
  MetricSeries,
  RegistryStats,
  RegistryTotals,
} from './registry-stats'

export async function getRegistryStats() {
  const { getRegistryStats: load } = await import('./registry-stats')
  return catalog(() => load())
}

export type { FollowSuggestion } from './registry-feed-types'

export interface FollowPerson {
  handle: string
  name: string
  avatarUrl: string | null
  bio: string | null
}

/**
 * Followers or following list for an author — `GET /v1/profiles/:author/
 * followers|following`. Returns the enriched people and the total count.
 */
export async function getFollowList(
  author: string,
  kind: 'followers' | 'following',
): Promise<{ people: FollowPerson[]; count: number }> {
  if (!REGISTRY_BASE_URL) return { people: [], count: 0 }
  let res: Response
  try {
    res = await fetch(`${REGISTRY_BASE_URL}${REGISTRY_API}/profiles/${encodeURIComponent(author)}/${kind}`, {
      next: { revalidate: 30 },
    })
  } catch (cause) {
    logRegistryDegrade(`follow list fetch failed: ${author}/${kind}`, cause)
    throw new RegistryUnavailableError('Could not reach the skill registry.', { cause })
  }
  if (!res.ok) {
    logRegistryDegrade(`follow list responded ${res.status}: ${author}/${kind}`)
    throw new RegistryUnavailableError(`The skill registry responded ${res.status}.`)
  }
  const body = (await res.json()) as Record<string, unknown>
  const rows = Array.isArray(body[kind]) ? (body[kind] as Record<string, unknown>[]) : []
  return {
    people: rows.map((r) => ({
      handle: String(r.handle),
      name: String(r.name ?? r.handle),
      avatarUrl: (r.avatar_url as string | null) ?? null,
      bio: (r.bio as string | null) ?? null,
    })),
    count: typeof body.count === 'number' ? body.count : rows.length,
  }
}

/**
 * The identifiable people who have adopted an author's work — installed a skill
 * while signed in, saved one into a kit, or subscribed to one of their kits.
 * `GET /v1/profiles/:author/adopters`. Anonymous CLI installs carry no person
 * and are omitted, so `count` can be smaller than the profile's install total.
 */
export async function getAdopters(
  author: string,
): Promise<{ people: FollowPerson[]; count: number }> {
  if (!REGISTRY_BASE_URL) return { people: [], count: 0 }
  let res: Response
  try {
    res = await fetch(
      `${REGISTRY_BASE_URL}${REGISTRY_API}/profiles/${encodeURIComponent(author)}/adopters`,
      { next: { revalidate: 30 } },
    )
  } catch (cause) {
    logRegistryDegrade(`adopter list fetch failed: ${author}`, cause)
    throw new RegistryUnavailableError('Could not reach the skill registry.', { cause })
  }
  if (!res.ok) {
    logRegistryDegrade(`adopter list responded ${res.status}: ${author}`)
    throw new RegistryUnavailableError(`The skill registry responded ${res.status}.`)
  }
  const body = (await res.json()) as Record<string, unknown>
  const rows = Array.isArray(body.adopters) ? (body.adopters as Record<string, unknown>[]) : []
  return {
    people: rows.map((r) => ({
      handle: String(r.handle),
      name: String(r.name ?? r.handle),
      avatarUrl: (r.avatar_url as string | null) ?? null,
      bio: (r.bio as string | null) ?? null,
    })),
    count: typeof body.count === 'number' ? body.count : rows.length,
  }
}

// ---- Detail + author live wiring (snake_case -> UI shapes) ----
//
// The catalog returns SkillSummary as-is, but the skill-detail and author-page
// endpoints return richer snake_case envelopes that must be mapped to the
// camelCase Skill / AuthorProfile the pages render. The summary endpoints carry
// no title / tag list / full version history (only latest_hash), so we degrade
// gracefully: title := humanized slug, and a single synthetic "latest" version.

/** `GET /v1/skills/:author/:slug` — SkillSummary + author display + key fields. */
interface SkillDetailResponse extends SkillSummary {
  /** Version history (newest first); `changelog` carries the proposer credit. */
  versions?: Array<{
    hash: string
    published_at: number
    /** Semver label ("major.minor.patch") for this row; absent on older registries. */
    version_label?: string | null
    changelog?: string
    proposed_by?: string
  }>
  author_name: string | null
  author_avatar_url: string | null
  /** Approx token weight of the latest version (full SKILL.md + bundled scripts,
   *  cross-vendor estimate). Absent until backfilled. */
  token_count?: number
  /** Approx always-on cost of the latest version (name + trigger held in context). */
  token_ambient?: number
  /** Estimation method label. */
  token_method?: string
  is_mirror?: boolean
  github_synced?: boolean
  github_synced_live?: boolean
  mirror_source_url?: string | null
  mirror_license?: string | null
  mirror_upstream_blocked?: boolean
  /** Lifecycle — present only in the owner-authenticated detail (public
   *  callers get a 410 tombstone instead). */
  deprecated?: boolean
  deprecation_message?: string | null
  deprecated_at?: number | null
  author_key_id: string | null
  author_public_key: string | null
  manifest_url: string
  triggers?: string[]
  eval?: 'passed' | 'failed' | 'none'
  /** Invocation facts — how the skill triggers (orthogonal to the security scan). */
  model_invoked?: boolean
  has_command?: boolean
  used_by_you?: string[]
  used_by_you_count?: number
  used_by?: Array<{
    handle: string
    name?: string | null
    avatar_url?: string | null
    followed: boolean
  }>
  used_by_count?: number
  // Public scan (registry PR #214). The summary-level
  // `scanStatus` rides on SkillSummary. PR #214 serves the per-finding detail on
  // a separate `/versions/:hash/scan` endpoint, not inline here — so this nested
  // block is normally absent and `hydrateSecurityFindings` fetches the report to
  // populate the tab. The field is kept for forward-compat in case the detail
  // endpoint ever embeds findings (mapSecurity prefers it when present).
  security?: {
    status: ScanStatus
    scanned_at?: string | null
    finding_count?: number
    findings?: Array<{
      category: string
      confidence: FindingConfidence
      file: string
      line?: number
      // PR #214 reports a line range; accept either and collapse to the start.
      lineStart?: number
      lineEnd?: number
      why: string
    }>
  }
}

/** `GET /v1/authors/:username` — public author page. */
interface AuthorPageResponse {
  id: string
  name: string
  avatar_url: string | null
  bio?: string | null
  profile_url?: string | null
  created_at: number // unix seconds
  kind?: 'user' | 'team'
  is_mirror?: boolean
  mirror_source_url?: string | null
  mirror_license?: string | null
  /** Mirror's GitHub source owner type — gates the web claim affordances. */
  source_owner_type?: 'User' | 'Organization' | null
  total_installs: number
  total_summons?: number
  /** Suggested invocations. `null` = never generated, `[]` = nothing confident. */
  suggestions?: Array<{ task: string; ref: string }> | null
  suggestions_voice?: 'first-person' | 'third-person'
  followers?: number
  following?: number
  followed_by_me?: boolean
  followed_by_you?: string[]
  followed_by_you_count?: number
  skills: SkillSummary[]
  teams?: Array<{ slug: string; name: string; role: string }>
  members?: Array<{ handle: string; name: string; avatar_url: string | null; role: string }>
  kits?: AuthorKitResponse[]
  subscribed_kits?: AuthorKitResponse[]
  subscribed_author_kits?: Array<{
    owner: string
    name: string
    skill_count: number
    skill_ids?: string[]
    skill_categories?: (string | null)[]
    is_team?: boolean
    avatar_url?: string | null
  }>
  saved_skills?: Array<{
    skill_id: string
    description: string | null
    category: string | null
    install_count: number
  }>
  detected_runtimes?: string[]
  runtimes?: Array<{ key: string; verified: boolean }>
  detected_agents_all?: string[]
  shown_agents?: string[] | null
  agents_public?: boolean
  socials?: { github: string | null; twitter: string | null }
}

interface AuthorKitResponse {
  id: string
  slug?: string
  owner?: string
  name: string
  description: string | null
  visibility: 'public' | 'private'
  skill_count: number
  skill_ids?: string[]
  skill_categories?: (string | null)[]
  category?: string | null
  avatar_url?: string | null
  subscribed?: boolean
}

function unixToIso(seconds: number): string {
  // registry stores unixepoch() (seconds); guard in case a caller passes ms.
  const ms = seconds < 1e12 ? seconds * 1000 : seconds
  return new Date(ms).toISOString()
}

// Prefer the registry-computed semver label (v2.1.0), then the bare version
// count (v1, v2, …); fall back to a hash slice only for legacy responses
// that predate both fields.
function latestVersionOf(s: SkillSummary): string {
  if (s.version_label) return formatVersion(s.version_label)
  if (typeof s.version === 'number' && s.version > 0) return formatVersion(String(s.version))
  return s.latest_hash ? s.latest_hash.slice(0, 12) : 'latest'
}

function mapSummary(s: SkillSummary): Skill {
  const publishedAt = unixToIso(s.created_at)
  const latestVersion = latestVersionOf(s)
  const signatureStatus: SignatureStatus = s.signatureStatus
  return {
    author: s.author,
    slug: s.slug,
    title: humanizeSlug(s.slug),
    description: s.description ?? '',
    visibility: s.visibility === 'private' ? 'private' : 'public',
    installCount: s.install_count,
    latestVersion,
    versions: s.latest_hash ? [{ version: latestVersion, publishedAt }] : [],
    category: s.category ?? null,
    signatureStatus,
    ...(s.moderationStatus && s.moderationStatus !== 'none'
      ? { moderationStatus: s.moderationStatus }
      : {}),
    ...(s.deprecated ? { deprecated: true } : {}),
    publishedAt,
    updatedAt: publishedAt,
  }
}

function mapDetail(d: SkillDetailResponse): Skill {
  const skill = mapSummary(d)
  // Real version history from the registry (newest first). Prefer each row's
  // semver label; older registries omit it, so fall back to the positional vN
  // (newest = highest). The changelog already carries any "Proposed by" credit.
  if (Array.isArray(d.versions) && d.versions.length > 0) {
    const n = d.versions.length
    skill.versions = d.versions.map((v, i) => ({
      version: formatVersion(v.version_label ?? String(n - i)),
      publishedAt: unixToIso(v.published_at),
      ...(v.changelog ? { changelog: v.changelog } : {}),
      ...(v.hash ? { hash: v.hash } : {}),
    }))
  }
  if (Array.isArray(d.triggers) && d.triggers.length > 0) {
    skill.triggers = d.triggers
  }
  if (d.eval === 'passed' || d.eval === 'failed' || d.eval === 'none') {
    skill.evalStatus = d.eval
  }
  if (typeof d.model_invoked === 'boolean') skill.modelInvoked = d.model_invoked
  if (typeof d.has_command === 'boolean') skill.hasCommand = d.has_command
  if (typeof d.token_count === 'number') skill.tokenCount = d.token_count
  if (typeof d.token_ambient === 'number') skill.tokenAmbient = d.token_ambient
  if (typeof d.token_method === 'string') skill.tokenMethod = d.token_method
  if (Array.isArray(d.used_by_you)) {
    skill.usedByYou = d.used_by_you
    skill.usedByYouCount = d.used_by_you_count ?? d.used_by_you.length
  }
  if (Array.isArray(d.used_by)) {
    skill.usedByPeople = d.used_by.map((u) => ({
      handle: u.handle,
      name: u.name,
      avatarUrl: u.avatar_url,
      followed: u.followed,
    }))
    skill.usedByCount = d.used_by_count ?? d.used_by.length
  }
  const security = mapSecurity(d)
  if (security) skill.security = security
  if (d.is_mirror) skill.isMirror = true
  if (d.github_synced) skill.githubSynced = true
  if (d.github_synced_live) skill.githubSyncedLive = true
  if (d.is_mirror || d.github_synced) {
    skill.mirrorSourceUrl = d.mirror_source_url ?? null
    skill.mirrorLicense = d.mirror_license ?? null
    if (d.mirror_upstream_blocked) skill.mirrorUpstreamBlocked = true
    // No latest_hash means every version was held by the scanner: there is
    // nothing to serve, so the page must not render an install path.
    skill.hasInstallableVersion = Boolean(d.latest_hash)
  }
  if (d.deprecated) {
    skill.deprecated = true
    skill.deprecationMessage = d.deprecation_message ?? null
    skill.deprecatedAt = typeof d.deprecated_at === 'number' ? unixToIso(d.deprecated_at) : null
  }
  return skill
}

/**
 * Map the public scan onto the detail Skill. Prefers the nested
 * `security` block when present; otherwise synthesizes a findings-less result
 * from the summary-level `scanStatus` so the badge + summary line render
 * immediately. `hydrateSecurityFindings` then fills in the findings list from
 * the separate scan endpoint (PR #214). Returns undefined when the version is
 * un-scanned, so the detail page shows nothing.
 */
function mapSecurity(d: SkillDetailResponse): SkillSecurity | undefined {
  if (d.security) {
    const findings: SecurityFinding[] = (d.security.findings ?? []).map((f) => ({
      category: f.category,
      confidence: f.confidence,
      file: f.file,
      line: f.line ?? f.lineStart,
      why: f.why,
    }))
    return {
      status: d.security.status,
      scannedAt: d.security.scanned_at ?? null,
      findingCount: d.security.finding_count ?? findings.length,
      findings,
    }
  }
  if (d.scanStatus) {
    return {
      status: d.scanStatus,
      scannedAt: null,
      findingCount: d.securityFindingCount ?? 0,
      findings: [],
    }
  }
  return undefined
}

function mapAuthorKit(k: AuthorKitResponse) {
  return {
    id: k.id,
    slug: k.slug,
    owner: k.owner,
    name: k.name,
    description: k.description,
    visibility: k.visibility,
    skillCount: k.skill_count,
    skillRefs: (k.skill_ids ?? []).map((id) => id.replace(':', '/')),
    skillCategories: k.skill_categories ?? [],
    category: k.category ?? null,
    avatarUrl: k.avatar_url ?? null,
    subscribed: k.subscribed,
  }
}

function mapAuthor(a: AuthorPageResponse): AuthorProfile {
  return {
    username: a.id,
    displayName: a.name,
    kind: a.kind ?? 'user',
    bio: a.bio ?? undefined,
    avatarUrl: a.avatar_url ?? undefined,
    profileUrl: a.profile_url ?? undefined,
    skills: a.skills.map(mapSummary),
    teams: a.teams,
    members: a.members?.map((m) => ({
      handle: m.handle,
      name: m.name,
      avatarUrl: m.avatar_url,
      role: m.role,
    })),
    kits: a.kits?.map(mapAuthorKit),
    subscribedKits: a.subscribed_kits?.map(mapAuthorKit),
    subscribedAuthorKits: a.subscribed_author_kits?.map((k) => ({
      owner: k.owner,
      name: k.name,
      skillCount: k.skill_count,
      skillRefs: (k.skill_ids ?? []).map((id) => id.replace(':', '/')),
      skillCategories: k.skill_categories ?? [],
      subscribed: true,
      isTeam: k.is_team ?? false,
      avatarUrl: k.avatar_url ?? null,
    })),
    savedSkills: a.saved_skills ?? [],
    totalInstalls: a.total_installs,
    totalSummons: a.total_summons ?? 0,
    suggestions: a.suggestions ?? null,
    suggestionsVoice: a.suggestions_voice ?? 'third-person',
    joinedAt: unixToIso(a.created_at),
    followers: a.followers ?? 0,
    following: a.following ?? 0,
    followedByMe: a.followed_by_me ?? false,
    followedByYou: a.followed_by_you ?? [],
    followedByYouCount: a.followed_by_you_count ?? 0,
    detectedRuntimes: a.detected_runtimes ?? [],
    runtimes: a.runtimes ?? undefined,
    detectedAgentsAll: a.detected_agents_all ?? [],
    shownAgents: a.shown_agents ?? null,
    agentsPublic: a.agents_public ?? true,
    socials: {
      github: a.socials?.github ?? undefined,
      twitter: a.socials?.twitter ?? undefined,
    },
    isMirror: a.is_mirror ?? false,
    mirrorSourceUrl: a.mirror_source_url ?? null,
    mirrorLicense: a.mirror_license ?? null,
    sourceOwnerType: a.source_owner_type ?? null,
  }
}

/** Read the viewer's session token from cookies, or `undefined` when absent. */
async function registrySessionToken(): Promise<string | undefined> {
  try {
    const { cookies } = await import('next/headers')
    const { readSessionCookie } = await import('./session-cookie')
    const jar = await cookies()
    return readSessionCookie(jar)
  } catch (cause) {
    logRegistryDegrade('failed to read session cookie', cause)
    return undefined
  }
}

export interface RegistryFetchOptions {
  /** Attach the viewer session from cookies. Only safe on force-dynamic routes. */
  withSession?: boolean
  /**
   * Skip the `/scan` hydration in {@link getSkill}. Capability-agnostic callers
   * (e.g. the OG image route, which reads only description/installs/category/faces)
   * pass this to avoid a `/scan` roundtrip they never consume. Default off →
   * page-body callers are unchanged.
   */
  skipScan?: boolean
}

/**
 * Fetch + parse a live registry endpoint under the U8 failure contract:
 *   • no registry configured / genuine 404 → `undefined` (resource ABSENT)
 *   • network error or non-OK, non-404 (5xx / timeout) → THROW
 *     {@link RegistryUnavailableError} (registry DOWN), logged first.
 * A primary resource (skill, author) propagates the throw so its page renders a
 * "temporarily unavailable" state instead of a misleading 404. Secondary
 * sections that must never take the whole page down call {@link fetchLiveSoft}.
 */
/** Anonymous skill detail includes visibility — do not cache across yank/privatize. */
function isSkillDetailPath(path: string): boolean {
  return /^\/skills\/[^/]+\/[^/]+$/.test(path)
}

async function fetchLive<T>(
  path: string,
  options: RegistryFetchOptions = {},
): Promise<T | undefined> {
  if (!REGISTRY_BASE_URL) return undefined
  const token = options.withSession ? await registrySessionToken() : undefined
  let res: Response
  try {
    // Callers pass version-less paths (`/skills/…`); the canonical API prefix is
    // applied here so it lives in exactly one place.
    const cacheInit = token
      ? ({ cache: 'no-store' as const })
      : isSkillDetailPath(path)
        ? ({ cache: 'no-store' as const })
        : ({ next: { revalidate: 60 } })
    res = await fetch(`${REGISTRY_BASE_URL}${REGISTRY_API}${path}`, {
      ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
      ...cacheInit,
    })
  } catch (cause) {
    logRegistryDegrade(`fetch failed: ${path}`, cause)
    throw new RegistryUnavailableError('Could not reach the skill registry.', { cause })
  }
  // 404 = genuine absence; 410 = deprecated (author sunset it). Both map to
  // "not here" for the generic fetch so callers fall through to their not-found
  // path — getSkillTombstone re-reads the 410 body to render the tombstone.
  if (res.status === 404 || res.status === 410) return undefined
  if (!res.ok) {
    logRegistryDegrade(`registry responded ${res.status}: ${path}`)
    throw new RegistryUnavailableError(`The skill registry responded ${res.status}.`)
  }
  return (await res.json()) as T
}

/**
 * {@link fetchLive} for secondary sections (feeds, suggestions, scan findings):
 * a registry outage degrades to `undefined` — already logged inside fetchLive —
 * rather than throwing, so one failing rail never blanks the page. The
 * down/absent distinction still holds upstream; this is a deliberate, logged
 * soft-fail, not a silent swallow.
 */
async function fetchLiveSoft<T>(
  path: string,
  options: RegistryFetchOptions = {},
): Promise<T | undefined> {
  try {
    return await fetchLive<T>(path, options)
  } catch (err) {
    if (err instanceof RegistryUnavailableError) return undefined
    throw err
  }
}

// Catalog cap for the static-params / author-enumeration helpers. The catalog
// endpoint paginates (default 24); v1 fits comfortably under this ceiling.
const CATALOG_LIMIT = 100

export async function getSkill(
  author: string,
  slug: string,
  options: RegistryFetchOptions = {},
): Promise<Skill | null> {
  const live = await fetchLive<SkillDetailResponse>(
    registrySkillSubPath(author, slug),
    options,
  )
  if (live) {
    const skill = mapDetail(live)
    if (!options.skipScan) {
      await hydrateScanReport(skill, live, author, slug, options)
    }
    return skill
  }
  if (REGISTRY_BASE_URL) return null
  return MOCK_SKILLS.find((s) => s.author === author && s.slug === slug) ?? null
}

/** Public deprecation tombstone: the sunset message + timestamp a non-manager
 *  sees in place of a 404. */
export interface SkillTombstone {
  message: string | null
  deprecatedAt: string | null
}

/**
 * Read the deprecation tombstone for a skill that {@link getSkill} could not
 * return. A deprecated skill's detail endpoint answers 410 (not 404) to
 * non-managers with a minimal `{ deprecation_message, deprecated_at }` body;
 * this does a direct public (no-session) fetch to read it. Returns null for any
 * other status — a genuine 404, a live 200, or an outage — so the caller falls
 * back to its normal not-found path. Deliberately bypasses {@link fetchLive},
 * which swallows the 410 to `undefined` and would lose the body.
 */
export async function getSkillTombstone(
  author: string,
  slug: string,
): Promise<SkillTombstone | null> {
  if (!REGISTRY_BASE_URL) return null
  const path = registrySkillSubPath(author, slug)
  let res: Response
  try {
    res = await fetch(`${REGISTRY_BASE_URL}${REGISTRY_API}${path}`, { cache: 'no-store' })
  } catch {
    return null // outage — the caller's not-found path already covers this
  }
  if (res.status !== 410) return null
  try {
    const body = (await res.json()) as {
      deprecation_message?: string | null
      deprecated_at?: number | null
    }
    return {
      message: body.deprecation_message ?? null,
      deprecatedAt:
        typeof body.deprecated_at === 'number' ? unixToIso(body.deprecated_at) : null,
    }
  } catch {
    // 410 with a non-JSON / empty body — still a tombstone, just no detail.
    return { message: null, deprecatedAt: null }
  }
}

/** `GET /v1/skills/:author/:slug/versions/:hash/scan` — public scan report (registry PR #214). */
interface ScanReportResponse {
  status: ScanStatus
  findings_summary?: { total?: number }
  findings?: Array<{
    category: string
    confidence: FindingConfidence
    file: string
    // The scanner reports a line range; the detail tab collapses to the start.
    lineStart?: number
    lineEnd?: number
    line?: number
    why: string
    // Short flagged excerpt. Served by the registry for non-`secret` findings
    // (withheld for quarantined); lets the kit panel show the actual flagged line.
    snippet?: string
  }>
  // Installer-facing capability inventory (registry U6), served for every
  // status. Flat null-vs-empty contract on the wire: `null`/absent = never
  // computed (older version); `[]` = computed-and-none; non-empty = detected.
  capabilities?: Array<{
    capability: CapabilityKey
    risky: boolean
    evidence: Array<{
      file: string
      lineStart: number
      lineEnd: number
      source: 'code' | 'instructions'
    }>
  }> | null
  // Analysis qualifier on the inventory (registry Batch 1). `null`/absent mirrors
  // `capabilities: null` (never computed); `'partial'` = some executable-shaped
  // content was NOT inspected, so an empty manifest is NOT a proof of inertness.
  capabilities_analysis?: CapabilityAnalysis | null
  // The un-inspected file paths behind a `partial` analysis (registry ships these
  // so the UI can name them). Optional/absent on a registry that predates the
  // field → treated as [] (no "Unscanned files" chip), so the web degrades safely.
  capabilities_blind_spots?: string[]
}

/**
 * Project the scan-report `capabilities` + `capabilities_analysis` fields onto a
 * web {@link SkillCapabilityReport}, preserving the wire null-vs-empty contract:
 * `null`/absent capabilities (never computed) maps to `null`; `[]`
 * (computed-and-none) becomes `{ capabilities: [], analysis }` and drives the
 * honest empty copy. The analysis qualifier rides alongside so an empty manifest
 * from a `partial` scan is never presented as inert. Evidence is rebuilt
 * field-by-field — locations only (no snippet), for the file-viewer drill-down.
 */
function mapCapabilities(report: ScanReportResponse): SkillCapabilityReport | null {
  if (!Array.isArray(report.capabilities)) return null
  const capabilities = report.capabilities.map((c) => ({
    capability: c.capability,
    risky: Boolean(c.risky),
    evidence: (c.evidence ?? []).map((e) => ({
      file: e.file,
      lineStart: e.lineStart,
      lineEnd: e.lineEnd,
      source: e.source,
    })),
  }))
  // analysis null mirrors capabilities:null (handled above); once capabilities is
  // a computed array, only an explicit 'partial' downgrades it — anything else
  // (incl. an older registry that omits the field) reads as 'full'.
  const analysis: CapabilityAnalysis =
    report.capabilities_analysis === 'partial' ? 'partial' : 'full'
  return { capabilities, analysis }
}

/** Project the scan-report `findings` onto web {@link SecurityFinding}s, carrying
 *  the flagged `snippet` when the registry served it so the kit panel can render
 *  the actual flagged line(s) inline (the snippet rides along with the scan we
 *  already fetch — no extra request). Absent for `secret`/quarantined findings. */
function mapFindings(report: ScanReportResponse): SecurityFinding[] {
  if (!Array.isArray(report.findings)) return []
  return report.findings.map((f) => ({
    category: f.category,
    confidence: f.confidence,
    file: f.file,
    line: f.line ?? f.lineStart,
    why: f.why,
    ...(f.snippet ? { snippet: f.snippet } : {}),
  }))
}

/**
 * Both the threat findings AND the capability inventory live on the same
 * per-version scan endpoint (registry PR #214 + U6), not on the detail response
 * — so fetch the latest version's scan report once and merge both.
 *
 * Capabilities are mapped for EVERY skill, clean ones included, so the
 * install surface can answer "what can this do?" regardless of verdict. This
 * relaxes the old flagged/quarantined-only gate, which is why the fetch now runs
 * for clean skills too.
 *
 * Threat findings hydration is UNCHANGED: findings are merged only for
 * `flagged`/`quarantined` skills and only when the detail did not already embed
 * them — a clean skill never grows a findings list here. No-op when there is no
 * version hash or the registry is offline / the report is unreadable (graceful
 * degrade to the badge + summary line; capabilities stay `undefined`).
 */
async function hydrateScanReport(
  skill: Skill,
  detail: SkillDetailResponse,
  author: string,
  slug: string,
  options: RegistryFetchOptions,
): Promise<void> {
  const hash = detail.latest_hash
  if (!hash) return

  const sec = skill.security
  const findingsAlreadyEmbedded = (sec?.findings.length ?? 0) > 0
  const wantsFindings =
    !!sec &&
    (sec.status === 'flagged' || sec.status === 'quarantined') &&
    !findingsAlreadyEmbedded

  const report = await fetchLiveSoft<ScanReportResponse>(
    registrySkillSubPath(author, slug, `versions/${encodeRegistrySegment(hash)}/scan`),
    options,
  )
  if (!report) return

  // Capabilities load for all statuses; null-vs-empty preserved end-to-end, with
  // the analysis qualifier carried alongside so the panel can be honest about a
  // `partial` scan (an empty manifest then is "couldn't fully analyze", not "inert").
  const capReport = mapCapabilities(report)
  skill.capabilities = capReport ? capReport.capabilities : null
  skill.capabilitiesAnalysis = capReport ? capReport.analysis : null
  // Single-skill: the unscanned files carry no per-skill attribution (it's this
  // skill). Absent wire field → [] → no "Unscanned files" chip (degrades safely).
  skill.capabilitiesBlindSpots = (report.capabilities_blind_spots ?? []).map((file) => ({ file }))

  // Threat findings: unchanged gating — only flagged/quarantined, only when the
  // detail did not already embed them.
  if (wantsFindings && Array.isArray(report.findings)) {
    const findings: SecurityFinding[] = report.findings.map((f) => ({
      category: f.category,
      confidence: f.confidence,
      file: f.file,
      line: f.line ?? f.lineStart,
      why: f.why,
    }))
    skill.security = {
      ...sec,
      status: report.status ?? sec.status,
      findingCount: report.findings_summary?.total ?? findings.length,
      findings,
    }
  }
}

/**
 * Focused capability read for a single skill version — the same public
 * `/scan` endpoint and `mapCapabilities` projection {@link hydrateScanReport}
 * uses, without the surrounding detail fetch. Used by the kit page to bubble up
 * the union of its members' capabilities. Preserves the wire null-vs-empty
 * contract: `null` = never computed (older version) or report unreadable/offline;
 * `{ capabilities: [], analysis }` = computed-and-none; non-empty = detected. The
 * analysis qualifier rides along so the kit roll-up can stay honest about a
 * `partial` member.
 */
/** The full scan of one skill version: capabilities AND threat findings, from a
 *  single fetch. Kit roll-ups need both; the single-skill page uses the slices. */
export async function getSkillScan(
  author: string,
  slug: string,
  hash: string,
  options: RegistryFetchOptions = {},
): Promise<{
  capabilities: SkillCapabilityReport | null
  findings: SecurityFinding[]
  blindSpots: string[]
}> {
  const report = await fetchLiveSoft<ScanReportResponse>(
    registrySkillSubPath(author, slug, `versions/${encodeRegistrySegment(hash)}/scan`),
    options,
  )
  if (!report) return { capabilities: null, findings: [], blindSpots: [] }
  return {
    capabilities: mapCapabilities(report),
    findings: mapFindings(report),
    blindSpots: report.capabilities_blind_spots ?? [],
  }
}

export async function getSkillCapabilities(
  author: string,
  slug: string,
  hash: string,
  options: RegistryFetchOptions = {},
): Promise<SkillCapabilityReport | null> {
  return (await getSkillScan(author, slug, hash, options)).capabilities
}

/** One scan entry as projected for a batch caller (kit roll-up). */
export interface BatchScanEntry {
  capabilities: SkillCapabilityReport | null
  findings: SecurityFinding[]
  blindSpots: string[]
}

/** `GET /v1/skills/scan/batch` — the batch shape (registry U5). */
interface BatchScanResponse {
  reports: Array<{ author: string; slug: string; hash: string; report: ScanReportResponse }>
}

/**
 * Fetch per-member scan reports for a member set in ONE cacheable GET (registry
 * U5 / KTD4), replacing the kit roll-up's N per-member `/scan` reads while
 * keeping the same shared/CDN caching (this is a tokenless GET, so it rides
 * `revalidate` exactly like the per-member reads did).
 *
 * Returns a Map keyed by `${author}/${slug}/${hash}` → the same
 * capabilities/findings/blindSpots projection {@link getSkillScan} yields per
 * member. A member the registry OMITS (unreadable/existence-hidden) is simply
 * absent from the Map; the caller treats a miss as the identity-only "no scan"
 * case (counts toward `partial`), exactly as an unfetchable member did before.
 */
export async function getScanReportsBatch(
  members: Array<{ author: string; slug: string; hash: string }>,
  options: RegistryFetchOptions = {},
): Promise<Map<string, BatchScanEntry>> {
  const out = new Map<string, BatchScanEntry>()
  if (members.length === 0) return out
  await Promise.all(
    scanBatchChunks(members).map(async (chunk) => {
      const raw = chunk.map((m) => `${m.author}/${m.slug}/${m.hash}`).join(',')
      const path = `/skills/scan/batch?members=${encodeURIComponent(raw)}`
      const body = await fetchLiveSoft<BatchScanResponse>(path, options)
      if (!body || !Array.isArray(body.reports)) return
      for (const entry of body.reports) {
        out.set(`${entry.author}/${entry.slug}/${entry.hash}`, {
          capabilities: mapCapabilities(entry.report),
          findings: mapFindings(entry.report),
          blindSpots: entry.report.capabilities_blind_spots ?? [],
        })
      }
    }),
  )
  return out
}

/** Encoded characters of `members` one request may carry. A member ref is
 *  `handle/slug/sha256:<64 hex>` — ~115 chars once encoded — so a 168-skill kit
 *  built a ~19KB query string and the registry answered **431**: Node caps the
 *  request line + headers at 16KB, so that request could never succeed, at any
 *  member count. 1800 keeps a chunk's whole URL inside every proxy's line limit
 *  with room for the origin prefix. */
const SCAN_BATCH_QUERY_BUDGET = 1800
/** The registry's own per-request cap (`MAX_SCAN_BATCH_MEMBERS`, a 422). The
 *  length budget binds long before this — it's here so a shorter ref shape can
 *  never quietly walk a chunk past the server's limit. */
const SCAN_BATCH_MAX_MEMBERS = 100

/**
 * Split a member set into request-sized chunks. Each chunk is its own tokenless,
 * individually CDN-cacheable GET, so a big kit costs a handful of parallel reads
 * that all succeed rather than one oversized read that always 431s. Chunking is
 * order-preserving and deterministic, which keeps the chunk URLs — and their
 * cache entries — stable across requests for the same kit.
 */
function scanBatchChunks<T extends { author: string; slug: string; hash: string }>(
  members: T[],
): T[][] {
  const chunks: T[][] = []
  let current: T[] = []
  let encodedLen = 0
  for (const m of members) {
    const refLen = encodeURIComponent(`${m.author}/${m.slug}/${m.hash}`).length
    // Every ref after the first also carries the encoded comma joiner (`%2C`).
    const cost = current.length === 0 ? refLen : refLen + 3
    const full =
      current.length > 0 &&
      (encodedLen + cost > SCAN_BATCH_QUERY_BUDGET || current.length >= SCAN_BATCH_MAX_MEMBERS)
    if (full) {
      chunks.push(current)
      current = []
      encodedLen = 0
    }
    encodedLen += current.length === 0 ? refLen : refLen + 3
    current.push(m)
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

export async function getAuthorProfile(
  username: string,
  options: RegistryFetchOptions = {},
): Promise<AuthorProfile | null> {
  const live = await fetchLive<AuthorPageResponse>(`/authors/${username}`, options)
  if (live) return mapAuthor(live)
  if (REGISTRY_BASE_URL) return null
  return MOCK_AUTHORS.find((a) => a.username === username) ?? null
}

/**
 * Request-deduped ANONYMOUS author read (R4/KTD7). The author page fetches
 * `/authors/:author` twice per request — anonymous in `generateMetadata`,
 * session-scoped in the body — and the differing options defeat Next's fetch
 * memoization. Wrapping the anonymous read in React `cache()` (mirrors
 * `getSession` in `get-session.ts`) collapses every anonymous consumer in one
 * render to a single fetch. The session-scoped body read stays a separate call
 * (it carries the viewer's bearer token), by design.
 */
export const getAuthorProfileCached = cache(
  (username: string): Promise<AuthorProfile | null> => getAuthorProfile(username),
)









/** People with public skills the viewer does not follow yet (who-to-follow rail). */
export async function getFollowSuggestions(
  options: RegistryFetchOptions = {},
): Promise<FollowSuggestion[]> {
  const live = await fetchLiveSoft<{
    suggestions: Array<{
      handle: string
      name: string
      avatar_url?: string | null
      skills: number
      followers: number
    }>
  }>(`/me/suggestions`, options)
  return (live?.suggestions ?? []).map((s) => ({
    handle: s.handle,
    name: s.name,
    avatarUrl: s.avatar_url ?? null,
    skills: s.skills,
    followers: s.followers,
  }))
}


/**
 * Trust-graph activity feed: skill publishes/updates plus follow actions from
 * the people you follow (`view: 'following'`) or globally (`view: 'discover'`).
 * Requires a session (pass `{ withSession: true }`); returns null when offline,
 * unauthenticated, or on error so the page can render a logged-out / empty state.
 */
export async function getFeed(
  view: FeedView = 'following',
  options: RegistryFetchOptions = {},
  team?: string,
  offset?: number | null,
  limit?: number,
): Promise<FeedResult | null> {
  const params = new URLSearchParams({ view })
  if (view === 'team' && team) params.set('team', team)
  if (offset != null) params.set('offset', String(offset))
  if (limit != null) params.set('limit', String(limit))
  const live = await fetchLiveSoft<{
    events: FeedEventResponse[]
    following_count?: number
    view?: string
    next_offset?: number | null
  }>(`/me/feed?${params.toString()}`, options)
  if (!live) return null
  return {
    events: mapDiscoverFeedEvents(live.events),
    followingCount: live.following_count ?? 0,
    view: live.view === 'discover' ? 'discover' : live.view === 'team' ? 'team' : 'following',
    nextCursor: live.next_offset ?? null,
  }
}

/** Inbound notifications (events about you) + the current unread count. The
 *  inverse of {@link getFeed}; needs a session. Empty on error/offline. */
export async function getNotifications(
  options: RegistryFetchOptions = {},
): Promise<NotificationsResult> {
  const live = await fetchLiveSoft<{ events: NotificationEventResponse[]; unread_count?: number }>(
    '/me/notifications',
    options,
  )
  if (!live) return { events: [], unreadCount: 0 }
  return { events: mapNotificationEvents(live.events), unreadCount: live.unread_count ?? 0 }
}

/**
 * The global Discover activity stream, served anonymously from
 * `GET /v1/discover/feed`. Unlike {@link getFeed}, this needs no session, so
 * logged-out visitors can see Discover. Returns null on error / offline.
 */
export async function getDiscoverFeed(
  options: RegistryFetchOptions = {},
  offset?: number | null,
  limit?: number,
): Promise<FeedResult | null> {
  // The cached, anonymous path only serves page one; any offset (a load-more
  // request) or explicit limit goes through a live fetch so it can page.
  if (options.withSession || offset != null || limit != null) {
    const p = new URLSearchParams()
    if (offset != null) p.set('offset', String(offset))
    if (limit != null) p.set('limit', String(limit))
    const qs = p.toString() ? `?${p.toString()}` : ''
    const live = await fetchLiveSoft<{
      events: FeedEventResponse[]
      following_count?: number
      next_offset?: number | null
    }>(`/discover/feed${qs}`, options)
    if (!live) return null
    return {
      events: mapDiscoverFeedEvents(live.events),
      followingCount: live.following_count ?? 0,
      view: 'discover',
      nextCursor: live.next_offset ?? null,
    }
  }
  return getDiscoverFeedCached()
}

async function getDiscoverFeedCached(): Promise<FeedResult | null> {
  const { getDiscoverFeedCached: load } = await import('./registry-catalog')
  return load()
}

/** Shared mapper from the registry event envelope to the web FeedEvent union. */

/** Public activity timeline for a single author (skill publishes/updates + follows). */
export async function getProfileActivity(
  author: string,
  options: RegistryFetchOptions = {},
): Promise<FeedEvent[]> {
  const live = await fetchLiveSoft<{ events: FeedEventResponse[] }>(
    `/profiles/${encodeURIComponent(author)}/activity`,
    options,
  )
  return live ? mapDiscoverFeedEvents(live.events) : []
}

export async function getAllSkillSlugs(): Promise<{ author: string; slug: string }[]> {
  // Enumerate from the catalog so every published skill gets a static page.
  // A registry outage at build time yields no pages rather than crashing the
  // build (or, worse, prerendering fabricated seed skills).
  try {
    const { skills } = await getSkillCatalog({ limit: CATALOG_LIMIT })
    return skills.map(({ author, slug }) => ({ author, slug }))
  } catch (cause) {
    logRegistryDegrade('getAllSkillSlugs: catalog unavailable, emitting no static pages', cause)
    return []
  }
}

export async function getAllAuthorUsernames(): Promise<string[]> {
  // No list-authors endpoint exists; derive the unique author set from the
  // catalog so every author with a published skill gets a static profile page.
  try {
    const { skills } = await getSkillCatalog({ limit: CATALOG_LIMIT })
    return Array.from(new Set(skills.map((s) => s.author)))
  } catch (cause) {
    logRegistryDegrade('getAllAuthorUsernames: catalog unavailable, emitting no static pages', cause)
    return []
  }
}

// ---------------------------------------------------------------------------
// Universal search — client-only; implementation lives in search-client.ts
// so registry.ts is not pulled into browser bundles that only need catalog reads.
// ---------------------------------------------------------------------------

export type {
  SearchAuthorResult,
  SearchDocResult,
  SearchGroupKey,
  SearchGroups,
  SearchKitResult,
  SearchOptions,
  SearchResponse,
  SearchResultItem,
  SearchSkillResult,
  SearchTeamResult,
} from '@/lib/search-client'

export { searchUniversal } from '@/lib/search-client'
