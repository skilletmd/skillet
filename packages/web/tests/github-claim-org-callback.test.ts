import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * U2 — the read:org brand-claim GitHub grant route (web).
 *
 * Covers start (state cookie + read:org authorize URL) and the callback's CSRF
 * gate, live-session gate (link-only, never account-creating), the ELIGIBLE ->
 * U5 server->server claim, and the INDETERMINATE fail-closed path. `fetch`,
 * `next/headers` cookies, and `next/navigation` redirect are mocked.
 */

// --- redirect sentinel ------------------------------------------------------
class RedirectError extends Error {
  constructor(public url: string) {
    super(`redirect:${url}`)
  }
}

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new RedirectError(url)
  },
}))

// revalidatePath is called on a successful claim to bust the brand page's cached
// profile; it's a no-op outside the Next render/route context, so stub it.
vi.mock('next/cache', () => ({
  revalidatePath: () => {},
}))

// --- cookie jar mock --------------------------------------------------------
interface SetCall {
  name: string
  value: string
  opts?: Record<string, unknown>
}
let jarStore: Map<string, string>
let setCalls: SetCall[]
let deleted: Set<string>

const fakeJar = {
  get(name: string) {
    return jarStore.has(name) ? { value: jarStore.get(name)! } : undefined
  },
  set(name: string, value: string, opts?: Record<string, unknown>) {
    jarStore.set(name, value)
    setCalls.push({ name, value, opts })
  },
  delete(name: string) {
    jarStore.delete(name)
    deleted.add(name)
  },
}

vi.mock('next/headers', () => ({
  cookies: () => fakeJar,
}))

import { GET as startGET } from '@/app/api/github/claim-org/start/route'
import { GET as callbackGET } from '@/app/api/github/claim-org/callback/route'

const REG = 'http://reg.test'

// --- fetch router -----------------------------------------------------------
interface Scenario {
  token?: string | null
  whoami?: { user_id: string } | null
  mirror?: {
    mirror_source_url?: string | null
    source_owner_id?: number | null
    source_owner_type?: 'User' | 'Organization' | null
  } | null
  /** Org membership for eligibility (default: active org owner). */
  membership?: { status?: number; state?: string; role?: string } | 'throw' | null
  repo?: { login: string; id: number; type: 'Organization' | 'User'; permissions?: Record<string, boolean> } | number
  /** Authed identity id returned by GET /user — drives the User-source owner gate. */
  authedUserId?: number
  claimStatus?: number
  /** GET /user/emails payload (logged-out bootstrap). A number = HTTP error status. */
  emails?: Array<{ email?: string; primary?: boolean; verified?: boolean }> | number
  /** Status of the account-bootstrap endpoint: 201 (created), 200 (account_exists), 409/422 (denied). */
  bootstrapStatus?: number
}

let claimBody: Record<string, unknown> | null
let bootstrapBody: Record<string, unknown> | null
let calls: string[]

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function installFetch(s: Scenario) {
  claimBody = null
  bootstrapBody = null
  calls = []
  const fn = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const u = typeof input === 'string' ? input : input.toString()
    calls.push(u)

    if (u.includes('login/oauth/access_token')) {
      return json(200, { access_token: s.token === undefined ? 'tok_readorg' : s.token })
    }
    if (u.endsWith('/api/v1/whoami')) {
      if (s.whoami === null) return json(401, { error: 'unauthorized' })
      return json(200, { token_class: 'session', ...(s.whoami ?? { user_id: 'user-1' }) })
    }
    if (u.includes('/api/v1/authors/')) {
      if (s.mirror === null) return json(404, { error: 'not found' })
      return json(200, s.mirror ?? { mirror_source_url: 'https://github.com/vercel/vercel', source_owner_id: 999 })
    }
    if (u.includes('api.github.com/repos/')) {
      const r = s.repo
      if (typeof r === 'number') return json(r, { message: 'err' })
      const repo = r ?? { login: 'vercel', id: 999, type: 'Organization' as const, permissions: { admin: true } }
      return json(200, { owner: { login: repo.login, id: repo.id, type: repo.type }, permissions: repo.permissions })
    }
    if (u.includes('api.github.com/user/memberships/orgs/')) {
      const m = s.membership
      if (m === 'throw') throw new Error('network down')
      if (m === null) return json(404, { message: 'not a member' })
      if (m != null) {
        const status = m.status ?? 200
        if (status !== 200) return json(status, { message: 'err' })
        return json(200, { state: m.state ?? 'active', role: m.role ?? 'admin' })
      }
      return json(200, { state: 'active', role: 'admin' })
    }
    if (u.includes('api.github.com/user/emails')) {
      // Verified-primary email lookup for the logged-OUT account-bootstrap path.
      if (typeof s.emails === 'number') return json(s.emails, { message: 'err' })
      return json(200, s.emails ?? [{ email: 'maya@example.com', primary: true, verified: true }])
    }
    if (u.endsWith('api.github.com/user')) {
      // The authed identity, used by the User-source owner gate (R16).
      return json(200, { id: s.authedUserId ?? 0 })
    }
    if (u.endsWith('/api/v1/auth/web/claim-github-bootstrap')) {
      bootstrapBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      const st = s.bootstrapStatus ?? 201
      if (st === 201) {
        return json(201, {
          account_exists: false,
          session_token: 'sess-bootstrapped',
          user_id: 'u-new',
          handle: bootstrapBody.handle,
        })
      }
      if (st === 200) return json(200, { account_exists: true })
      return json(st, { error: 'denied' })
    }
    if (u.endsWith('/api/v1/auth/web/claim-github')) {
      claimBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      return json(s.claimStatus ?? 201, { end_state: 'org', org_id: 'org-1', slug: 'vercel' })
    }
    throw new Error(`unexpected fetch: ${u}`)
  }
  vi.stubGlobal('fetch', vi.fn(fn))
}

function seedCallbackCookies(over: Partial<Record<string, string>> = {}) {
  jarStore.set('gh_claim_state', over.state ?? 'state-xyz')
  jarStore.set('gh_claim_handle', over.handle ?? 'vercel')
  jarStore.set('gh_claim_return', over.return ?? '/vercel')
  if (over.session !== '') jarStore.set('skillet_session', over.session ?? 'sess-abc')
}

async function runRedirect(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn()
  } catch (e) {
    if (e instanceof RedirectError) return e.url
    throw e
  }
  throw new Error('expected a redirect')
}

beforeEach(() => {
  jarStore = new Map()
  setCalls = []
  deleted = new Set()
  process.env.REGISTRY_URL = REG
  process.env.AUTH_GITHUB_ID = 'gh-client'
  process.env.AUTH_GITHUB_SECRET = 'gh-secret'
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('claim-org/start', () => {
  it('sets gh_claim_state httpOnly and redirects to the read:org authorize URL', async () => {
    const url = await runRedirect(() =>
      startGET(new Request('https://app.test/api/github/claim-org/start?handle=vercel&return=/vercel')),
    )
    const authorize = new URL(url)
    expect(authorize.origin + authorize.pathname).toBe('https://github.com/login/oauth/authorize')
    // user:email is requested so the logged-OUT bootstrap path can read the
    // claimant's verified primary email (the org/logged-in path ignores it).
    expect(authorize.searchParams.get('scope')).toBe('read:org user:email')
    expect(authorize.searchParams.get('redirect_uri')).toBe(
      'https://app.test/api/github/claim-org/callback',
    )
    const state = setCalls.find((c) => c.name === 'gh_claim_state')
    expect(state).toBeTruthy()
    expect(state!.opts?.httpOnly).toBe(true)
    expect(authorize.searchParams.get('state')).toBe(state!.value)
    expect(jarStore.get('gh_claim_handle')).toBe('vercel')
  })
})

describe('claim-org/callback', () => {
  it('rejects a mismatched state (CSRF) and attempts no claim', async () => {
    installFetch({})
    seedCallbackCookies()
    const url = await runRedirect(() =>
      callbackGET(new Request('https://app.test/api/github/claim-org/callback?code=c1&state=WRONG')),
    )
    expect(url).toBe('/vercel?claim=oauth_state')
    expect(calls.some((u) => u.includes('claim-github'))).toBe(false)
    expect(calls.some((u) => u.includes('access_token'))).toBe(false)
  })

  it('no session + Organization source -> routes to login, no token exchange, no bootstrap', async () => {
    // Org source: a logged-OUT viewer can NEVER bootstrap an account. We resolve the
    // source first and bail to login WITHOUT even exchanging an OAuth token.
    installFetch({
      mirror: { mirror_source_url: 'https://github.com/vercel/vercel', source_owner_type: 'Organization' },
    })
    seedCallbackCookies({ session: '' })
    const url = await runRedirect(() =>
      callbackGET(new Request('https://app.test/api/github/claim-org/callback?code=c1&state=state-xyz')),
    )
    expect(url).toBe('/login?callbackUrl=%2Fvercel&claim=login_required')
    expect(calls.some((u) => u.includes('access_token'))).toBe(false)
    expect(calls.some((u) => u.includes('claim-github-bootstrap'))).toBe(false)
  })

  it('no session + unknown source type -> routes to login (fail closed), no bootstrap', async () => {
    installFetch({
      mirror: { mirror_source_url: 'https://github.com/vercel/vercel' }, // no source_owner_type
    })
    seedCallbackCookies({ session: '' })
    const url = await runRedirect(() =>
      callbackGET(new Request('https://app.test/api/github/claim-org/callback?code=c1&state=state-xyz')),
    )
    expect(url).toBe('/login?callbackUrl=%2Fvercel&claim=login_required')
    expect(calls.some((u) => u.includes('claim-github-bootstrap'))).toBe(false)
  })

  it('no session + User source ELIGIBLE + verified email -> bootstraps, sets session cookie, redirects claimed', async () => {
    installFetch({
      mirror: {
        mirror_source_url: 'https://github.com/maya/skills',
        source_owner_id: 555,
        source_owner_type: 'User',
      },
      repo: { login: 'maya', id: 555, type: 'User', permissions: { admin: true } },
      authedUserId: 555,
      emails: [
        { email: 'noise@x.com', primary: false, verified: true },
        { email: 'maya@example.com', primary: true, verified: true },
      ],
    })
    seedCallbackCookies({ session: '', handle: 'maya', return: '/maya' })
    const url = await runRedirect(() =>
      callbackGET(new Request('https://app.test/api/github/claim-org/callback?code=c1&state=state-xyz')),
    )
    expect(url).toBe('/maya?claim=claimed')
    expect(bootstrapBody).toEqual({
      handle: 'maya',
      github_login: 'maya',
      github_id: 555,
      verified_email: 'maya@example.com',
    })
    // The minted session token is written to the session cookie (now logged in).
    const session = setCalls.find((c) => c.name === 'skillet_session')
    expect(session?.value).toBe('sess-bootstrapped')
    const result = setCalls.find((c) => c.name === 'gh_claim_result')
    expect(JSON.parse(result!.value)).toMatchObject({
      classification: 'ELIGIBLE',
      handle: 'maya',
      claimed: true,
      ownerType: 'User',
    })
  })

  it('no session + User source but no verified primary email -> login redirect, no account', async () => {
    installFetch({
      mirror: {
        mirror_source_url: 'https://github.com/maya/skills',
        source_owner_id: 555,
        source_owner_type: 'User',
      },
      repo: { login: 'maya', id: 555, type: 'User', permissions: { admin: true } },
      authedUserId: 555,
      emails: [{ email: 'maya@example.com', primary: true, verified: false }], // none verified+primary
    })
    seedCallbackCookies({ session: '', handle: 'maya', return: '/maya' })
    const url = await runRedirect(() =>
      callbackGET(new Request('https://app.test/api/github/claim-org/callback?code=c1&state=state-xyz')),
    )
    expect(url).toBe('/login?callbackUrl=%2Fmaya&claim=no_verified_email')
    expect(calls.some((u) => u.includes('claim-github-bootstrap'))).toBe(false)
  })

  it('no session + User source, eligible collaborator (not owner) -> NOT_ELIGIBLE login redirect, no bootstrap', async () => {
    // Admin collaborator on the personal repo, but authed id != owner id -> NOT_ELIGIBLE.
    installFetch({
      mirror: {
        mirror_source_url: 'https://github.com/maya/skills',
        source_owner_id: 555,
        source_owner_type: 'User',
      },
      repo: { login: 'maya', id: 555, type: 'User', permissions: { admin: true } },
      authedUserId: 999, // not the owner
    })
    seedCallbackCookies({ session: '', handle: 'maya', return: '/maya' })
    const url = await runRedirect(() =>
      callbackGET(new Request('https://app.test/api/github/claim-org/callback?code=c1&state=state-xyz')),
    )
    expect(url).toBe('/login?callbackUrl=%2Fmaya&claim=not_eligible')
    expect(calls.some((u) => u.includes('claim-github-bootstrap'))).toBe(false)
  })

  it('no session + account already exists -> login redirect, no session cookie set', async () => {
    installFetch({
      mirror: {
        mirror_source_url: 'https://github.com/maya/skills',
        source_owner_id: 555,
        source_owner_type: 'User',
      },
      repo: { login: 'maya', id: 555, type: 'User', permissions: { admin: true } },
      authedUserId: 555,
      bootstrapStatus: 200, // registry says: an account already exists
    })
    seedCallbackCookies({ session: '', handle: 'maya', return: '/maya' })
    const url = await runRedirect(() =>
      callbackGET(new Request('https://app.test/api/github/claim-org/callback?code=c1&state=state-xyz')),
    )
    expect(url).toBe('/login?callbackUrl=%2Fmaya&claim=account_exists')
    expect(setCalls.some((c) => c.name === 'skillet_session')).toBe(false)
  })

  it('ELIGIBLE -> calls U5 with the verified handle, sets result cookie, redirects to brand page', async () => {
    installFetch({})
    seedCallbackCookies()
    const url = await runRedirect(() =>
      callbackGET(new Request('https://app.test/api/github/claim-org/callback?code=c1&state=state-xyz')),
    )
    expect(url).toBe('/vercel?claim=claimed')
    expect(claimBody).toEqual({
      handle: 'vercel',
      github_login: 'vercel',
      github_id: 999,
      end_state: 'org',
      user_id: 'user-1',
    })
    const result = setCalls.find((c) => c.name === 'gh_claim_result')
    expect(result).toBeTruthy()
    expect(result!.opts?.httpOnly).toBe(true)
    expect(JSON.parse(result!.value)).toMatchObject({ classification: 'ELIGIBLE', handle: 'vercel', claimed: true })
  })

  it('User-source ELIGIBLE -> claims (end_state=user is advisory) and carries ownerType User', async () => {
    // A personal repo the claimant actually owns: repo admin + GET /user id == owner id.
    installFetch({
      mirror: { mirror_source_url: 'https://github.com/maya/skills', source_owner_id: 555 },
      repo: { login: 'maya', id: 555, type: 'User', permissions: { admin: true } },
      authedUserId: 555,
    })
    seedCallbackCookies({ handle: 'maya', return: '/maya' })
    const url = await runRedirect(() =>
      callbackGET(new Request('https://app.test/api/github/claim-org/callback?code=c1&state=state-xyz')),
    )
    expect(url).toBe('/maya?claim=claimed')
    // The BFF still forwards the derived end_state (advisory); the registry grants an org.
    expect(claimBody).toEqual({
      handle: 'maya',
      github_login: 'maya',
      github_id: 555,
      end_state: 'user',
      user_id: 'user-1',
    })
    const result = setCalls.find((c) => c.name === 'gh_claim_result')
    expect(JSON.parse(result!.value)).toMatchObject({
      classification: 'ELIGIBLE',
      handle: 'maya',
      claimed: true,
      ownerType: 'User',
    })
  })

  it('poisoned gh_claim_handle cookie does not produce an off-site redirect fallback', async () => {
    jarStore.set('gh_claim_state', 'state-xyz')
    jarStore.set('gh_claim_handle', '//evil.com')
    jarStore.set('gh_claim_return', '/settings')
    jarStore.set('skillet_session', 'sess-abc')
    const url = await runRedirect(() =>
      callbackGET(new Request('https://app.test/api/github/claim-org/callback?claim=oauth_state')),
    )
    expect(url).toBe('/settings?claim=oauth_state')
    expect(url.startsWith('//')).toBe(false)
  })

  it('NOT_ELIGIBLE (contributor) -> redirect carries not_eligible, attempts no claim', async () => {
    // Org repo, real non-admin perms + membership 404 -> clean contributor denial.
    installFetch({
      repo: { login: 'vercel', id: 999, type: 'Organization', permissions: { admin: false, pull: true } },
      membership: { status: 404 },
    })
    seedCallbackCookies()
    const url = await runRedirect(() =>
      callbackGET(new Request('https://app.test/api/github/claim-org/callback?code=c1&state=state-xyz')),
    )
    expect(url).toBe('/vercel?claim=not_eligible')
    expect(calls.some((u) => u.includes('claim-github'))).toBe(false)
    const result = setCalls.find((c) => c.name === 'gh_claim_result')
    expect(JSON.parse(result!.value)).toMatchObject({ classification: 'NOT_ELIGIBLE', handle: 'vercel' })
  })

  it('200-join (R4) -> ALREADY_MANAGED, claimed=false (not "you now manage")', async () => {
    // Eligible viewer, but the registry returns the existing owner's org (HTTP 200).
    installFetch({ claimStatus: 200 })
    seedCallbackCookies()
    const url = await runRedirect(() =>
      callbackGET(new Request('https://app.test/api/github/claim-org/callback?code=c1&state=state-xyz')),
    )
    expect(url).toBe('/vercel?claim=already_managed')
    // The claim WAS attempted (eligible), but the outcome is a join, not a takeover.
    expect(calls.some((u) => u.includes('claim-github'))).toBe(true)
    const result = setCalls.find((c) => c.name === 'gh_claim_result')
    expect(JSON.parse(result!.value)).toMatchObject({
      classification: 'ALREADY_MANAGED',
      handle: 'vercel',
      claimed: false,
    })
  })

  it('definitive 409 -> DENIED (accurate non-retry), never the indeterminate org-policy copy', async () => {
    installFetch({ claimStatus: 409 })
    seedCallbackCookies()
    const url = await runRedirect(() =>
      callbackGET(new Request('https://app.test/api/github/claim-org/callback?code=c1&state=state-xyz')),
    )
    expect(url).toBe('/vercel?claim=denied')
    const result = setCalls.find((c) => c.name === 'gh_claim_result')
    const parsed = JSON.parse(result!.value)
    expect(parsed).toMatchObject({ classification: 'DENIED', handle: 'vercel' })
    // The masking bug: a 409 must NOT be reported as INDETERMINATE.
    expect(parsed.classification).not.toBe('INDETERMINATE')
  })

  it('INDETERMINATE -> sets indeterminate result, clears state cookies, attempts no claim', async () => {
    // Org-owned repo with a zeroed permissions object -> INDETERMINATE.
    installFetch({ repo: { login: 'vercel', id: 999, type: 'Organization', permissions: {} } })
    seedCallbackCookies()
    const url = await runRedirect(() =>
      callbackGET(new Request('https://app.test/api/github/claim-org/callback?code=c1&state=state-xyz')),
    )
    expect(url).toBe('/vercel?claim=indeterminate')
    expect(calls.some((u) => u.includes('claim-github'))).toBe(false)
    const result = setCalls.find((c) => c.name === 'gh_claim_result')
    expect(JSON.parse(result!.value)).toMatchObject({ classification: 'INDETERMINATE', handle: 'vercel' })
    expect(deleted.has('gh_claim_state')).toBe(true)
    expect(deleted.has('gh_claim_handle')).toBe(true)
    expect(deleted.has('gh_claim_return')).toBe(true)
  })
})
