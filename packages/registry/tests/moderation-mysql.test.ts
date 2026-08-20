// U4: GET /api/v1/moderation against MySQL via Prisma.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { newId } from '../src/db/index.js'
import { addSkillVersionPrisma, freshMysqlServer, type Handle } from './helpers.js'
import {
  createTestPrismaClient,
  mysqlTestsEnabled,
  resetMysqlRegistry,
} from './mysql-test-env.js'

const hasMysql = mysqlTestsEnabled()

describe('moderation mysql (U4)', { skip: !hasMysql }, () => {
  let h: Handle

  before(async () => {
    h = await freshMysqlServer()
  })

  after(async () => {
    await h?.app.close()
  })

  it('lists currently enforced skills with public reason', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)
      await addSkillVersionPrisma(prisma, 'alice', 'bad', 'sha256:mod-1', 1_700_000_000)
      await prisma.skills.update({
        where: { id: 'alice:bad' },
        data: { moderation_status: 'quarantined' },
      })
      const adminId = newId()
      await prisma.users.create({
        data: { id: adminId, handle: 'mod-admin', is_admin: 1 },
      })
      await prisma.skill_moderation_actions.create({
        data: {
          id: newId(),
          skill_id: 'alice:bad',
          action: 'quarantine',
          public_reason: 'policy violation',
          acted_by: adminId,
          created_at: 1_700_000_100,
        },
      })

      const res = await h.app.inject({ method: 'GET', url: '/api/v1/moderation' })
      assert.equal(res.statusCode, 200, res.body)
      const body = res.json() as {
        total: number
        entries: Array<{ author: string; slug: string; status: string; public_reason: string | null }>
      }
      assert.equal(body.total, 1)
      assert.equal(body.entries.length, 1)
      assert.equal(body.entries[0]?.author, 'alice')
      assert.equal(body.entries[0]?.slug, 'bad')
      assert.equal(body.entries[0]?.status, 'quarantined')
      assert.equal(body.entries[0]?.public_reason, 'policy violation')
    } finally {
      await prisma.$disconnect()
    }
  })

  it('excludes private skills from the public moderation log (#466)', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)

      // Public skill under moderation — must appear (transparency preserved).
      await addSkillVersionPrisma(prisma, 'alice', 'pub', 'sha256:pub-1', 1_700_000_000)
      await prisma.skills.update({
        where: { id: 'alice:pub' },
        data: { moderation_status: 'quarantined' },
      })
      // Private skill under moderation — must NOT appear or be counted.
      await addSkillVersionPrisma(prisma, 'alice', 'sec', 'sha256:sec-1', 1_700_000_001)
      await prisma.skills.update({
        where: { id: 'alice:sec' },
        data: { moderation_status: 'quarantined', visibility: 'private' },
      })

      const adminId = newId()
      await prisma.users.create({ data: { id: adminId, handle: 'mod-admin', is_admin: 1 } })
      for (const [skillId, at] of [
        ['alice:pub', 1_700_000_100],
        ['alice:sec', 1_700_000_101],
      ] as const) {
        await prisma.skill_moderation_actions.create({
          data: {
            id: newId(),
            skill_id: skillId,
            action: 'quarantine',
            public_reason: 'policy violation',
            acted_by: adminId,
            created_at: at,
          },
        })
      }

      const res = await h.app.inject({ method: 'GET', url: '/api/v1/moderation' })
      assert.equal(res.statusCode, 200, res.body)
      const body = res.json() as {
        total: number
        entries: Array<{ author: string; slug: string }>
      }
      assert.equal(body.total, 1, 'private under-moderation skill must not inflate total')
      assert.equal(body.entries.length, 1)
      assert.equal(body.entries[0]?.slug, 'pub')
      assert.ok(
        !body.entries.some((e) => e.slug === 'sec'),
        'private skill must be absent from the public moderation log',
      )
    } finally {
      await prisma.$disconnect()
    }
  })
})
