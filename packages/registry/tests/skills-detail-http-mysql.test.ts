// U4: GET skill detail + manifest against MySQL via freshMysqlServer.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { addSkillVersionPrisma, claim, freshMysqlServer, mint, type Handle } from './helpers.js'
import {
  createTestPrismaClient,
  mysqlTestsEnabled,
  resetMysqlRegistry,
} from './mysql-test-env.js'

const hasDatabaseUrl = mysqlTestsEnabled()

describe('skills detail http mysql (U4)', { skip: !hasDatabaseUrl }, () => {
  let h: Handle

  before(async () => {
    h = await freshMysqlServer()
  })

  after(async () => {
    await h?.app.close()
  })

  it('GET /skills/:author/:slug returns seeded public skill detail via Prisma', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)
      await addSkillVersionPrisma(
        prisma,
        'alice-detail',
        'demo',
        'sha256:detail-1',
        1_700_000_000,
      )

      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/skills/alice-detail/demo',
      })
      assert.equal(res.statusCode, 200, res.body)
      const body = res.json() as {
        author: string
        slug: string
        skill_id: string
        latest_hash: string | null
        versions: Array<{ hash: string }>
      }
      assert.equal(body.author, 'alice-detail')
      assert.equal(body.slug, 'demo')
      assert.equal(body.skill_id, 'alice-detail:demo')
      assert.equal(body.latest_hash, 'sha256:detail-1')
      assert.ok(body.versions.some((v) => v.hash === 'sha256:detail-1'))
    } finally {
      await prisma.$disconnect()
    }
  })

  it('surfaces the latest version token headline in skill detail', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)
      await addSkillVersionPrisma(prisma, 'alice-tok', 'demo', 'sha256:tok-1', 1_700_000_000)
      await prisma.skill_versions.update({
        where: { skill_id_hash: { skill_id: 'alice-tok:demo', hash: 'sha256:tok-1' } },
        data: { token_count: 1320, token_ambient: 84, token_method: 'gpt-tokenizer-o200k' },
      })

      const res = await h.app.inject({ method: 'GET', url: '/api/v1/skills/alice-tok/demo' })
      assert.equal(res.statusCode, 200, res.body)
      const body = res.json() as {
        token_count?: number
        token_ambient?: number
        token_method?: string
      }
      assert.equal(body.token_count, 1320)
      assert.equal(body.token_ambient, 84)
      assert.equal(body.token_method, 'gpt-tokenizer-o200k')
    } finally {
      await prisma.$disconnect()
    }
  })

  it('GET /skills/:author/:slug/manifest lists the version via Prisma', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)
      await addSkillVersionPrisma(
        prisma,
        'bob-manif',
        'tool',
        'sha256:manif-1',
        1_700_000_100,
      )

      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/skills/bob-manif/tool/manifest',
      })
      assert.equal(res.statusCode, 200, res.body)
      // Public manifest stays revalidate-only (unchanged by #468).
      assert.equal(res.headers['cache-control'], 'no-cache')
      const body = res.json() as {
        skill_id: string
        latest_hash: string | null
        versions: Array<{ hash: string }>
      }
      assert.equal(body.skill_id, 'bob-manif:tool')
      assert.equal(body.latest_hash, 'sha256:manif-1')
      assert.equal(body.versions.length, 1)
      assert.equal(body.versions[0]?.hash, 'sha256:manif-1')
    } finally {
      await prisma.$disconnect()
    }
  })

  // #468: a private manifest must be `private, no-store` (not bare `no-cache`,
  // which per RFC 7234 still lets a shared cache STORE the bytes).
  it('GET manifest for a private skill is `private, no-store`', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)
      const owner = await mint(h)
      await claim(h, owner, 'privowner', 61)
      await addSkillVersionPrisma(prisma, 'privowner', 'secret', 'sha256:priv-1', 1_700_000_200)
      await prisma.skills.update({
        where: { id: 'privowner:secret' },
        data: { visibility: 'private' },
      })

      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/skills/privowner/secret/manifest',
        headers: { authorization: `Bearer ${owner.session_token}` },
      })
      assert.equal(res.statusCode, 200, res.body)
      assert.equal(res.headers['cache-control'], 'private, no-store')
    } finally {
      await prisma.$disconnect()
    }
  })
})
