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
import { clearCatalogListMemo } from '../src/lib/catalog-list-memo.js'

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
      // Anonymous search answers are memoized by query, so a case reusing an
      // earlier case's query would assert against the earlier fixture.
      clearCatalogListMemo()
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
      // Anonymous search answers are memoized by query, so a case reusing an
      // earlier case's query would assert against the earlier fixture.
      clearCatalogListMemo()
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

  // Slugs are hyphenated, so whole-string matching answered `web design` with
  // nothing while the same page's docs group returned nine results.
  it('finds a hyphenated slug from a multi-word query', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)
      // Anonymous search answers are memoized by query, so a case reusing an
      // earlier case's query would assert against the earlier fixture.
      clearCatalogListMemo()
      await addSkillVersionPrisma(prisma, 'vercel', 'web-design-guidelines', 'sha256:search-md-1', 1_700_000_000)

      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/search?q=web%20design&types=skills',
      })
      assert.equal(res.statusCode, 200, res.body)
      const body = res.json() as { groups: { skills: Array<{ slug: string }> } }
      assert.equal(body.groups.skills.length, 1)
      assert.equal(body.groups.skills[0]?.slug, 'web-design-guidelines')
    } finally {
      await prisma.$disconnect()
    }
  })

  it('ranks a full-phrase match above a partial one', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)
      // Anonymous search answers are memoized by query, so a case reusing an
      // earlier case's query would assert against the earlier fixture.
      clearCatalogListMemo()
      await addSkillVersionPrisma(prisma, 'vercel', 'web-design-guidelines', 'sha256:search-md-2', 1_700_000_000)
      await addSkillVersionPrisma(prisma, 'wshobson', 'web-component-design', 'sha256:search-md-3', 1_700_000_001)

      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/search?q=web%20design&types=skills',
      })
      assert.equal(res.statusCode, 200, res.body)
      const body = res.json() as { groups: { skills: Array<{ slug: string; score: number }> } }
      assert.equal(body.groups.skills.length, 2)
      assert.equal(body.groups.skills[0]?.slug, 'web-design-guidelines')
      assert.ok((body.groups.skills[0]?.score ?? 0) > (body.groups.skills[1]?.score ?? 0))
    } finally {
      await prisma.$disconnect()
    }
  })

  it('still answers empty when nothing matches any word', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)
      // Anonymous search answers are memoized by query, so a case reusing an
      // earlier case's query would assert against the earlier fixture.
      clearCatalogListMemo()
      await addSkillVersionPrisma(prisma, 'alice', 'lint-tool', 'sha256:search-md-4', 1_700_000_000)

      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/search?q=zzzznothing%20yyyynothing&types=skills',
      })
      assert.equal(res.statusCode, 200, res.body)
      const body = res.json() as { groups: { skills: unknown[] } }
      assert.deepEqual(body.groups.skills, [])
    } finally {
      await prisma.$disconnect()
    }
  })
})
