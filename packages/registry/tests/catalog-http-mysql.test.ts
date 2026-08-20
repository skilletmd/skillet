// U4: GET /v1/skills + claim against MySQL via freshMysqlServer.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import {
  addSkillVersionPrisma,
  claim,
  freshMysqlServer,
  mint,
  type Handle,
} from './helpers.js'
import {
  createTestPrismaClient,
  resetMysqlRegistry,
  mysqlTestsEnabled
} from './mysql-test-env.js'

const hasDatabaseUrl = mysqlTestsEnabled()

describe('catalog http mysql (U4)', { skip: !hasDatabaseUrl }, () => {
  let h: Handle

  before(async () => {
    h = await freshMysqlServer()
  })

  after(async () => {
    await h?.app.close()
  })

  it('GET /v1/skills lists a seeded public skill via Prisma', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)
      await addSkillVersionPrisma(prisma, 'alice', 'tool', 'sha256:http-catalog-1', 1_700_000_000)

      const res = await h.app.inject({ method: 'GET', url: '/api/v1/skills' })
      assert.equal(res.statusCode, 200, res.body)
      assert.match(String(res.headers['cache-control'] ?? ''), /public.*max-age=60/)
      const body = res.json() as {
        total: number
        skills: Array<{ author: string; slug: string; skill_id: string }>
      }
      assert.equal(body.total, 1)
      assert.equal(body.skills.length, 1)
      assert.equal(body.skills[0]?.author, 'alice')
      assert.equal(body.skills[0]?.slug, 'tool')
      assert.equal(body.skills[0]?.skill_id, 'alice:tool')
    } finally {
      await prisma.$disconnect()
    }
  })

  it('mint + claim writes handle into MySQL', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)
      // Re-ready the server after truncate so cookies/state stay fine; sessions
      // are minted fresh below.
      const s = await mint(h)
      await claim(h, s, 'claimer', 7)

      const user = await prisma.users.findUnique({ where: { id: s.user_id } })
      assert.equal(user?.handle, 'claimer')
      const author = await prisma.authors.findUnique({ where: { id: 'claimer' } })
      assert.ok(author)
    } finally {
      await prisma.$disconnect()
    }
  })

  it('GET /discover/people returns 200 with seeded public author', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)
      await addSkillVersionPrisma(
        prisma,
        'dir-person',
        'tool',
        'sha256:dir-person-1',
        1_700_000_700,
      )
      await prisma.authors.createMany({
        data: [{ id: 'dir-person', name: 'Dir Person' }],
        skipDuplicates: true,
      })

      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/discover/people?limit=10',
      })
      assert.equal(res.statusCode, 200, res.body)
      assert.match(String(res.headers['cache-control'] ?? ''), /public.*max-age=60/)
      const body = res.json() as {
        people: Array<{ handle: string; public_skills: number }>
        total: number
      }
      assert.ok(body.people.some((p) => p.handle === 'dir-person' && p.public_skills >= 1))
      assert.ok(body.total >= 1)
    } finally {
      await prisma.$disconnect()
    }
  })

  it('GET /discover/feed returns 200 with seeded public skill', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)
      await addSkillVersionPrisma(
        prisma,
        'dir-feed',
        'tool',
        'sha256:dir-feed-1',
        1_700_000_800,
      )

      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/discover/feed?limit=10',
      })
      assert.equal(res.statusCode, 200, res.body)
      assert.match(String(res.headers['cache-control'] ?? ''), /public.*max-age=60/)
      const body = res.json() as {
        events: Array<{ kind: string; skill?: { author: string; slug: string } }>
        view: string
      }
      assert.equal(body.view, 'discover')
      assert.ok(
        body.events.some(
          (e) =>
            e.kind === 'skill' && e.skill?.author === 'dir-feed' && e.skill?.slug === 'tool',
        ),
      )
    } finally {
      await prisma.$disconnect()
    }
  })

  it('POST /skills session publish creates a private skill on MySQL', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)
      const session = await mint(h)
      await claim(h, session, 'pub-author', 55)

      const files = {
        'SKILL.md': {
          enc: 'utf8' as const,
          data: '---\nname: Just Skill\ndescription: A short description.\n---\n\nInstructions here.\n',
        },
      }
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/skills',
        headers: { authorization: `Bearer ${session.session_token}` },
        payload: {
          author: 'pub-author',
          slug: 'just-skill',
          files,
          publish_auth: 'session',
          visibility: 'private',
        },
      })
      assert.equal(res.statusCode, 201, res.body)
      const body = res.json() as { skill_id: string; hash: string }
      assert.equal(body.skill_id, 'pub-author:just-skill')
      assert.ok(body.hash.startsWith('sha256:'))

      const skill = await prisma.skills.findUnique({ where: { id: 'pub-author:just-skill' } })
      assert.equal(skill?.visibility, 'private')
      assert.equal(skill?.latest_hash, body.hash)
    } finally {
      await prisma.$disconnect()
    }
  })
})
