/**
 * GitHub brand-claim eligibility checker.
 *
 * Given a request-scoped `read:org` token and a mirror source `{owner, repo}`,
 * plus the expected stored handle and the seed-captured owner numeric id, this
 * proves — from the claimant's OWN token — whether they are an org owner of, or
 * repo admin on, the mirror's source. The result is three-valued and FAILS
 * CLOSED: only a positive HTTP 200 with the exact role grants ELIGIBLE.
 *
 * Classification:
 *  - ELIGIBLE        — 200 with the exact role: repo `permissions.admin === true`,
 *                      OR org membership `state === 'active' && role === 'admin'`.
 *  - NOT_ELIGIBLE    — a below-floor 200 with a REAL permissions object (clean
 *                      denial): a contributor/maintainer/pending member.
 *  - INDETERMINATE   — any 404/403/5xx/429-with-rate-headers/network throw, OR an
 *                      org-owned repo whose `permissions` object is absent/zeroed
 *                      (the unapproved-OAuth-app shape under a third-party-app
 *                      policy). Deny the claim but show "we couldn't verify
 *                      ownership right now," never "you don't own this."
 *
 * Re-bind guard: `GET /repos/{owner}/{repo}` follows GitHub's permanent
 * transfer/rename redirects, so a stale `mirror_source_url` resolves to whoever
 * owns the repo NOW. If the current `owner.login` no longer equals the stored
 * handle (sanitized compare) OR the current `owner.id` !== the seed-captured
 * `source_owner_id`, the result is INDETERMINATE (flag for re-seed) — NEVER
 * ELIGIBLE — so a transferred source can't let a different owner grab a frozen
 * brand handle (R16).
 *
 * Mirrors the injectable-`fetchImpl` pattern in
 * `packages/registry/src/sync/sync-repo.ts` so tests pass mocked responses.
 */
import { slugify } from './slugify'

const GH_API = 'https://api.github.com'

export type EligibilityClassification = 'ELIGIBLE' | 'NOT_ELIGIBLE' | 'INDETERMINATE'
export type OwnerType = 'Organization' | 'User'
export type EndState = 'org' | 'user'

export interface EligibilityResult {
  classification: EligibilityClassification
  /** Current GitHub owner login (after any transfer redirect), or null on a pre-owner failure. */
  login: string | null
  /** Current GitHub owner numeric id, or null on a pre-owner failure. */
  id: number | null
  ownerType: OwnerType | null
  endState: EndState | null
}

export interface ClaimSource {
  owner: string
  repo: string
}

export interface CheckClaimEligibilityParams {
  /** Request-scoped `read:org` token. Never persisted. */
  token: string
  /** The mirror's stored source `{owner, repo}` (parsed from `mirror_source_url`). */
  source: ClaimSource
  /** The mirror's stored Skillet handle (already sanitized). */
  expectedHandle: string
  /**
   * The seed-captured owner numeric id (`source_owner_id`, KTD9). `null` when the
   * registry has not captured it for this mirror yet — in that case the numeric-id
   * equality is skipped and the login re-bind (here) plus the registry's
   * independent owner re-parse remain the R16 boundary. When a number is
   * supplied it is enforced (the extra defense against freed-login reuse).
   */
  expectedOwnerId: number | null
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch
}

interface GithubOwner {
  login?: string
  id?: number
  type?: string
}
interface GithubRepoPermissions {
  admin?: boolean
  maintain?: boolean
  push?: boolean
  triage?: boolean
  pull?: boolean
}
interface GithubRepoResponse {
  owner?: GithubOwner
  permissions?: GithubRepoPermissions
}
interface GithubMembershipResponse {
  state?: string
  role?: string
}
interface GithubUserResponse {
  id?: number
}

function ghHeaders(token: string): Record<string, string> {
  return {
    accept: 'application/vnd.github+json',
    'user-agent': 'skillet-claim-eligibility',
    'x-github-api-version': '2022-11-28',
    authorization: `Bearer ${token}`,
  }
}

/**
 * A 403/429 carrying rate-limit headers (or an exhausted remaining count) is a
 * throttle, not a denial — treat as INDETERMINATE. We never read a denial out of
 * a throttled response.
 */
function isRateLimited(res: Response): boolean {
  if (res.status === 429) return true
  if (res.status === 403) {
    const remaining = res.headers.get('x-ratelimit-remaining')
    const reset = res.headers.get('x-ratelimit-reset')
    if (remaining != null || reset != null) return true
  }
  return false
}

/**
 * A "real" permissions object carries at least one truthful access signal. An
 * absent or fully-zeroed object is the shape an unapproved OAuth app sees under a
 * third-party-app policy (KTD3 restricted-org refinement) — we must NOT read a
 * non-admin denial out of it.
 */
function hasTruthfulPermissionSignal(perms: GithubRepoPermissions | undefined): boolean {
  if (!perms) return false
  return Boolean(perms.admin || perms.maintain || perms.push || perms.triage || perms.pull)
}

const FAILURE: EligibilityResult = {
  classification: 'INDETERMINATE',
  login: null,
  id: null,
  ownerType: null,
  endState: null,
}

/**
 * Fetch the claimant's OWN GitHub identity id via `GET /user`. Used for User-source
 * claims (R16): repo `permissions.admin` alone is NOT enough — an admin
 * *collaborator* on someone's personal repo would otherwise be able to claim that
 * user's @handle. Returns the numeric id, or `'error'` on any throw / non-200 /
 * malformed body (so the caller fails closed to INDETERMINATE, never a false grant).
 */
async function fetchAuthedUserId(
  f: typeof fetch,
  token: string,
): Promise<number | 'error'> {
  let res: Response
  try {
    res = await f(`${GH_API}/user`, {
      headers: ghHeaders(token),
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    return 'error'
  }
  if (!res.ok) return 'error'
  try {
    const body = (await res.json()) as GithubUserResponse
    return typeof body.id === 'number' ? body.id : 'error'
  } catch {
    return 'error'
  }
}

type OwnerInfo = Pick<EligibilityResult, 'login' | 'id' | 'ownerType' | 'endState'>

/**
 * Org-owned mirror: require membership state=active && role=admin. Shared by the
 * repo-admin path and the non-admin org path below.
 */
async function checkOrgOwnerMembership(
  f: typeof fetch,
  token: string,
  orgLogin: string,
  ownerInfo: OwnerInfo,
): Promise<EligibilityResult> {
  let memRes: Response
  try {
    memRes = await f(`${GH_API}/user/memberships/orgs/${orgLogin}`, {
      headers: ghHeaders(token),
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    return { classification: 'INDETERMINATE', ...ownerInfo }
  }

  if (memRes.ok) {
    let membership: GithubMembershipResponse
    try {
      membership = (await memRes.json()) as GithubMembershipResponse
    } catch {
      return { classification: 'INDETERMINATE', ...ownerInfo }
    }
    if (membership.state === 'active' && membership.role === 'admin') {
      return { classification: 'ELIGIBLE', ...ownerInfo }
    }
    return { classification: 'NOT_ELIGIBLE', ...ownerInfo }
  }

  if (memRes.status === 404) {
    return { classification: 'NOT_ELIGIBLE', ...ownerInfo }
  }
  return { classification: 'INDETERMINATE', ...ownerInfo }
}

export async function checkClaimEligibility(
  params: CheckClaimEligibilityParams,
): Promise<EligibilityResult> {
  const { token, source, expectedHandle, expectedOwnerId } = params
  const f = params.fetchImpl ?? globalThis.fetch

  // 1. GET /repos/{owner}/{repo} — owner.type, owner.login, owner.id, permissions.
  let repoRes: Response
  try {
    repoRes = await f(`${GH_API}/repos/${source.owner}/${source.repo}`, {
      headers: ghHeaders(token),
      redirect: 'follow',
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    return FAILURE // network throw -> INDETERMINATE
  }

  // Any non-200 (404 missing/private, 403/429 throttle, 5xx) -> INDETERMINATE.
  if (!repoRes.ok) {
    // isRateLimited() is read for clarity/intent; every non-200 fails closed here.
    void isRateLimited(repoRes)
    return FAILURE
  }

  let repo: GithubRepoResponse
  try {
    repo = (await repoRes.json()) as GithubRepoResponse
  } catch {
    return FAILURE
  }

  const login = repo.owner?.login
  const id = repo.owner?.id
  const rawType = repo.owner?.type
  if (!login || typeof id !== 'number' || (rawType !== 'Organization' && rawType !== 'User')) {
    return FAILURE // malformed owner -> INDETERMINATE
  }
  const ownerType: OwnerType = rawType
  const endState: EndState = ownerType === 'Organization' ? 'org' : 'user'

  // KTD9 re-bind guard: the repo redirect may have resolved to a DIFFERENT owner
  // (source transferred/renamed). If the current login no longer matches the
  // stored handle, or the numeric id no longer matches the seed-captured id, we
  // never grant — flag for re-seed.
  const ownerInfo = { login, id, ownerType, endState }
  const handleMatches = slugify(login) === slugify(expectedHandle)
  // Login mismatch always blocks (catches transfer/rename to a different owner).
  // The numeric-id check is enforced only when a seed-captured id is known; when
  // it is null the login re-bind here + the registry's independent owner re-parse
  // still hold R16, so an uncaptured id must not fail an otherwise-valid claim.
  const idMismatch = expectedOwnerId != null && id !== expectedOwnerId
  if (!handleMatches || idMismatch) {
    return { classification: 'INDETERMINATE', ...ownerInfo }
  }

  const permissions = repo.permissions

  // 2a. Repo admin is a signal, not an automatic grant. For a USER source we
  // require the claimant's OWN identity (`GET /user`) to be the repo owner
  // before granting (R16). For an ORGANIZATION source we require org owner
  // membership (`role === 'admin'`) — a repo-admin collaborator must not claim
  // the org's @handle.
  if (permissions?.admin === true) {
    if (ownerType === 'User') {
      const authedId = await fetchAuthedUserId(f, token)
      if (authedId === 'error') {
        return { classification: 'INDETERMINATE', ...ownerInfo } // can't verify identity
      }
      if (authedId === id) {
        return { classification: 'ELIGIBLE', ...ownerInfo }
      }
      // Admin collaborator, but NOT the personal-repo owner -> clean denial.
      return { classification: 'NOT_ELIGIBLE', ...ownerInfo }
    }
    return checkOrgOwnerMembership(f, token, login, ownerInfo)
  }

  // Restricted-org / OAuth-unapproved refinement: an org-owned repo whose
  // permissions object is absent or zeroed carries no truthful signal at all.
  // Do NOT read a contributor-denial out of it; classify INDETERMINATE so a real
  // admin of a restricted org gets the "approve the app" copy, not "you don't own
  // this." (A real `permissions.admin === false` WITH a truthful signal is a clean
  // denial and is handled below.)
  const zeroedOrAbsent = !hasTruthfulPermissionSignal(permissions)

  if (ownerType === 'User') {
    // Personal repo: no org membership to consult. A real non-admin object is a
    // clean denial; a zeroed/absent object is the OAuth-unapproved shape.
    if (zeroedOrAbsent) return { classification: 'INDETERMINATE', ...ownerInfo }
    return { classification: 'NOT_ELIGIBLE', ...ownerInfo }
  }

  // ownerType === 'Organization'
  if (zeroedOrAbsent) {
    // Unapproved-OAuth-app shape — the membership call would 404 for the same
    // reason. Fail open to INDETERMINATE (third-party-app-policy suspicion).
    return { classification: 'INDETERMINATE', ...ownerInfo }
  }

  // 2b. Real non-admin repo signal on an org repo: the claimant might still be an
  // org OWNER. Require membership state=active && role=admin.
  return checkOrgOwnerMembership(f, token, login, ownerInfo)
}
