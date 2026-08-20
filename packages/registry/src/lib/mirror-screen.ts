// Auto-screen for mirror review-queue candidates.
//
// `screenCandidate` runs the gate every candidate must pass before a human admin
// sees it (at submit time) AND again at approval time (a repo may have gone
// private / lost its license / lost SKILL.md / been transferred since). It does
// NOT decide queue policy or write rows — it only fetches the live GitHub source
// and returns a pass/fail verdict plus the derived identity fields the route
// records.
//
// Checks (any failure → pass:false with a human note):
//   1. the source repo is fetchable (public, exists)
//   2. it is the owner's OWN repo, not a fork
//   3. a permissive license is present
//   4. the owner login derives to a valid, INJECTIVE Skillet handle
//   5. that handle is not already taken (handleOrSlugTaken)
//   6. a valid SKILL.md exists somewhere in the repo
//
// GitHub access is via an injectable `fetchImpl` (mirrors sync-repo.ts) so the
// checks are unit-testable without the network.
import type { DatabaseSync } from '../db/sqlite-handle.js'
import { slugify } from '@skillet/protocol'
import type { PrismaDb } from '../db/prisma-client.js'
import { handleOrSlugTaken, handleOrSlugTakenPrisma } from './org-access.js'
import { effectiveLicensePath, resolveSpdx, isPermissiveSpdx } from './license-detect.js'

const GH_API = 'https://api.github.com'

/** Upper bound on per-skill license-content fetches during screening — a repo with
 *  more distinctly-licensed skill folders than this is pathological; we admit on the
 *  first permissive one found, so this only bounds the all-non-permissive worst case. */
const MAX_LICENSE_PROBES = 40

export interface ScreenOwnerType {
  ownerType: 'User' | 'Organization' | null
}

export interface ScreenResult {
  pass: boolean
  /** Human-readable rejection reason when `pass` is false; null when it passes. */
  notes: string | null
  /** GitHub owner login as returned live (canonical case). */
  ownerLogin: string | null
  /** GitHub numeric owner id, captured for the KTD9 re-bind guard. */
  ownerId: number | null
  ownerType: 'User' | 'Organization' | null
  /** SPDX license id observed at the source (null when none). */
  license: string | null
  /** Sanitized owner-login handle, null when the login can't be a handle. */
  derivedHandle: string | null
}

export interface RepoMeta {
  fork?: boolean
  default_branch?: string
  owner?: { login?: string; id?: number; type?: string }
  license?: { spdx_id?: string | null; key?: string | null } | null
}

/**
 * Derive a Skillet handle from a GitHub owner login.
 *
 * R16 rests on this being injective over the GitHub login charset
 * (`[a-zA-Z0-9-]`, no leading/trailing/consecutive hyphens). `slugify`
 * lowercases and collapses non-alphanumeric runs to single hyphens, so for any
 * VALID GitHub login the only change is case — `login.toLowerCase()` must equal
 * the slug. If it does not (an unexpected/illegal login shape), or the handle is
 * empty or longer than the 40-char handle cap, we REJECT rather than coerce, so
 * two distinct logins can never collapse onto the same handle.
 */
export function deriveHandleFromLogin(login: string): { handle: string | null; reason?: string } {
  const trimmed = login.trim()
  if (!trimmed) return { handle: null, reason: 'empty owner login' }
  const handle = slugify(trimmed, { maxLength: 64 })
  if (!handle) return { handle: null, reason: `owner login "${login}" is not a valid handle` }
  if (handle.length > 40) {
    return { handle: null, reason: `owner login "${login}" is longer than the 40-char handle cap` }
  }
  // Injectivity guard: only a case change is allowed. Anything else means the
  // login carried characters that slugify rewrote — reject instead of coerce.
  if (trimmed.toLowerCase() !== handle) {
    return { handle: null, reason: `owner login "${login}" can't be a handle without coercion` }
  }
  return { handle }
}

/** The charset GitHub allows in an owner login or repo name, matching the
 *  connected-repos route's REPO_PART. Anything else means the source carried
 *  characters that would land in the fetch URL path (`@`, `/`, `..`), so we
 *  reject rather than interpolate them. */
const OWNER_REPO_PART = /^[A-Za-z0-9._-]+$/

/** Parse "owner/repo" out of a bare slug or a github URL (host + .git stripped). */
export function parseOwnerRepo(source: string): { owner: string; repo: string } | null {
  let s = source.trim()
  s = s.replace(/^https?:\/\/(www\.)?github\.com\//i, '')
  s = s.replace(/^git@github\.com:/i, '')
  s = s.replace(/\.git$/i, '')
  s = s.replace(/\/+$/, '')
  const parts = s.split('/').filter(Boolean)
  if (parts.length < 2) return null
  const owner = parts[0]!
  const repo = parts[1]!
  if (!OWNER_REPO_PART.test(owner) || !OWNER_REPO_PART.test(repo)) return null
  return { owner, repo }
}

/**
 * Canonical dedupe key for a source repo: lowercased `owner/repo`, host and
 * `.git` stripped, so `Vercel-Labs/Skills`, `vercel-labs/skills.git`, and the
 * full github URL all collapse to one key (R15).
 */
export function normalizeRepoKey(source: string): string | null {
  const parsed = parseOwnerRepo(source)
  if (!parsed) return null
  return `${parsed.owner.toLowerCase()}/${parsed.repo.toLowerCase()}`
}

async function ghGet(
  url: string,
  fetchImpl: typeof fetch | undefined,
): Promise<Response | null> {
  const f = fetchImpl ?? globalThis.fetch
  try {
    return await f(url, {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'skillet-mirror-screen',
        'x-github-api-version': '2022-11-28',
      },
      // A slow GitHub response must not hang a Fastify worker (submit + approve
      // call this synchronously). A timeout throws, caught below as a null
      // Response → the same screen-fail/INDETERMINATE verdict a fetch error gives.
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    return null
  }
}

/** Blob paths in the repo tree on `ref` (+ GitHub's truncation flag), or null on
 *  fetch failure. */
async function fetchRepoTreePaths(
  owner: string,
  repo: string,
  ref: string,
  fetchImpl: typeof fetch | undefined,
): Promise<{ paths: string[]; truncated: boolean } | null> {
  const res = await ghGet(
    `${GH_API}/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    fetchImpl,
  )
  if (!res || !res.ok) return null
  const body = (await res.json().catch(() => null)) as {
    tree?: Array<{ path?: string; type?: string }>
    truncated?: boolean
  } | null
  if (!body?.tree) return null
  return {
    paths: body.tree
      .filter((t) => t.type === 'blob' && typeof t.path === 'string')
      .map((t) => t.path as string),
    // GitHub caps the recursive tree (~100k entries); a truncated list can miss a
    // SKILL.md or LICENSE, so callers must not treat "not found" as definitive.
    truncated: body.truncated === true,
  }
}

/** Skill directories in a repo (dir of each SKILL.md; '' for a root skill). */
function skillDirsFromPaths(paths: string[]): string[] {
  const dirs = paths
    .filter((p) => p === 'SKILL.md' || p.endsWith('/SKILL.md'))
    .map((p) => (p === 'SKILL.md' ? '' : p.slice(0, -'/SKILL.md'.length)))
  return [...new Set(dirs)]
}

/** Fetch a license file's UTF-8 text via the contents API (base64), or null. */
async function fetchLicenseText(
  owner: string,
  repo: string,
  ref: string,
  path: string,
  fetchImpl: typeof fetch | undefined,
): Promise<string | null> {
  const res = await ghGet(
    `${GH_API}/repos/${owner}/${repo}/contents/${path
      .split('/')
      .map(encodeURIComponent)
      .join('/')}?ref=${encodeURIComponent(ref)}`,
    fetchImpl,
  )
  if (!res || !res.ok) return null
  const body = (await res.json().catch(() => null)) as { content?: string } | null
  if (!body?.content) return null
  try {
    return Buffer.from(body.content, 'base64').toString('utf8')
  } catch {
    return null
  }
}

/**
 * Repo-admission license check. Admits the repo only when EVERY skill has a
 * permissive EFFECTIVE license (own folder → ancestor → root; never a sibling), so
 * a subfolder-licensed repo like anthropics/skills passes while a repo with any
 * unlicensed/copyleft skill is rejected whole. This is the deliberate simple policy
 * — no per-skill gating downstream, so the whole sync path stays untouched. Returns
 * a representative permissive SPDX (for display), or null when the repo is rejected.
 */
async function allSkillsPermissiveLicense(
  owner: string,
  repo: string,
  ref: string,
  paths: string[],
  repoRootSpdx: string | null,
  fetchImpl: typeof fetch | undefined,
): Promise<string | null> {
  // Fast path: a permissive repo-root license (GitHub-detected) governs every
  // skill — no per-file lookup or fetch needed, and robust to a truncated tree or
  // an oddly-named root license file.
  if (isPermissiveSpdx(repoRootSpdx)) return repoRootSpdx
  const skillDirs = skillDirsFromPaths(paths)
  let representative: string | null = null
  const spdxByPath = new Map<string, string | null>() // dedupe shared license files
  for (const dir of skillDirs) {
    const licensePath = effectiveLicensePath(dir, paths)
    if (!licensePath) return null // a skill with no license → reject the whole repo
    let spdx: string | null
    if (spdxByPath.has(licensePath)) {
      spdx = spdxByPath.get(licensePath)!
    } else {
      // Too many DISTINCT license files to verify → reject conservatively (rare).
      if (spdxByPath.size >= MAX_LICENSE_PROBES) return null
      // repoRootSpdx is non-permissive here (fast path returned otherwise), so read
      // the TEXT — this also rescues a permissive root license GitHub called NOASSERTION.
      const content = await fetchLicenseText(owner, repo, ref, licensePath, fetchImpl)
      spdx = resolveSpdx({ licensePath, content, repoRootSpdx })
      spdxByPath.set(licensePath, spdx)
    }
    if (!isPermissiveSpdx(spdx)) return null // any non-permissive skill → reject
    if (!representative) representative = spdx
  }
  return representative
}

export interface ScreenInput {
  /** Sqlite store used when `prisma` is unset (discovery job + sqlite route path). */
  db?: DatabaseSync
  /** When set, handle/slug collision checks go through Prisma (MySQL cutover path). */
  prisma?: PrismaDb
  owner: string
  repo: string
  fetchImpl?: typeof fetch
}

/** Run the auto-screen gate against the LIVE GitHub source. */
export async function screenCandidate(input: ScreenInput): Promise<ScreenResult> {
  const { db, prisma, owner, repo, fetchImpl } = input
  const empty: ScreenResult = {
    pass: false,
    notes: null,
    ownerLogin: null,
    ownerId: null,
    ownerType: null,
    license: null,
    derivedHandle: null,
  }

  const repoRes = await ghGet(`${GH_API}/repos/${owner}/${repo}`, fetchImpl)
  if (!repoRes || !repoRes.ok) {
    return {
      ...empty,
      notes: `could not fetch ${owner}/${repo} from GitHub (HTTP ${repoRes?.status ?? 'error'}) — repo may be private, deleted, or rate-limited`,
    }
  }
  const meta = (await repoRes.json().catch(() => null)) as RepoMeta | null
  if (!meta || !meta.owner?.login || typeof meta.owner.id !== 'number') {
    return { ...empty, notes: `GitHub returned no usable owner for ${owner}/${repo}` }
  }

  const ownerLogin = meta.owner.login
  const ownerId = meta.owner.id
  const ownerType: 'User' | 'Organization' | null =
    meta.owner.type === 'Organization' ? 'Organization' : meta.owner.type === 'User' ? 'User' : null
  const license = meta.license?.spdx_id ?? null

  const base = { ownerLogin, ownerId, ownerType, license }

  // 2. Owner's own repo, not a fork.
  if (meta.fork === true) {
    return { ...empty, ...base, derivedHandle: null, notes: `${owner}/${repo} is a fork, not the owner's own repo` }
  }

  // 3. Owner login derives to a valid, injective handle.
  const derived = deriveHandleFromLogin(ownerLogin)
  if (!derived.handle) {
    return { ...empty, ...base, notes: derived.reason ?? 'owner login is not a valid handle' }
  }
  const derivedHandle = derived.handle

  // 4. Handle not already taken. Fail closed when neither store is provided.
  const taken = prisma
    ? await handleOrSlugTakenPrisma(prisma, derivedHandle)
    : db
      ? handleOrSlugTaken(db, derivedHandle)
      : true
  if (taken) {
    return {
      ...empty,
      ...base,
      derivedHandle,
      notes: `handle @${derivedHandle} is already taken on Skillet`,
    }
  }

  // 5. Fetch the tree once — needed for both the SKILL.md check and per-skill
  //    license detection.
  const ref = meta.default_branch ?? 'main'
  const tree = await fetchRepoTreePaths(owner, repo, ref, fetchImpl)
  if (!tree) {
    return { ...empty, ...base, derivedHandle, notes: `could not read the tree for ${owner}/${repo}` }
  }
  const { paths, truncated } = tree
  // A truncated tree can omit a SKILL.md/LICENSE, so "not found" is inconclusive
  // (re-screened at approval, and a later full sync may differ) — say so in the note.
  const truncNote = truncated ? ' (tree was truncated — result may be incomplete)' : ''
  if (skillDirsFromPaths(paths).length === 0) {
    return { ...empty, ...base, derivedHandle, notes: `no SKILL.md found in ${owner}/${repo}${truncNote}` }
  }

  // 6. EVERY skill must have a permissive effective license (own folder → ancestor
  //    → root), so a subfolder-licensed repo like anthropics/skills is admitted while
  //    a repo with any unlicensed/copyleft skill is rejected whole. Simple policy:
  //    no per-skill gating downstream. Returns a representative permissive SPDX.
  const admitSpdx = await allSkillsPermissiveLicense(owner, repo, ref, paths, license, fetchImpl)
  if (!admitSpdx) {
    return {
      ...empty,
      ...base,
      derivedHandle,
      notes: `not every skill in ${owner}/${repo} has a permissive license (repo-root saw ${license ?? 'none'}); redistribution not permitted${truncNote}`,
    }
  }

  // Return the representative permissive SPDX (all skills are permissive) so the
  // review queue and badge show a real license, not the possibly-null repo root.
  return { pass: true, notes: null, ownerLogin, ownerId, ownerType, license: admitSpdx, derivedHandle }
}
