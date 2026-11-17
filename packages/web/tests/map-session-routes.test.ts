import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// The save tab's three same-origin routes (kit map onboarding, KTD6). The
// binding lives in a Strict, httpOnly cookie scoped to one map session's path,
// so page script never sees it; bind and approve also check the request's
// Origin and a same-origin request token. The registry is a fetch mock here.

const webSessionIdentityMock = vi.hoisted(() => vi.fn())
const refreshRegistryWebSessionMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/registry-session', () => ({
  webSessionIdentity: webSessionIdentityMock,
  refreshRegistryWebSession: refreshRegistryWebSessionMock,
}))

import { GET as getBinding } from '@/app/api/map-sessions/[id]/binding/route'
import { POST as postBind } from '@/app/api/map-sessions/[id]/bind/route'
import { POST as postApprove } from '@/app/api/map-sessions/[id]/approve/route'
import {
  MAP_BINDING_COOKIE,
  MAP_TOKEN_COOKIE,
  MAP_TOKEN_HEADER,
} from '@/app/api/map-sessions/map-session-guard'

const ID = '0123456789abcdef0123456789abcdef'
const SITE = 'http://localhost:3498'
const REGISTRY = 'http://registry.test'
const TOKEN = 'T'.repeat(43)
const PROOF = 'p'.repeat(43)
const BINDING = 'b'.repeat(43)
const COUNTS = { backups: 21, removals: 2, fills: 3, merges: 1 }
const PATH = `/api/map-sessions/${ID}`

const ctx = (id = ID) => ({ params: Promise.resolve({ id }) })
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const nowSec = () => Math.floor(Date.now() / 1000)

function request(
  path: string,
  { method = 'POST', body, cookies = {}, headers = {} }: {
    method?: string
    body?: unknown
    cookies?: Record<string, string>
    headers?: Record<string, string>
  } = {},
): NextRequest {
  const cookie = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ')
  return new NextRequest(`${SITE}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

/** What the save tab's own fetch carries. */
const SAME_ORIGIN = { 'sec-fetch-site': 'same-origin', origin: SITE, [MAP_TOKEN_HEADER]: TOKEN }

let fetchMock: ReturnType<typeof vi.fn>
/** Registry answers by `METHOD path`; anything else fails the test. */
function registry(answers: Record<string, (init: RequestInit) => Response>) {
  fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input))
    const key = `${init.method ?? 'GET'} ${url.pathname}`
    const answer = answers[key]
    if (!answer) throw new Error(`unexpected registry call: ${key}`)
    return answer(init)
  })
  vi.stubGlobal('fetch', fetchMock)
}
const calls = (key: string) =>
  fetchMock.mock.calls.filter(([input, init]) => `${(init as RequestInit | undefined)?.method ?? 'GET'} ${new URL(String(input)).pathname}` === key)
const headerOf = (init: RequestInit, name: string) => new Headers(init.headers).get(name)

/** Binds once and returns the binding cookie's value, as the browser would store it. */
async function bindCookie(counts = COUNTS): Promise<string> {
  registry({
    [`POST /api/v1/map-sessions/${ID}/bind`]: () => json({ binding: BINDING, expires_at: nowSec() + 600 }),
  })
  const res = await postBind(
    request(`${PATH}/bind`, { body: { proof: PROOF, counts }, cookies: { [MAP_TOKEN_COOKIE]: TOKEN }, headers: SAME_ORIGIN }),
    ctx(),
  )
  expect(res.status).toBe(200)
  const value = res.cookies.get(MAP_BINDING_COOKIE)?.value
  expect(value).toBeTruthy()
  return value!
}

beforeEach(() => {
  vi.stubEnv('REGISTRY_URL', REGISTRY)
  webSessionIdentityMock.mockReset().mockResolvedValue(null)
  refreshRegistryWebSessionMock.mockReset().mockResolvedValue(null)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('POST /api/map-sessions/:id/bind', () => {
  it('trades the proof for a Strict, httpOnly binding cookie scoped to this session, and never hands the binding to the page', async () => {
    registry({
      [`POST /api/v1/map-sessions/${ID}/bind`]: () => json({ binding: BINDING, expires_at: nowSec() + 600 }),
    })
    const res = await postBind(
      request(`${PATH}/bind`, { body: { proof: PROOF, counts: COUNTS }, cookies: { [MAP_TOKEN_COOKIE]: TOKEN }, headers: SAME_ORIGIN }),
      ctx(),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true })
    expect(JSON.stringify(body)).not.toContain(BINDING)

    // The registry gets the proof and nothing else: the counts stay on skillet.md.
    const [[, init]] = calls(`POST /api/v1/map-sessions/${ID}/bind`)
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ proof: PROOF })

    const cookie = res.cookies.get(MAP_BINDING_COOKIE)!
    expect(cookie.value).toContain(BINDING)
    expect(cookie.httpOnly).toBe(true)
    expect(cookie.sameSite).toBe('strict')
    expect(cookie.path).toBe(PATH)
    expect(cookie.maxAge).toBeGreaterThan(0)
    expect(cookie.maxAge).toBeLessThanOrEqual(600)
  })

  it('refuses a cross-site POST before it reaches the registry', async () => {
    registry({})
    const refused: Record<string, string>[] = [
      { ...SAME_ORIGIN, 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' },
      { ...SAME_ORIGIN, 'sec-fetch-site': 'same-site', origin: 'https://evil.skillet.md' },
      // An older browser: no Sec-Fetch-Site, so the Origin decides.
      { origin: 'https://evil.example', [MAP_TOKEN_HEADER]: TOKEN },
      // Neither header: refused, not waved through.
      { [MAP_TOKEN_HEADER]: TOKEN },
      // Same origin, but without the request token, or with the wrong one.
      { 'sec-fetch-site': 'same-origin', origin: SITE },
      { ...SAME_ORIGIN, [MAP_TOKEN_HEADER]: 'X'.repeat(43) },
    ]
    for (const headers of refused) {
      const res = await postBind(
        request(`${PATH}/bind`, { body: { proof: PROOF, counts: COUNTS }, cookies: { [MAP_TOKEN_COOKIE]: TOKEN }, headers }),
        ctx(),
      )
      expect(res.status, JSON.stringify(headers)).toBe(403)
      expect(res.cookies.get(MAP_BINDING_COOKIE)).toBeUndefined()
    }
    // The token header with no token cookie to match.
    const bare = await postBind(request(`${PATH}/bind`, { body: { proof: PROOF, counts: COUNTS }, headers: SAME_ORIGIN }), ctx())
    expect(bare.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a wrong or spent proof is refused and sets no cookie', async () => {
    registry({
      [`POST /api/v1/map-sessions/${ID}/bind`]: () => json({ error: 'proof_invalid' }, 403),
    })
    const res = await postBind(
      request(`${PATH}/bind`, { body: { proof: PROOF, counts: COUNTS }, cookies: { [MAP_TOKEN_COOKIE]: TOKEN }, headers: SAME_ORIGIN }),
      ctx(),
    )
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'proof_invalid' })
    expect(res.cookies.get(MAP_BINDING_COOKIE)).toBeUndefined()
  })

  it('an expired session says so', async () => {
    registry({
      [`POST /api/v1/map-sessions/${ID}/bind`]: () => json({ error: 'map_session_expired' }, 410),
    })
    const res = await postBind(
      request(`${PATH}/bind`, { body: { proof: PROOF, counts: COUNTS }, cookies: { [MAP_TOKEN_COOKIE]: TOKEN }, headers: SAME_ORIGIN }),
      ctx(),
    )
    expect(res.status).toBe(410)
    expect(await res.json()).toEqual({ error: 'expired' })
  })

  it('a malformed id or proof never reaches the registry', async () => {
    registry({})
    const badId = await postBind(
      request('/api/map-sessions/nope/bind', { body: { proof: PROOF, counts: COUNTS }, cookies: { [MAP_TOKEN_COOKIE]: TOKEN }, headers: SAME_ORIGIN }),
      ctx('nope'),
    )
    expect(badId.status).toBe(404)
    const badProof = await postBind(
      request(`${PATH}/bind`, { body: { proof: 'short', counts: COUNTS }, cookies: { [MAP_TOKEN_COOKIE]: TOKEN }, headers: SAME_ORIGIN }),
      ctx(),
    )
    expect(badProof.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('GET /api/map-sessions/:id/binding', () => {
  it('reports a live binding from the cookie, with the counts, and mints the request token', async () => {
    const held = await bindCookie()
    registry({
      [`GET /api/v1/map-sessions/${ID}`]: () =>
        json({ id: ID, state: 'pending', label: 'test-machine', expires_at: nowSec() + 500 }),
    })
    const res = await getBinding(request(`${PATH}/binding`, { method: 'GET', cookies: { [MAP_BINDING_COOKIE]: held } }), ctx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.bound).toBe(true)
    expect(body.counts).toEqual(COUNTS)
    expect(body.session).toMatchObject({ state: 'pending', label: 'test-machine', approvedAt: null, codeDelivered: false })
    expect(JSON.stringify(body)).not.toContain(BINDING)

    const [[, init]] = calls(`GET /api/v1/map-sessions/${ID}`)
    expect(headerOf(init as RequestInit, 'x-skillet-map-binding')).toBe(BINDING)

    const minted = res.cookies.get(MAP_TOKEN_COOKIE)!
    expect(minted.value).toBe(body.token)
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{32,}$/)
    expect(minted.httpOnly).toBe(true)
    expect(minted.sameSite).toBe('strict')
    expect(minted.path).toBe(PATH)
    expect(res.headers.get('cache-control')).toContain('no-store')
  })

  it('keeps a request token it already issued', async () => {
    registry({ [`GET /api/v1/map-sessions/${ID}`]: () => json({ error: 'binding_required' }, 403) })
    const res = await getBinding(request(`${PATH}/binding`, { method: 'GET', cookies: { [MAP_TOKEN_COOKIE]: TOKEN } }), ctx())
    const body = await res.json()
    expect(body).toEqual({ token: TOKEN, bound: false, counts: null, session: null })
    expect(res.cookies.get(MAP_TOKEN_COOKIE)).toBeUndefined()
  })

  it('after approval, reads the session as the approving account', async () => {
    registry({
      [`GET /api/v1/map-sessions/${ID}`]: () =>
        json({
          id: ID,
          state: 'connected',
          label: 'test-machine',
          expires_at: nowSec() + 300,
          approved_at: nowSec() - 30,
          code_expires_at: nowSec() + 270,
          code_delivered: true,
          connected_at: nowSec() - 10,
          result: null,
          result_at: null,
        }),
    })
    const res = await getBinding(
      request(`${PATH}/binding`, { method: 'GET', cookies: { [MAP_TOKEN_COOKIE]: TOKEN, skillet_session: 'sess-1' } }),
      ctx(),
    )
    const body = await res.json()
    expect(body.bound).toBe(false)
    expect(body.session).toMatchObject({ state: 'connected', codeDelivered: true, label: 'test-machine' })
    const [[, init]] = calls(`GET /api/v1/map-sessions/${ID}`)
    expect(headerOf(init as RequestInit, 'authorization')).toBe('Bearer sess-1')
    expect(headerOf(init as RequestInit, 'x-skillet-map-binding')).toBeNull()
  })

  it('clears a binding the registry no longer accepts', async () => {
    const held = await bindCookie()
    registry({ [`GET /api/v1/map-sessions/${ID}`]: () => json({ error: 'binding_required' }, 403) })
    const res = await getBinding(
      request(`${PATH}/binding`, { method: 'GET', cookies: { [MAP_BINDING_COOKIE]: held, [MAP_TOKEN_COOKIE]: TOKEN } }),
      ctx(),
    )
    expect((await res.json()).bound).toBe(false)
    const cleared = res.cookies.get(MAP_BINDING_COOKIE)!
    expect(cleared.value).toBe('')
    expect(cleared.maxAge).toBe(0)
    expect(cleared.path).toBe(PATH)
  })

  it('a registry outage is a 502, and a malformed id a 404', async () => {
    fetchMock = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    vi.stubGlobal('fetch', fetchMock)
    const down = await getBinding(request(`${PATH}/binding`, { method: 'GET' }), ctx())
    expect(down.status).toBe(502)
    const missing = await getBinding(request('/api/map-sessions/x/binding', { method: 'GET' }), ctx('x'))
    expect(missing.status).toBe(404)
  })
})

describe('POST /api/map-sessions/:id/approve', () => {
  it('approves with the binding from the cookie and the signed-in session, then spends the cookie', async () => {
    const held = await bindCookie()
    registry({ [`POST /api/v1/map-sessions/${ID}/approve`]: () => json({ ok: true }) })
    const res = await postApprove(
      request(`${PATH}/approve`, {
        body: {},
        cookies: { [MAP_BINDING_COOKIE]: held, [MAP_TOKEN_COOKIE]: TOKEN, skillet_session: 'sess-1' },
        headers: SAME_ORIGIN,
      }),
      ctx(),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    const [[, init]] = calls(`POST /api/v1/map-sessions/${ID}/approve`)
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ binding: BINDING })
    expect(headerOf(init as RequestInit, 'authorization')).toBe('Bearer sess-1')
    const spent = res.cookies.get(MAP_BINDING_COOKIE)!
    expect(spent.maxAge).toBe(0)
    expect(spent.path).toBe(PATH)
  })

  it('refuses a cross-site approve before it reaches the registry', async () => {
    const held = await bindCookie()
    registry({})
    const refused: Record<string, string>[] = [
      { ...SAME_ORIGIN, 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' },
      { origin: 'https://evil.example', [MAP_TOKEN_HEADER]: TOKEN },
      { 'sec-fetch-site': 'same-origin', origin: SITE },
    ]
    for (const headers of refused) {
      const res = await postApprove(
        request(`${PATH}/approve`, {
          body: {},
          cookies: { [MAP_BINDING_COOKIE]: held, [MAP_TOKEN_COOKIE]: TOKEN, skillet_session: 'sess-1' },
          headers,
        }),
        ctx(),
      )
      expect(res.status, JSON.stringify(headers)).toBe(403)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('no username: a 409 that leaves the binding usable, and the retry after the username step approves', async () => {
    const held = await bindCookie()
    let answer = json({ error: 'username_required', message: 'Pick a username, then save.' }, 409)
    registry({ [`POST /api/v1/map-sessions/${ID}/approve`]: () => answer })
    const cookies = { [MAP_BINDING_COOKIE]: held, [MAP_TOKEN_COOKIE]: TOKEN, skillet_session: 'sess-1' }

    const first = await postApprove(request(`${PATH}/approve`, { body: {}, cookies, headers: SAME_ORIGIN }), ctx())
    expect(first.status).toBe(409)
    expect(await first.json()).toEqual({ error: 'username_required' })
    expect(first.cookies.get(MAP_BINDING_COOKIE)).toBeUndefined()

    answer = json({ ok: true })
    const second = await postApprove(request(`${PATH}/approve`, { body: {}, cookies, headers: SAME_ORIGIN }), ctx())
    expect(second.status).toBe(200)
    expect(second.cookies.get(MAP_BINDING_COOKIE)?.maxAge).toBe(0)
  })

  it('without the binding cookie, nothing is approved', async () => {
    registry({})
    const res = await postApprove(
      request(`${PATH}/approve`, { body: { binding: BINDING }, cookies: { [MAP_TOKEN_COOKIE]: TOKEN, skillet_session: 'sess-1' }, headers: SAME_ORIGIN }),
      ctx(),
    )
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'binding_required' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a lapsed registry session heals once from the web session, then approves', async () => {
    const held = await bindCookie()
    let call = 0
    registry({
      [`POST /api/v1/map-sessions/${ID}/approve`]: () => (++call === 1 ? json({ error: 'auth_required' }, 401) : json({ ok: true })),
    })
    webSessionIdentityMock.mockResolvedValue({ provider: 'google', providerSubjectId: 'sub-1', expectedUserId: 'user-1' })
    refreshRegistryWebSessionMock.mockResolvedValue({ session_token: 'sess-fresh' })
    const res = await postApprove(
      request(`${PATH}/approve`, {
        body: {},
        cookies: { [MAP_BINDING_COOKIE]: held, [MAP_TOKEN_COOKIE]: TOKEN, skillet_session: 'sess-old' },
        headers: SAME_ORIGIN,
      }),
      ctx(),
    )
    expect(res.status).toBe(200)
    const approves = calls(`POST /api/v1/map-sessions/${ID}/approve`)
    expect(approves).toHaveLength(2)
    expect(headerOf(approves[1]![1] as RequestInit, 'authorization')).toBe('Bearer sess-fresh')
    expect(res.cookies.get('skillet_session')?.value).toBe('sess-fresh')
  })

  it('signed out: a 401, and the binding stays', async () => {
    const held = await bindCookie()
    registry({ [`POST /api/v1/map-sessions/${ID}/approve`]: () => json({ error: 'auth_required' }, 401) })
    const res = await postApprove(
      request(`${PATH}/approve`, { body: {}, cookies: { [MAP_BINDING_COOKIE]: held, [MAP_TOKEN_COOKIE]: TOKEN }, headers: SAME_ORIGIN }),
      ctx(),
    )
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'sign_in_required' })
    expect(res.cookies.get(MAP_BINDING_COOKIE)).toBeUndefined()
  })

  it('an expired session says so and clears the binding', async () => {
    const held = await bindCookie()
    registry({ [`POST /api/v1/map-sessions/${ID}/approve`]: () => json({ error: 'map_session_expired' }, 410) })
    const res = await postApprove(
      request(`${PATH}/approve`, {
        body: {},
        cookies: { [MAP_BINDING_COOKIE]: held, [MAP_TOKEN_COOKIE]: TOKEN, skillet_session: 'sess-1' },
        headers: SAME_ORIGIN,
      }),
      ctx(),
    )
    expect(res.status).toBe(410)
    expect(await res.json()).toEqual({ error: 'expired' })
    expect(res.cookies.get(MAP_BINDING_COOKIE)?.maxAge).toBe(0)
  })
})
