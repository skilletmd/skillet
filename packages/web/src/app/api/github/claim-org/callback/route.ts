import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { readAuthGithubCredentials } from '@/lib/oauth-env'
import {
  readSessionCookie,
  SKILLET_SESSION_COOKIE,
  skilletSessionCookieOptions,
} from '@/lib/session-cookie'
import { safeRedirectPath } from '@/lib/auth-errors'
import { safeClaimHandle } from '@/lib/gh-claim-handle'
import { fetchRegistryWhoami, webInternalSecret } from '@/lib/registry-session'
import { signWebInternalHeaders } from '@/lib/web-internal-sign'
import { REGISTRY_API } from '@/lib/registry-prefix'
import { checkClaimEligibility, type EligibilityResult } from '@/lib/github-claim-eligibility'
import {
  GH_CLAIM_STATE_COOKIE,
  GH_CLAIM_RETURN_COOKIE,
  GH_CLAIM_HANDLE_COOKIE,
} from '../start/route'
// Single source of truth lives with the reader (the brand page renders from it).
import { GH_CLAIM_RESULT_COOKIE, type ClaimOwnerType } from '@/components/mirror-notice'

function registryBaseUrl(): string {
  return process.env.REGISTRY_URL ?? process.env.NEXT_PUBLIC_REGISTRY_URL ?? 'http://127.0.0.1:3481'
}

type Jar = Awaited<ReturnType<typeof cookies>>

/** Clear the start-route state cookies so a retry after approving the app is clean. */
function clearStateCookies(jar: Jar): void {
  jar.delete(GH_CLAIM_STATE_COOKIE)
  jar.delete(GH_CLAIM_RETURN_COOKIE)
  jar.delete(GH_CLAIM_HANDLE_COOKIE)
}

/** Short-lived httpOnly result cookie the brand page reads + clears on next render. */
function setResultCookie(
  jar: Jar,
  value: {
    classification: string
    handle: string
    claimed?: boolean
    /** Gates the INDETERMINATE org-OAuth-policy remediation (no org link for a User source). */
    ownerType?: ClaimOwnerType | null
  },
): void {
  jar.set(GH_CLAIM_RESULT_COOKIE, JSON.stringify(value), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 120,
  })
}

interface MirrorSource {
  owner: string
  repo: string
  /** Seed-captured GitHub owner numeric id. Null when the registry doesn't expose it yet. */
  sourceOwnerId: number | null
  /** GitHub source owner type. Only a 'User' source may bootstrap a logged-OUT account. */
  sourceOwnerType: 'User' | 'Organization' | null
}

/** Parse `{owner, repo}` out of a stored `mirror_source_url` (full URL or `owner/repo`). */
function parseOwnerRepo(sourceUrl: string | null | undefined): { owner: string; repo: string } | null {
  if (!sourceUrl) return null
  let path: string
  try {
    path = /^https?:\/\//i.test(sourceUrl) ? new URL(sourceUrl).pathname : sourceUrl
  } catch {
    return null
  }
  const seg = path.replace(/^\/+/, '').split('/')
  const owner = seg[0]
  const repo = (seg[1] ?? '').replace(/\.git$/i, '')
  if (!owner || !repo) return null
  return { owner, repo }
}

/** Resolve the mirror's source repo (and any seed-captured owner id) from the registry. */
async function resolveMirrorSource(handle: string): Promise<MirrorSource | null> {
  let res: Response
  try {
    res = await fetch(`${registryBaseUrl()}${REGISTRY_API}/authors/${encodeURIComponent(handle)}`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    })
  } catch {
    return null
  }
  if (!res.ok) return null
  let body: {
    mirror_source_url?: string | null
    source_owner_id?: number | null
    source_owner_type?: string | null
  }
  try {
    body = (await res.json()) as typeof body
  } catch {
    return null
  }
  const parsed = parseOwnerRepo(body.mirror_source_url)
  if (!parsed) return null
  const sourceOwnerId = typeof body.source_owner_id === 'number' ? body.source_owner_id : null
  const sourceOwnerType =
    body.source_owner_type === 'User' || body.source_owner_type === 'Organization'
      ? body.source_owner_type
      : null
  return { ...parsed, sourceOwnerId, sourceOwnerType }
}

/**
 * Result of the U5 server->server claim. We must distinguish a fresh grant from a
 * join from a definitive refusal so the brand page renders the right message
 * (a 200-join must NOT read as "you now manage", and a 409/422 must NOT mask as
 * the INDETERMINATE "approve the app / try again" remediation):
 *  - 'claimed'         — HTTP 201: the viewer now owns the brand.
 *  - 'already_managed' — HTTP 200: the registry returned the existing owner's org
 *                        (R4 join affordance). The viewer did NOT take it over.
 *  - 'denied'          — HTTP 409 (name/org taken) or 422 (mismatch): definitive,
 *                        non-retryable.
 *  - 'error'           — any other status / network throw: unverifiable, treat as
 *                        INDETERMINATE so the viewer can retry.
 */
type ClaimOutcome = 'claimed' | 'already_managed' | 'denied' | 'error'

/** HMAC-signed server->server claim call to U5 (never browser-reachable). */
async function postClaimGithub(input: {
  handle: string
  githubLogin: string
  githubId: number
  endState: 'org' | 'user'
  userId: string
}): Promise<ClaimOutcome> {
  const path = `${REGISTRY_API}/auth/web/claim-github`
  const reqBody = {
    handle: input.handle,
    github_login: input.githubLogin,
    github_id: input.githubId,
    end_state: input.endState,
    user_id: input.userId,
  }
  try {
    const res = await fetch(`${registryBaseUrl()}${path}`, {
      method: 'POST',
      headers: {
        ...signWebInternalHeaders({ secret: webInternalSecret(), method: 'POST', path, body: reqBody }),
        'content-type': 'application/json',
      },
      body: JSON.stringify(reqBody),
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    })
    // Drain the body (best-effort) so a 409/422 error code is available for intent;
    // the status is authoritative for the outcome.
    await res.json().catch(() => null)
    if (res.status === 201) return 'claimed'
    if (res.status === 200) return 'already_managed'
    if (res.status === 409 || res.status === 422) return 'denied'
    return 'error'
  } catch {
    return 'error'
  }
}

/**
 * Fetch the claimant's PRIMARY, VERIFIED GitHub email from their OWN token
 * (`user:email` scope). Returns the lowercased address, or null when GitHub has no
 * primary verified email (or the call fails) — the caller fails closed and never
 * mints an account without one. The token is request-scoped and discarded.
 */
async function fetchVerifiedPrimaryEmail(token: string): Promise<string | null> {
  let res: Response
  try {
    res = await fetch('https://api.github.com/user/emails', {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'skillet-claim-bootstrap',
        'x-github-api-version': '2022-11-28',
        authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    return null
  }
  if (!res.ok) return null
  let body: Array<{ email?: string; primary?: boolean; verified?: boolean }>
  try {
    body = (await res.json()) as typeof body
  } catch {
    return null
  }
  if (!Array.isArray(body)) return null
  const primary = body.find((e) => e.primary === true && e.verified === true && typeof e.email === 'string')
  return primary?.email ? primary.email.trim().toLowerCase() : null
}

/**
 * Outcome of the logged-OUT account-bootstrap call to the registry:
 *  - 'created'        — HTTP 201: a fresh account was minted; carries the session token.
 *  - 'account_exists' — HTTP 200 {account_exists:true}: an account already exists for
 *                       this GitHub identity / verified email; the caller sends them
 *                       to log in instead (no duplicate minted).
 *  - 'denied'         — 409/422: definitive registry refusal.
 *  - 'error'          — any other status / throw: unverifiable.
 */
type BootstrapOutcome =
  | { kind: 'created'; sessionToken: string }
  | { kind: 'account_exists' }
  | { kind: 'denied' }
  | { kind: 'error' }

/** HMAC-signed server->server account-bootstrap call (never browser-reachable). */
async function postClaimBootstrap(input: {
  handle: string
  githubLogin: string
  githubId: number
  verifiedEmail: string
}): Promise<BootstrapOutcome> {
  const path = `${REGISTRY_API}/auth/web/claim-github-bootstrap`
  const reqBody = {
    handle: input.handle,
    github_login: input.githubLogin,
    github_id: input.githubId,
    verified_email: input.verifiedEmail,
  }
  try {
    const res = await fetch(`${registryBaseUrl()}${path}`, {
      method: 'POST',
      headers: {
        ...signWebInternalHeaders({ secret: webInternalSecret(), method: 'POST', path, body: reqBody }),
        'content-type': 'application/json',
      },
      body: JSON.stringify(reqBody),
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    })
    if (res.status === 201) {
      const out = (await res.json().catch(() => null)) as { session_token?: string } | null
      if (out?.session_token) return { kind: 'created', sessionToken: out.session_token }
      return { kind: 'error' }
    }
    if (res.status === 200) {
      await res.json().catch(() => null)
      return { kind: 'account_exists' }
    }
    if (res.status === 409 || res.status === 422) return { kind: 'denied' }
    return { kind: 'error' }
  } catch {
    return { kind: 'error' }
  }
}

/** Build a redirect to the login page, carrying the brand page as the post-login
 *  destination plus a `?claim=` reason so the user sees why bootstrap couldn't run. */
function loginRedirect(handle: string, reason: string): string {
  const callback = `/${handle}`
  return `/login?callbackUrl=${encodeURIComponent(callback)}&claim=${reason}`
}

/**
 * Brand-claim GitHub grant — CALLBACK. Completes the grant, branching on whether
 * the viewer has a live `skillet_session`:
 *
 *   SESSION PRESENT -> Pass-1 logged-in claim: own the namespace as an ORG. The
 *   normal Auth.js GitHub sign-in stays link-only; this path never creates an
 *   account.
 *
 *   NO SESSION -> logged-OUT account bootstrap: the ONLY GitHub-claim path that may
 *   create an account, and only for a USER-source mirror under hard, fail-closed
 *   gates — (1) the source must be a GitHub User (an Organization source bails to
 *   login), (2) eligibility must be ELIGIBLE + ownerType User (which already proves
 *   the authed GitHub id == the repo owner id), (3) the GitHub account must have a
 *   primary verified email. The registry re-checks every gate. On any miss we
 *   redirect to login with a `?claim=` reason and create NOTHING.
 *
 * The OAuth token is discarded after the checks. On a logged-out success the
 * minted session token is written to the `skillet_session` cookie and the viewer
 * lands on the brand page logged in as @handle. The outcome rides a short-lived
 * httpOnly `gh_claim_result` cookie; state cookies are cleared so a retry is clean.
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const jar = await cookies()
  const expectedState = jar.get(GH_CLAIM_STATE_COOKIE)?.value
  const handle = safeClaimHandle(jar.get(GH_CLAIM_HANDLE_COOKIE)?.value) ?? ''
  const returnTo = safeRedirectPath(jar.get(GH_CLAIM_RETURN_COOKIE)?.value, handle ? `/${handle}` : '/')

  // 1. CSRF: state must match the cookie. No claim attempted on a mismatch.
  if (!code || !state || !expectedState || state !== expectedState || !handle) {
    clearStateCookies(jar)
    redirect(`${returnTo}?claim=oauth_state`)
  }

  // 2. The session's presence selects the path (we do NOT redirect on absence).
  const sessionToken = readSessionCookie(jar)

  const creds = readAuthGithubCredentials()
  if (!creds) {
    clearStateCookies(jar)
    redirect(`${returnTo}?claim=github_unconfigured`)
  }

  // ===== SESSION PRESENT: Pass-1 logged-in claim — own the namespace as an org. =====
  if (sessionToken) {
    // 3. Exchange the code for a request-scoped token (discarded below).
    let token: string | null = null
    try {
      const res = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ client_id: creds!.id, client_secret: creds!.secret, code }),
        signal: AbortSignal.timeout(10_000),
      })
      const body = (await res.json()) as { access_token?: string }
      token = body.access_token ?? null
    } catch {
      clearStateCookies(jar)
      redirect(`${returnTo}?claim=oauth_exchange`)
    }
    if (!token) {
      clearStateCookies(jar)
      redirect(`${returnTo}?claim=oauth_no_token`)
    }

    // The session must still be live registry-side (and yield the claimant user id).
    const whoami = await fetchRegistryWhoami(sessionToken)
    if (!whoami) {
      clearStateCookies(jar)
      redirect(`${returnTo}?claim=login_required`)
    }

    // 4. Resolve the mirror's source repo (+ any seed-captured owner id).
    const source = await resolveMirrorSource(handle)
    if (!source) {
      clearStateCookies(jar)
      setResultCookie(jar, { classification: 'INDETERMINATE', handle })
      redirect(`${returnTo}?claim=indeterminate`)
    }

    // 5. Eligibility from the claimant's OWN token. Pass the
    // seed-captured owner id through as-is (null does not fail an otherwise-valid claim).
    const result: EligibilityResult = await checkClaimEligibility({
      token: token!,
      source: { owner: source!.owner, repo: source!.repo },
      expectedHandle: handle,
      expectedOwnerId: source!.sourceOwnerId,
    })
    token = null // Discard the OAuth token — never persisted.

    if (result.classification === 'ELIGIBLE' && result.login && result.id && result.endState) {
      const outcome = await postClaimGithub({
        handle,
        githubLogin: result.login,
        githubId: result.id,
        endState: result.endState,
        userId: whoami!.user_id,
      })
      clearStateCookies(jar)
      const ownerType = result.ownerType
      if (outcome === 'claimed') {
        // The mirror just flipped to claimed; bust the brand page's cached profile
        // (fetchLive uses a 60s revalidate) so the claimed state shows immediately.
        revalidatePath(`/${handle}`)
        setResultCookie(jar, { classification: 'ELIGIBLE', handle, claimed: true, ownerType })
        redirect(`${returnTo}?claim=claimed`)
      }
      if (outcome === 'already_managed') {
        // R4 join (HTTP 200): the brand stays with its existing owner, not a takeover.
        revalidatePath(`/${handle}`)
        setResultCookie(jar, { classification: 'ALREADY_MANAGED', handle, claimed: false, ownerType })
        redirect(`${returnTo}?claim=already_managed`)
      }
      if (outcome === 'denied') {
        // Definitive 409/422 — accurate, non-retryable. Never the INDETERMINATE copy.
        setResultCookie(jar, { classification: 'DENIED', handle, claimed: false, ownerType })
        redirect(`${returnTo}?claim=denied`)
      }
      // 'error' — unverifiable; fall through to INDETERMINATE so the viewer can retry.
      setResultCookie(jar, { classification: 'INDETERMINATE', handle, ownerType })
      redirect(`${returnTo}?claim=indeterminate`)
    }

    // NOT_ELIGIBLE / INDETERMINATE: no claim attempted. Clear state for a clean retry.
    clearStateCookies(jar)
    setResultCookie(jar, { classification: result.classification, handle, ownerType: result.ownerType })
    redirect(`${returnTo}?claim=${result.classification === 'NOT_ELIGIBLE' ? 'not_eligible' : 'indeterminate'}`)
  }

  // ===== NO SESSION: logged-OUT account bootstrap (User-source mirrors only). =====
  // Resolve the mirror source FIRST so a non-User (or unresolvable) source bails to
  // login WITHOUT even exchanging an OAuth token — fail closed, create nothing.
  const source = await resolveMirrorSource(handle)
  if (!source) {
    clearStateCookies(jar)
    redirect(loginRedirect(handle, 'indeterminate'))
  }
  // GATE 1: an Organization (or unknown/NULL) source can NEVER bootstrap an account.
  if (source!.sourceOwnerType !== 'User') {
    clearStateCookies(jar)
    redirect(loginRedirect(handle, 'login_required'))
  }

  // Exchange the code for a request-scoped token (read:org user:email), discarded
  // after the eligibility + verified-email reads below.
  let token: string | null = null
  try {
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: creds!.id, client_secret: creds!.secret, code }),
      signal: AbortSignal.timeout(10_000),
    })
    const body = (await res.json()) as { access_token?: string }
    token = body.access_token ?? null
  } catch {
    clearStateCookies(jar)
    redirect(loginRedirect(handle, 'oauth_exchange'))
  }
  if (!token) {
    clearStateCookies(jar)
    redirect(loginRedirect(handle, 'oauth_no_token'))
  }

  // GATE 2: eligibility from the claimant's OWN token. For a User source, ELIGIBLE
  // already proves the authed GitHub id == the repo owner id (R16) — a mere admin
  // collaborator on the personal repo is NOT_ELIGIBLE, so cannot bootstrap.
  const result: EligibilityResult = await checkClaimEligibility({
    token: token!,
    source: { owner: source!.owner, repo: source!.repo },
    expectedHandle: handle,
    expectedOwnerId: source!.sourceOwnerId,
  })
  if (
    !(result.classification === 'ELIGIBLE' && result.ownerType === 'User' && result.login && result.id)
  ) {
    token = null
    clearStateCookies(jar)
    redirect(
      loginRedirect(handle, result.classification === 'NOT_ELIGIBLE' ? 'not_eligible' : 'indeterminate'),
    )
  }

  // GATE 3: read the PRIMARY verified email. None -> create no account.
  const verifiedEmail = await fetchVerifiedPrimaryEmail(token!)
  token = null // Discard the OAuth token — never persisted.
  if (!verifiedEmail) {
    clearStateCookies(jar)
    redirect(loginRedirect(handle, 'no_verified_email'))
  }

  // Mint the account (the registry re-checks every gate, fail-closed + idempotent).
  const outcome = await postClaimBootstrap({
    handle,
    githubLogin: result.login!,
    githubId: result.id!,
    verifiedEmail: verifiedEmail!,
  })
  clearStateCookies(jar)
  if (outcome.kind === 'created') {
    // Logged in as @handle now: set the session cookie and land on the brand page.
    revalidatePath(`/${handle}`)
    jar.set(SKILLET_SESSION_COOKIE, outcome.sessionToken, skilletSessionCookieOptions)
    setResultCookie(jar, { classification: 'ELIGIBLE', handle, claimed: true, ownerType: 'User' })
    redirect(`${returnTo}?claim=claimed`)
  }
  if (outcome.kind === 'account_exists') {
    // They already have an account — log in instead (no duplicate minted).
    redirect(loginRedirect(handle, 'account_exists'))
  }
  if (outcome.kind === 'denied') {
    setResultCookie(jar, { classification: 'DENIED', handle, claimed: false, ownerType: 'User' })
    redirect(`${returnTo}?claim=denied`)
  }
  // 'error' — unverifiable; INDETERMINATE so the viewer can retry.
  setResultCookie(jar, { classification: 'INDETERMINATE', handle, ownerType: 'User' })
  redirect(`${returnTo}?claim=indeterminate`)
}
