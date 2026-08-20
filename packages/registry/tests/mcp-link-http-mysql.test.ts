// U4: MCP link enable/disable against MySQL via Prisma.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { authOf, claim, freshMysqlServer, mint, type Handle } from './helpers.js'
import {
  createTestPrismaClient,
  mysqlTestsEnabled,
  resetMysqlRegistry,
} from './mysql-test-env.js'

const hasMysql = mysqlTestsEnabled()

describe('mcp link mysql (U4)', { skip: !hasMysql }, () => {
  let h: Handle
  let prevKey: string | undefined

  before(async () => {
    prevKey = process.env.SKILLET_MCP_TOKEN_KEY
    process.env.SKILLET_MCP_TOKEN_KEY = 'test-mcp-mysql-key'
    h = await freshMysqlServer()
  })

  after(async () => {
    await h?.app.close()
    if (prevKey === undefined) delete process.env.SKILLET_MCP_TOKEN_KEY
    else process.env.SKILLET_MCP_TOKEN_KEY = prevKey
  })

  it('enables, reads, and disables an MCP link', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)

      const session = await mint(h)
      await claim(h, session, 'mcper', 0x31)

      const off = await h.app.inject({
        method: 'GET',
        url: '/api/v1/mcp/link',
        headers: authOf(session),
      })
      assert.equal(off.statusCode, 200, off.body)
      assert.equal((off.json() as { enabled: boolean }).enabled, false)

      const enable = await h.app.inject({
        method: 'POST',
        url: '/api/v1/mcp/link/enable',
        headers: authOf(session),
      })
      assert.equal(enable.statusCode, 201, enable.body)
      const enabledBody = enable.json() as {
        enabled: boolean
        token: string
        url: string
      }
      assert.equal(enabledBody.enabled, true)
      assert.ok(enabledBody.token.startsWith('skillet_m_'))
      assert.ok(enabledBody.url.includes('/api/v1/mcp/'))

      const link = await prisma.mcp_links.findFirst({
        where: { user_id: session.user_id, revoked_at: null },
      })
      assert.ok(link)

      const disable = await h.app.inject({
        method: 'POST',
        url: '/api/v1/mcp/link/disable',
        headers: authOf(session),
      })
      assert.equal(disable.statusCode, 200, disable.body)
      assert.equal((disable.json() as { enabled: boolean }).enabled, false)

      const revoked = await prisma.mcp_links.findFirst({
        where: { id: link!.id },
      })
      assert.notEqual(revoked?.revoked_at, null)
    } finally {
      await prisma.$disconnect()
    }
  })
})
