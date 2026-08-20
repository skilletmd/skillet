// U4: GET /api/v1/stats against MySQL via Prisma.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { addSkillVersionPrisma, freshMysqlServer, type Handle } from './helpers.js'
import {
  createTestPrismaClient,
  mysqlTestsEnabled,
  resetMysqlRegistry,
} from './mysql-test-env.js'

const hasMysql = mysqlTestsEnabled()

describe('stats mysql (U4)', { skip: !hasMysql }, () => {
  let h: Handle

  before(async () => {
    h = await freshMysqlServer()
  })

  after(async () => {
    await h?.app.close()
  })

  it('returns totals including a seeded public skill', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)
      await addSkillVersionPrisma(prisma, 'alice', 'tool', 'sha256:stats-1', 1_700_000_000)

      const res = await h.app.inject({ method: 'GET', url: '/api/v1/stats' })
      assert.equal(res.statusCode, 200, res.body)
      const body = res.json() as {
        totals: { skills: number; networkSkills: number; kits: number }
        months: string[]
        series: { skills: number[] }
      }
      assert.equal(body.totals.skills, 1)
      assert.equal(body.totals.networkSkills, 1)
      assert.ok(Array.isArray(body.months))
      assert.ok(Array.isArray(body.series.skills))
    } finally {
      await prisma.$disconnect()
    }
  })
})
