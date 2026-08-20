// U4: email login-code send/verify against MySQL via Prisma.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { freshMysqlServer, type Handle } from './helpers.js'
import {
  createTestPrismaClient,
  mysqlTestsEnabled,
  resetMysqlRegistry,
} from './mysql-test-env.js'

const hasMysql = mysqlTestsEnabled()

describe('email login-code mysql (U4)', { skip: !hasMysql }, () => {
  let h: Handle

  before(async () => {
    h = await freshMysqlServer()
  })

  after(async () => {
    await h?.app.close()
  })

  it('sends and verifies a login code into a session', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)

      const send = await h.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login-code/send',
        payload: { email: 'coder@example.com' },
      })
      assert.equal(send.statusCode, 200, send.body)
      const sendBody = send.json() as { ok: boolean; dev_code?: string }
      assert.equal(sendBody.ok, true)
      assert.ok(sendBody.dev_code)

      const verify = await h.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login-code/verify',
        payload: { email: 'coder@example.com', code: sendBody.dev_code },
      })
      assert.equal(verify.statusCode, 200, verify.body)
      const verifyBody = verify.json() as {
        ok: boolean
        session_token: string
        expires_at: number
      }
      assert.equal(verifyBody.ok, true)
      assert.ok(verifyBody.session_token.startsWith('skillet_s_'))

      const identity = await prisma.user_identities.findFirst({
        where: { provider: 'email', provider_subject_id: 'coder@example.com' },
      })
      assert.ok(identity)
    } finally {
      await prisma.$disconnect()
    }
  })
})
