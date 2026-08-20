import { describe, it, expect } from 'vitest'
import {
  checkClaimEligibility,
  type ClaimSource,
  type EligibilityResult,
} from '@/lib/github-claim-eligibility'

const REPO_RE = /\/repos\/([^/]+)\/([^/]+)$/
const MEMBERSHIP_RE = /\/user\/memberships\/orgs\/([^/]+)$/
const USER_RE = /\/user$/

interface RepoFixture {
  ownerLogin?: string
  ownerId?: number
  ownerType?: 'Organization' | 'User'
  permissions?: Record<string, boolean>
  /** Omit the owner entirely (malformed body). */
  noOwner?: boolean
}

interface MembershipFixture {
  status?: number
  state?: string
  role?: string
  rateHeaders?: boolean
}

interface UserFixture {
  /** Authenticated claimant's own numeric id (GET /user). */
  id?: number
  status?: number
}

interface FetchScenario {
  /** Repo response. `'throw'` simulates a network failure; a number is a bare status. */
  repo: RepoFixture | number | 'throw' | { status: number; rateHeaders?: boolean }
  membership?: MembershipFixture | 'throw'
  /** GET /user (claimant identity) — only consulted on a User-source admin path. */
  user?: UserFixture | number | 'throw'
}

function jsonResponse(status: number, body: unknown, rateHeaders = false): Response {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (rateHeaders) {
    headers['x-ratelimit-remaining'] = '0'
    headers['x-ratelimit-reset'] = String(Math.floor(Date.now() / 1000) + 60)
  }
  return new Response(JSON.stringify(body), { status, headers })
}

function makeFetch(scenario: FetchScenario): typeof fetch {
  const fn = async (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString()

    if (REPO_RE.test(url)) {
      const r = scenario.repo
      if (r === 'throw') throw new Error('network down')
      if (typeof r === 'number') return jsonResponse(r, { message: 'err' })
      if ('status' in r && r.status != null && !('ownerType' in r)) {
        return jsonResponse(r.status, { message: 'err' }, Boolean((r as { rateHeaders?: boolean }).rateHeaders))
      }
      const f = r as RepoFixture
      if (f.noOwner) return jsonResponse(200, { permissions: f.permissions ?? {} })
      return jsonResponse(200, {
        owner: { login: f.ownerLogin, id: f.ownerId, type: f.ownerType },
        permissions: f.permissions,
      })
    }

    if (MEMBERSHIP_RE.test(url)) {
      const m = scenario.membership
      if (m == null) throw new Error('unexpected membership call')
      if (m === 'throw') throw new Error('network down')
      const status = m.status ?? 200
      if (status !== 200) return jsonResponse(status, { message: 'err' }, Boolean(m.rateHeaders))
      return jsonResponse(200, { state: m.state, role: m.role })
    }

    if (USER_RE.test(url)) {
      const u = scenario.user
      if (u == null) throw new Error('unexpected user call')
      if (u === 'throw') throw new Error('network down')
      if (typeof u === 'number') return jsonResponse(u, { message: 'err' })
      const status = u.status ?? 200
      if (status !== 200) return jsonResponse(status, { message: 'err' })
      return jsonResponse(200, { id: u.id })
    }

    throw new Error(`unexpected url ${url}`)
  }
  return fn as unknown as typeof fetch
}

const ORG_SOURCE: ClaimSource = { owner: 'vercel', repo: 'skills' }
const USER_SOURCE: ClaimSource = { owner: 'maya', repo: 'skills' }

function run(
  scenario: FetchScenario,
  overrides: Partial<{
    source: ClaimSource
    expectedHandle: string
    expectedOwnerId: number | null
  }> = {},
): Promise<EligibilityResult> {
  return checkClaimEligibility({
    token: 'gho_test',
    source: overrides.source ?? ORG_SOURCE,
    expectedHandle: overrides.expectedHandle ?? 'vercel',
    expectedOwnerId: 'expectedOwnerId' in overrides ? (overrides.expectedOwnerId as number | null) : 1001,
    fetchImpl: makeFetch(scenario),
  })
}

describe('checkClaimEligibility', () => {
  it('AE1: repo admin on an org repo with org owner membership -> ELIGIBLE, ownerType Organization, endState org', async () => {
    const res = await run({
      repo: { ownerLogin: 'vercel', ownerId: 1001, ownerType: 'Organization', permissions: { admin: true, pull: true } },
      membership: { status: 200, state: 'active', role: 'admin' },
    })
    expect(res).toEqual({
      classification: 'ELIGIBLE',
      login: 'vercel',
      id: 1001,
      ownerType: 'Organization',
      endState: 'org',
    })
  })

  it('AE1: org owner (membership active+admin) -> ELIGIBLE', async () => {
    const res = await run({
      repo: { ownerLogin: 'vercel', ownerId: 1001, ownerType: 'Organization', permissions: { admin: false, pull: true } },
      membership: { status: 200, state: 'active', role: 'admin' },
    })
    expect(res.classification).toBe('ELIGIBLE')
    expect(res.endState).toBe('org')
  })

  it('AE2: PR-only contributor (admin=false, real perms, membership 404) -> NOT_ELIGIBLE', async () => {
    const res = await run({
      repo: { ownerLogin: 'vercel', ownerId: 1001, ownerType: 'Organization', permissions: { admin: false, push: false, pull: true } },
      membership: { status: 404 },
    })
    expect(res.classification).toBe('NOT_ELIGIBLE')
  })

  it('AE4: personal repo, owner.type=User, login matches, admin=true, authed id == owner.id -> ELIGIBLE, endState user', async () => {
    const res = await run(
      {
        repo: { ownerLogin: 'maya', ownerId: 2002, ownerType: 'User', permissions: { admin: true, pull: true } },
        user: { id: 2002 },
      },
      { source: USER_SOURCE, expectedHandle: 'maya', expectedOwnerId: 2002 },
    )
    expect(res).toEqual({
      classification: 'ELIGIBLE',
      login: 'maya',
      id: 2002,
      ownerType: 'User',
      endState: 'user',
    })
  })

  it('R16: personal repo, admin=true but authed id != owner.id (admin collaborator) -> NOT_ELIGIBLE', async () => {
    const res = await run(
      {
        repo: { ownerLogin: 'maya', ownerId: 2002, ownerType: 'User', permissions: { admin: true, pull: true } },
        user: { id: 5005 }, // a collaborator with repo-admin, NOT maya herself
      },
      { source: USER_SOURCE, expectedHandle: 'maya', expectedOwnerId: 2002 },
    )
    expect(res.classification).toBe('NOT_ELIGIBLE')
    expect(res.id).toBe(2002)
  })

  it('R16: personal repo, admin=true but GET /user fails -> INDETERMINATE (fail closed, no false grant)', async () => {
    const res = await run(
      {
        repo: { ownerLogin: 'maya', ownerId: 2002, ownerType: 'User', permissions: { admin: true, pull: true } },
        user: 'throw',
      },
      { source: USER_SOURCE, expectedHandle: 'maya', expectedOwnerId: 2002 },
    )
    expect(res.classification).toBe('INDETERMINATE')
  })

  it('membership state: pending -> NOT_ELIGIBLE', async () => {
    const res = await run({
      repo: { ownerLogin: 'vercel', ownerId: 1001, ownerType: 'Organization', permissions: { admin: false, pull: true } },
      membership: { status: 200, state: 'pending', role: 'admin' },
    })
    expect(res.classification).toBe('NOT_ELIGIBLE')
  })

  it('maintain true but admin false -> NOT_ELIGIBLE (KTD4 floor)', async () => {
    const res = await run({
      repo: { ownerLogin: 'vercel', ownerId: 1001, ownerType: 'Organization', permissions: { admin: false, maintain: true, push: true, pull: true } },
      membership: { status: 200, state: 'active', role: 'member' },
    })
    expect(res.classification).toBe('NOT_ELIGIBLE')
  })

  it('org-owned repo with absent permissions -> INDETERMINATE', async () => {
    const res = await run({
      repo: { ownerLogin: 'vercel', ownerId: 1001, ownerType: 'Organization', permissions: undefined },
    })
    expect(res.classification).toBe('INDETERMINATE')
    expect(res.ownerType).toBe('Organization')
  })

  it('org-owned repo with zeroed permissions -> INDETERMINATE', async () => {
    const res = await run({
      repo: { ownerLogin: 'vercel', ownerId: 1001, ownerType: 'Organization', permissions: { admin: false, maintain: false, push: false, triage: false, pull: false } },
    })
    expect(res.classification).toBe('INDETERMINATE')
  })

  it('org membership 404 while repo succeeded (OAuth-unapproved zeroed perms) -> INDETERMINATE', async () => {
    const res = await run({
      repo: { ownerLogin: 'vercel', ownerId: 1001, ownerType: 'Organization', permissions: {} },
      membership: { status: 404 },
    })
    expect(res.classification).toBe('INDETERMINATE')
  })

  it('repo 5xx -> INDETERMINATE', async () => {
    const res = await run({ repo: 500 })
    expect(res.classification).toBe('INDETERMINATE')
    expect(res.login).toBeNull()
  })

  it('repo network throw -> INDETERMINATE', async () => {
    const res = await run({ repo: 'throw' })
    expect(res.classification).toBe('INDETERMINATE')
    expect(res.login).toBeNull()
  })

  it('repo 429-with-rate-headers -> INDETERMINATE', async () => {
    const res = await run({ repo: { status: 429, rateHeaders: true } })
    expect(res.classification).toBe('INDETERMINATE')
  })

  it('repo 403-with-rate-headers (throttle) -> INDETERMINATE', async () => {
    const res = await run({ repo: { status: 403, rateHeaders: true } })
    expect(res.classification).toBe('INDETERMINATE')
  })

  it('membership 5xx (with real repo perms) -> INDETERMINATE', async () => {
    const res = await run({
      repo: { ownerLogin: 'vercel', ownerId: 1001, ownerType: 'Organization', permissions: { admin: false, pull: true } },
      membership: { status: 500 },
    })
    expect(res.classification).toBe('INDETERMINATE')
  })

  it('membership network throw (with real repo perms) -> INDETERMINATE', async () => {
    const res = await run({
      repo: { ownerLogin: 'vercel', ownerId: 1001, ownerType: 'Organization', permissions: { admin: false, pull: true } },
      membership: 'throw',
    })
    expect(res.classification).toBe('INDETERMINATE')
  })

  it('R16: org repo admin collaborator without org owner membership -> NOT_ELIGIBLE', async () => {
    const res = await run({
      repo: { ownerLogin: 'vercel', ownerId: 1001, ownerType: 'Organization', permissions: { admin: true, pull: true } },
      membership: { status: 404 },
    })
    expect(res.classification).toBe('NOT_ELIGIBLE')
  })

  it('org repo admin with member (non-owner) role -> NOT_ELIGIBLE', async () => {
    const res = await run({
      repo: { ownerLogin: 'vercel', ownerId: 1001, ownerType: 'Organization', permissions: { admin: true, pull: true } },
      membership: { status: 200, state: 'active', role: 'member' },
    })
    expect(res.classification).toBe('NOT_ELIGIBLE')
  })

  it('R16: current owner.login != stored handle (transfer) -> INDETERMINATE, never ELIGIBLE', async () => {
    const res = await run(
      { repo: { ownerLogin: 'attacker-org', ownerId: 9999, ownerType: 'Organization', permissions: { admin: true, pull: true } } },
      { expectedHandle: 'vercel', expectedOwnerId: 1001 },
    )
    expect(res.classification).toBe('INDETERMINATE')
    expect(res.login).toBe('attacker-org')
  })

  it('R16: current owner.id != expected source_owner_id (login reused) -> INDETERMINATE, never ELIGIBLE', async () => {
    const res = await run(
      { repo: { ownerLogin: 'vercel', ownerId: 7777, ownerType: 'Organization', permissions: { admin: true, pull: true } } },
      { expectedHandle: 'vercel', expectedOwnerId: 1001 },
    )
    expect(res.classification).toBe('INDETERMINATE')
    expect(res.id).toBe(7777)
  })

  it('expectedOwnerId null (uncaptured) + login matches + org owner membership -> ELIGIBLE', async () => {
    const res = await run(
      {
        repo: { ownerLogin: 'vercel', ownerId: 7777, ownerType: 'Organization', permissions: { admin: true, pull: true } },
        membership: { status: 200, state: 'active', role: 'admin' },
      },
      { expectedHandle: 'vercel', expectedOwnerId: null },
    )
    expect(res.classification).toBe('ELIGIBLE')
  })

  it('expectedOwnerId null but login mismatches (transfer) -> still INDETERMINATE', async () => {
    const res = await run(
      { repo: { ownerLogin: 'evilcorp', ownerId: 7777, ownerType: 'Organization', permissions: { admin: true, pull: true } } },
      { expectedHandle: 'vercel', expectedOwnerId: null },
    )
    expect(res.classification).toBe('INDETERMINATE')
  })

  it('personal repo, admin=false with real perms -> NOT_ELIGIBLE', async () => {
    const res = await run(
      { repo: { ownerLogin: 'maya', ownerId: 2002, ownerType: 'User', permissions: { admin: false, pull: true } } },
      { source: USER_SOURCE, expectedHandle: 'maya', expectedOwnerId: 2002 },
    )
    expect(res.classification).toBe('NOT_ELIGIBLE')
  })

  it('malformed repo body (no owner) -> INDETERMINATE', async () => {
    const res = await run({ repo: { noOwner: true } })
    expect(res.classification).toBe('INDETERMINATE')
    expect(res.login).toBeNull()
  })
})
