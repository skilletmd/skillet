// U5: public revoked device-key list must read MySQL when prisma is set.
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

describe('delegations revoked-keys mysql (U5)', { skip: !hasDatabaseUrl }, () => {
  let h: Handle

  before(async () => {
    h = await freshMysqlServer()
  })

  after(async () => {
    await h?.app.close()
  })

  it('GET /authors/:handle/revoked-device-keys returns revoked ids from MySQL', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)
      const session = await mint(h)
      await claim(h, session, 'revokeme', 77)
      const user = await prisma.users.findFirst({
        where: { handle: 'revokeme' },
        select: { id: true, author_key_id: true },
      })
      assert.ok(user)
      const liveKey = 'a'.repeat(64)
      const revokedKey = 'b'.repeat(64)
      await prisma.author_delegations.createMany({
        data: [
          {
            device_key_id: liveKey,
            user_id: user.id,
            author_key_id: user.author_key_id ?? 'primary',
            device_pub: 'pub-live',
            scopes: '["publish"]',
            cert_json: '{}',
            cert_sig_alg: 'ed25519',
            cert_sig_key_id: 'kid',
            cert_sig_b64: 'sig',
            issued_at: 1,
            expires_at: 2_000_000_000,
            revoked_at: null,
          },
          {
            device_key_id: revokedKey,
            user_id: user.id,
            author_key_id: user.author_key_id ?? 'primary',
            device_pub: 'pub-revoked',
            scopes: '["publish"]',
            cert_json: '{}',
            cert_sig_alg: 'ed25519',
            cert_sig_key_id: 'kid',
            cert_sig_b64: 'sig',
            issued_at: 1,
            expires_at: 2_000_000_000,
            revoked_at: 1_700_000_000,
            revocation_json: '{}',
          },
        ],
      })

      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/authors/revokeme/revoked-device-keys',
      })
      assert.equal(res.statusCode, 200, res.body)
      const body = res.json() as { device_key_ids: string[] }
      assert.deepEqual(body.device_key_ids, [revokedKey])

      const missing = await h.app.inject({
        method: 'GET',
        url: '/api/v1/authors/nobody/revoked-device-keys',
      })
      assert.equal(missing.statusCode, 200)
      assert.deepEqual((missing.json() as { device_key_ids: string[] }).device_key_ids, [])
    } finally {
      await prisma.$disconnect()
    }
  })
})
