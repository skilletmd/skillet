// U4: GET /api/v1/search against MySQL via Prisma.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import {
  addSkillVersionPrisma,
  authOf,
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

const hasMysql = mysqlTestsEnabled()

describe('search mysql (U4)', { skip: !hasMysql }, () => {
  let h: Handle

  before(async () => {
    h = await freshMysqlServer()
  })

  after(async () => {
    await h?.app.close()
  })

  it('finds a public skill by slug substring', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)
      await addSkillVersionPrisma(prisma, 'alice', 'lint-tool', 'sha256:search-1', 1_700_000_000)

      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/search?q=lint&types=skills',
      })
      assert.equal(res.statusCode, 200, res.body)
      assert.match(String(res.headers['cache-control'] ?? ''), /public.*max-age=60/)
      const body = res.json() as {
        groups: { skills: Array<{ type: string; slug: string; author: string }> }
      }
      assert.equal(body.groups.skills.length, 1)
      assert.equal(body.groups.skills[0]?.slug, 'lint-tool')
      assert.equal(body.groups.skills[0]?.author, 'alice')
    } finally {
      await prisma.$disconnect()
    }
  })

  it('authenticated search is private no-store', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)
      await addSkillVersionPrisma(prisma, 'alice', 'lint-tool', 'sha256:search-auth-1', 1_700_000_000)
      const session = await mint(h)
      await claim(h, session, 'searcher', 88)

      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/search?q=lint&types=skills',
        headers: authOf(session),
      })
      assert.equal(res.statusCode, 200, res.body)
      assert.match(String(res.headers['cache-control'] ?? ''), /private.*no-store/)
    } finally {
      await prisma.$disconnect()
    }
  })
})
