// U2/U5: end-to-end session mint against MySQL when usePrismaAuth is on.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { freshMysqlServer, mint, type Handle } from './helpers.js'
import { mysqlTestsEnabled } from './mysql-test-env.js'

const hasDatabaseUrl = mysqlTestsEnabled()

describe('auth session mysql http (U2)', { skip: !hasDatabaseUrl }, () => {
  let h: Handle

  before(async () => {
    h = await freshMysqlServer()
  })

  after(async () => {
    await h?.app.close()
  })

  it('POST /api/v1/sessions/dev mints a session that whoami resolves via Prisma', async () => {
    const s = await mint(h)
    assert.ok(s.user_id)
    assert.ok(s.session_token)

    const who = await h.app.inject({
      method: 'GET',
      url: '/api/v1/whoami',
      headers: { authorization: `Bearer ${s.session_token}` },
    })
    assert.equal(who.statusCode, 200, who.body)
    const body = who.json() as {
      user_id: string
      token_class: string
      email: string | null
      linked_providers: string[]
    }
    assert.equal(body.user_id, s.user_id)
    assert.equal(body.token_class, 'session')
    assert.ok(body.email?.includes('@dev.local'))
    assert.ok(body.linked_providers.includes('google'))
  })
})
