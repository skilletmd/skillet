// MySQL HTTP coverage for auth device CRUD + logout revocation under usePrismaAuth.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { freshMysqlServer, mint, type Handle } from './helpers.js'
import { createTestPrismaClient, mysqlTestsEnabled } from './mysql-test-env.js'
import { classifyToken } from '../src/auth/tokens.js'

const hasDatabaseUrl = mysqlTestsEnabled()

describe('auth devices + logout mysql http', { skip: !hasDatabaseUrl }, () => {
  let h: Handle

  before(async () => {
    h = await freshMysqlServer()
  })

  after(async () => {
    await h?.app.close()
  })

  it('mints a device into MySQL and lists it', async () => {
    const s = await mint(h)
    const mintRes = await h.app.inject({
      method: 'POST',
      url: '/api/v1/devices/token',
      payload: { label: 'mysql-laptop' },
      headers: { authorization: `Bearer ${s.session_token}` },
    })
    assert.equal(mintRes.statusCode, 201, mintRes.body)
    const minted = mintRes.json() as { device_id: string; device_token: string }
    assert.equal(classifyToken(minted.device_token), 'device')

    const list = await h.app.inject({
      method: 'GET',
      url: '/api/v1/devices',
      headers: { authorization: `Bearer ${s.session_token}` },
    })
    assert.equal(list.statusCode, 200, list.body)
    const body = list.json() as {
      devices: Array<{ device_id: string; label: string | null }>
    }
    assert.ok(
      body.devices.some((d) => d.device_id === minted.device_id && d.label === 'mysql-laptop'),
    )

    // Device whoami must resolve handle/avatar from MySQL (not the empty :memory: scaffold).
    const who = await h.app.inject({
      method: 'GET',
      url: '/api/v1/whoami',
      headers: { authorization: `Bearer ${minted.device_token}` },
    })
    assert.equal(who.statusCode, 200, who.body)
    const whoBody = who.json() as { token_class: string; user_id: string; device_id: string }
    assert.equal(whoBody.token_class, 'device')
    assert.equal(whoBody.user_id, s.user_id)
    assert.equal(whoBody.device_id, minted.device_id)
  })

  it('revokes the calling session on logout via MySQL', async () => {
    const s = await mint(h)
    const logout = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { authorization: `Bearer ${s.session_token}` },
    })
    assert.equal(logout.statusCode, 204, logout.body)

    const who = await h.app.inject({
      method: 'GET',
      url: '/api/v1/whoami',
      headers: { authorization: `Bearer ${s.session_token}` },
    })
    assert.equal(who.statusCode, 401, who.body)
  })

  // ── #464: device tokens gain revocation + sliding idle expiry ──────────────

  async function mintDevice(sessionToken: string): Promise<{ device_id: string; device_token: string }> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/devices/token',
      payload: { label: 'test-device' },
      headers: { authorization: `Bearer ${sessionToken}` },
    })
    assert.equal(res.statusCode, 201, res.body)
    return res.json() as { device_id: string; device_token: string }
  }

  const whoami = (token: string) =>
    h.app.inject({ method: 'GET', url: '/api/v1/whoami', headers: { authorization: `Bearer ${token}` } })

  it('rejects a revoked device token on the next request (R1)', async () => {
    const s = await mint(h)
    const dev = await mintDevice(s.session_token)

    const pre = await whoami(dev.device_token)
    assert.equal(pre.statusCode, 200, `control: device resolves before revoke: ${pre.body}`)

    const revoke = await h.app.inject({
      method: 'POST',
      url: `/api/v1/devices/${dev.device_id}/revoke`,
      headers: { authorization: `Bearer ${dev.device_token}` },
    })
    assert.equal(revoke.statusCode, 204, revoke.body)

    const post = await whoami(dev.device_token)
    assert.equal(post.statusCode, 401, `revoked device token must 401: ${post.body}`)
  })

  it('rejects an idle-expired device token (R2)', async () => {
    const s = await mint(h)
    const dev = await mintDevice(s.session_token)
    const prisma = createTestPrismaClient()
    try {
      await prisma.devices.update({ where: { id: dev.device_id }, data: { expires_at: 100 } })
      const expired = await whoami(dev.device_token)
      assert.equal(expired.statusCode, 401, `idle-expired device token must 401: ${expired.body}`)
    } finally {
      await prisma.$disconnect()
    }
  })

  it('slides the expiry deadline forward on active use (R2)', async () => {
    const s = await mint(h)
    const dev = await mintDevice(s.session_token)
    const prisma = createTestPrismaClient()
    try {
      // A soon-to-expire deadline; an active request must push it to ~now + 90d.
      await prisma.devices.update({
        where: { id: dev.device_id },
        data: { expires_at: Math.floor(Date.now() / 1000) + 30 },
      })
      const who = await whoami(dev.device_token)
      assert.equal(who.statusCode, 200, who.body)
      const row = await prisma.devices.findUnique({
        where: { id: dev.device_id },
        select: { expires_at: true },
      })
      const now = Math.floor(Date.now() / 1000)
      assert.ok(
        row?.expires_at != null && row.expires_at > now + 7_000_000,
        `expires_at should slide to ~now+90d, got ${row?.expires_at} (now ${now})`,
      )
    } finally {
      await prisma.$disconnect()
    }
  })

  it('revoke of a device the caller does not own returns 404, victim unaffected (R5)', async () => {
    const owner = await mint(h)
    const dev = await mintDevice(owner.session_token)
    const other = await mint(h)

    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/devices/${dev.device_id}/revoke`,
      headers: { authorization: `Bearer ${other.session_token}` },
    })
    assert.equal(res.statusCode, 404, `foreign revoke must 404 (no existence leak): ${res.body}`)

    const who = await whoami(dev.device_token)
    assert.equal(who.statusCode, 200, `victim device token still resolves: ${who.body}`)
  })
})
