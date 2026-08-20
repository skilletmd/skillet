// U4: connect pair codes against MySQL.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import {
  claim,
  freshMysqlServer,
  mint,
  type Handle,
} from './helpers.js'
import {
  createTestPrismaClient,
  mysqlTestsEnabled,
  resetMysqlRegistry,
} from './mysql-test-env.js'

const hasDatabaseUrl = mysqlTestsEnabled()

describe('connect-pair http mysql (U4)', { skip: !hasDatabaseUrl }, () => {
  let h: Handle

  before(async () => {
    h = await freshMysqlServer()
  })

  after(async () => {
    await h?.app.close()
  })

  it('mints a pair code and claims a session on MySQL', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)

      const session = await mint(h)
      await claim(h, session, 'pair-owner', 71)

      const codes = await h.app.inject({
        method: 'POST',
        url: '/api/v1/connect/codes',
        headers: { authorization: `Bearer ${session.session_token}` },
      })
      assert.equal(codes.statusCode, 201, codes.body)
      const { code } = codes.json() as { code: string }
      assert.equal(code.length, 8)

      const claimed = await h.app.inject({
        method: 'POST',
        url: '/api/v1/connect/claim',
        payload: { code, label: 'Test Machine', client_kind: 'cli' },
      })
      assert.equal(claimed.statusCode, 201, claimed.body)
      const body = claimed.json() as {
        session_token: string
        device_token: string | null
        handle: string | null
      }
      assert.ok(body.session_token.startsWith('skillet_s_'))
      assert.ok(body.device_token?.startsWith('skillet_d_'))
      assert.equal(body.handle, 'pair-owner')
    } finally {
      await prisma.$disconnect()
    }
  })

  // #464 R4: a logged-out (soft-revoked) machine recovers by re-pairing — the
  // same machine_id reclaims the same device row, clearing the revoke.
  it('re-pairing the same machine reclaims a revoked device', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)
      const session = await mint(h)
      await claim(h, session, 'reclaim-owner', 72)

      const pairOnce = async (): Promise<{ device_token: string; device_id: string }> => {
        const codes = await h.app.inject({
          method: 'POST',
          url: '/api/v1/connect/codes',
          headers: { authorization: `Bearer ${session.session_token}` },
        })
        const { code } = codes.json() as { code: string }
        const claimed = await h.app.inject({
          method: 'POST',
          url: '/api/v1/connect/claim',
          payload: { code, label: 'M', client_kind: 'cli', machine_id: 'machine-xyz' },
        })
        assert.equal(claimed.statusCode, 201, claimed.body)
        return claimed.json() as { device_token: string; device_id: string }
      }
      const whoami = (t: string) =>
        h.app.inject({ method: 'GET', url: '/api/v1/whoami', headers: { authorization: `Bearer ${t}` } })

      const first = await pairOnce()
      assert.equal((await whoami(first.device_token)).statusCode, 200, 'freshly paired device resolves')

      const revoke = await h.app.inject({
        method: 'POST',
        url: `/api/v1/devices/${first.device_id}/revoke`,
        headers: { authorization: `Bearer ${first.device_token}` },
      })
      assert.equal(revoke.statusCode, 204, revoke.body)
      assert.equal((await whoami(first.device_token)).statusCode, 401, 'revoked device token is dead')

      // Age the revoked row past the stale-sibling window (48h) so re-pair
      // reclaims it in place — the case a real machine hits when it returns after
      // time away. Reclaim must clear the revoke and refresh the expiry (#464).
      await prisma.devices.update({
        where: { id: first.device_id },
        data: { last_seen_at: Math.floor(Date.now() / 1000) - 3 * 24 * 60 * 60 },
      })

      const second = await pairOnce()
      assert.equal(second.device_id, first.device_id, 'same machine_id reclaims the same device row')
      assert.equal((await whoami(second.device_token)).statusCode, 200, 'reclaimed device syncs again')
      const row = await prisma.devices.findUnique({
        where: { id: first.device_id },
        select: { revoked_at: true },
      })
      assert.equal(row?.revoked_at, null, 're-pair clears revoked_at')
    } finally {
      await prisma.$disconnect()
    }
  })
})
