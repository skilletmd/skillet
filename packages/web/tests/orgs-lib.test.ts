import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createOrgRequest,
  inviteMemberRequest,
  listMembersRequest,
  listMyInvitesRequest,
} from '@/lib/orgs'

const BASE = 'https://reg.example'
const TOKEN = 'skillet_s_secret'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => vi.restoreAllMocks())

describe('createOrgRequest', () => {
  it('maps 201 to ok with the org ref', async () => {
    const f = vi.fn().mockResolvedValue(json({ org_id: 'o1', slug: 'acme', name: 'Acme' }, 201))
    const r = await createOrgRequest(BASE, TOKEN, { slug: 'acme', name: 'Acme' }, f as never)
    expect(r).toEqual({ kind: 'ok', org: { id: 'o1', slug: 'acme', name: 'Acme' } })
    expect(f.mock.calls[0][0]).toBe(`${BASE}/api/v1/orgs`)
    const [, init] = f.mock.calls[0]
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`)
  })

  it('maps 409 to conflict (slug taken)', async () => {
    const f = vi.fn().mockResolvedValue(json({ error: 'slug_taken' }, 409))
    expect(await createOrgRequest(BASE, TOKEN, { slug: 'acme', name: 'Acme' }, f as never)).toEqual(
      {
        kind: 'conflict',
      },
    )
  })

  it('maps 400 to invalid with the registry code', async () => {
    const f = vi.fn().mockResolvedValue(json({ error: 'invalid_slug' }, 400))
    expect(await createOrgRequest(BASE, TOKEN, { slug: 'A', name: 'Acme' }, f as never)).toEqual({
      kind: 'invalid',
      code: 'invalid_slug',
    })
  })

  it('returns unauthorized without a token, never calling fetch', async () => {
    const f = vi.fn()
    expect(await createOrgRequest(BASE, '', { slug: 'acme', name: 'Acme' }, f as never)).toEqual({
      kind: 'unauthorized',
    })
    expect(f).not.toHaveBeenCalled()
  })

  it('maps a network throw to error', async () => {
    const f = vi.fn().mockRejectedValue(new Error('down'))
    expect(await createOrgRequest(BASE, TOKEN, { slug: 'acme', name: 'Acme' }, f as never)).toEqual(
      {
        kind: 'error',
      },
    )
  })
})

describe('inviteMemberRequest', () => {
  it('maps an immediate add (existing user)', async () => {
    const f = vi.fn().mockResolvedValue(json({ status: 'added', member_id: 'u2' }))
    const r = await inviteMemberRequest(
      BASE,
      TOKEN,
      'acme',
      { handle: 'taylor', role: 'member' },
      f as never,
    )
    expect(r).toEqual({ kind: 'added', memberId: 'u2' })
    expect(f.mock.calls[0][0]).toBe(`${BASE}/api/v1/orgs/acme/invites`)
  })

  it('maps a pending invite', async () => {
    const f = vi.fn().mockResolvedValue(json({ status: 'invited', invite_id: 'i1' }))
    const r = await inviteMemberRequest(
      BASE,
      TOKEN,
      'acme',
      { email: 'a@b.com', role: 'admin' },
      f as never,
    )
    expect(r).toEqual({ kind: 'invited', inviteId: 'i1' })
  })

  it('maps 403 to forbidden (not owner/admin)', async () => {
    const f = vi.fn().mockResolvedValue(json({ error: 'not_authorized' }, 403))
    expect(
      await inviteMemberRequest(BASE, TOKEN, 'acme', { handle: 'x', role: 'member' }, f as never),
    ).toEqual({ kind: 'forbidden' })
  })

  it('maps 409 to conflict with the code (already_member / already_invited)', async () => {
    const f = vi.fn().mockResolvedValue(json({ error: 'already_member' }, 409))
    expect(
      await inviteMemberRequest(BASE, TOKEN, 'acme', { handle: 'x', role: 'member' }, f as never),
    ).toEqual({ kind: 'conflict', code: 'already_member' })
  })

  it('maps 404 to not_found and 400 to invalid', async () => {
    const nf = vi.fn().mockResolvedValue(json({ error: 'org_not_found' }, 404))
    expect(
      await inviteMemberRequest(BASE, TOKEN, 'nope', { handle: 'x', role: 'member' }, nf as never),
    ).toEqual({ kind: 'not_found' })
    const bad = vi.fn().mockResolvedValue(json({ error: 'provide_handle_or_email' }, 400))
    expect(
      await inviteMemberRequest(BASE, TOKEN, 'acme', { role: 'member' }, bad as never),
    ).toEqual({ kind: 'invalid', code: 'provide_handle_or_email' })
  })
})

describe('listMembersRequest', () => {
  it('maps 200 to ok with the payload', async () => {
    const payload = {
      org: { id: 'o1', slug: 'acme', name: 'Acme' },
      members: [{ user_id: 'u1', handle: 'owner', role: 'owner', invited_at: 1, accepted_at: 2 }],
      pending: [{ invite_id: 'i1', handle: null, email: 'a@b.com', role: 'member', invited_at: 3 }],
    }
    const f = vi.fn().mockResolvedValue(json(payload))
    const r = await listMembersRequest(BASE, TOKEN, 'acme', f as never)
    expect(r).toEqual({ kind: 'ok', data: payload })
    expect(f.mock.calls[0][0]).toBe(`${BASE}/api/v1/orgs/acme/members`)
  })

  it('maps 403 to forbidden and 401 to unauthorized', async () => {
    const forbidden = vi.fn().mockResolvedValue(json({ error: 'not_authorized' }, 403))
    expect(await listMembersRequest(BASE, TOKEN, 'acme', forbidden as never)).toEqual({
      kind: 'forbidden',
    })
    const unauth = vi.fn().mockResolvedValue(json({ error: 'auth_required' }, 401))
    expect(await listMembersRequest(BASE, TOKEN, 'acme', unauth as never)).toEqual({
      kind: 'unauthorized',
    })
  })
})

describe('listMyInvitesRequest', () => {
  it('maps 200 to ok with the invites, hitting the reverse-lookup path', async () => {
    const invites = [
      {
        invite_id: 'i1',
        org_slug: 'acme',
        org_name: 'Acme',
        role: 'admin',
        invited_at: 5,
        invited_by_handle: 'owner',
      },
    ]
    const f = vi.fn().mockResolvedValue(json({ invites }))
    const r = await listMyInvitesRequest(BASE, TOKEN, f as never)
    expect(r).toEqual({ kind: 'ok', invites })
    expect(f.mock.calls[0][0]).toBe(`${BASE}/api/v1/orgs/invites`)
  })

  it('defaults a missing invites array to empty', async () => {
    const f = vi.fn().mockResolvedValue(json({}))
    expect(await listMyInvitesRequest(BASE, TOKEN, f as never)).toEqual({ kind: 'ok', invites: [] })
  })

  it('maps 401 to unauthorized and other errors to error', async () => {
    const unauth = vi.fn().mockResolvedValue(json({ error: 'auth_required' }, 401))
    expect(await listMyInvitesRequest(BASE, TOKEN, unauth as never)).toEqual({
      kind: 'unauthorized',
    })
    const err = vi.fn().mockResolvedValue(json({ error: 'boom' }, 500))
    expect(await listMyInvitesRequest(BASE, TOKEN, err as never)).toEqual({
      kind: 'error',
      status: 500,
    })
  })

  it('returns unauthorized without a token, never calling fetch', async () => {
    const f = vi.fn()
    expect(await listMyInvitesRequest(BASE, '', f as never)).toEqual({ kind: 'unauthorized' })
    expect(f).not.toHaveBeenCalled()
  })
})
