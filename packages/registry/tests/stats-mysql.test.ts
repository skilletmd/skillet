// U4: GET /api/v1/stats against MySQL via Prisma.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { addSkillVersionPrisma, freshMysqlServer, type Handle } from './helpers.js'
import { createTestPrismaClient, mysqlTestsEnabled, resetMysqlRegistry } from './mysql-test-env.js'

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
        totals: { skills: number; networkSkills: number; kits: number; saves: number }
        months: string[]
        series: { skills: number[]; saves: number[] }
        routes: { picks: number; summons: number; routed: number; routedSeries: number[] }
      }
      assert.equal(body.totals.skills, 1)
      assert.equal(body.totals.networkSkills, 1)
      assert.ok(Array.isArray(body.months))
      assert.ok(Array.isArray(body.series.skills))
      // The one public routing number: picks (events) plus summons (aggregate
      // counters), with a month series on the shared axis.
      assert.equal(body.routes.routed, body.routes.picks + body.routes.summons)
      assert.equal(body.routes.routedSeries.length, body.months.length)
      // Saves: the card's number is the last point of its own series, so the
      // two can never disagree.
      assert.equal(body.totals.saves, body.series.saves.at(-1) ?? 0)
      assert.equal(body.series.saves.length, body.months.length)
    } finally {
      await prisma.$disconnect()
    }
  })

  it('counts saves once per user per skill', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)
      await addSkillVersionPrisma(prisma, 'alice', 'one', 'sha256:save-1', 1_700_000_000)
      await addSkillVersionPrisma(prisma, 'alice', 'two', 'sha256:save-2', 1_700_000_000)
      await prisma.authors.createMany({
        data: [
          { id: 'bob', name: 'bob' },
          { id: 'mary', name: 'mary' },
        ],
        skipDuplicates: true,
      })
      const t0 = 1_700_100_000

      // Bob saves alice/one into two of his own kits: one person, one skill,
      // so one save.
      await prisma.kits.createMany({
        data: [
          { id: 'kit-bob-saved', owner_id: 'bob', name: 'Saved', visibility: 'private' },
          { id: 'kit-bob-picks', owner_id: 'bob', name: 'Picks', visibility: 'public' },
        ],
      })
      await prisma.kit_skills.createMany({
        data: [
          { kit_id: 'kit-bob-saved', skill_id: 'alice:one', added_at: t0 },
          { kit_id: 'kit-bob-picks', skill_id: 'alice:one', added_at: t0 + 5 },
        ],
      })

      // Mary saves the same skill: a second save.
      await prisma.kits.create({
        data: { id: 'kit-mary', owner_id: 'mary', name: 'Saved', visibility: 'private' },
      })
      await prisma.kit_skills.create({
        data: { kit_id: 'kit-mary', skill_id: 'alice:one', added_at: t0 },
      })

      // A repo-linked kit's membership is written by the mirror pipeline, not a
      // person, so it never counts.
      await prisma.authors.createMany({ data: [{ id: 'zed', name: 'zed' }], skipDuplicates: true })
      await prisma.kits.create({
        data: {
          id: 'kit-linked',
          owner_id: 'zed',
          name: 'From a repo',
          visibility: 'public',
          source_type: 'linked',
        },
      })
      await prisma.kit_skills.create({
        data: { kit_id: 'kit-linked', skill_id: 'alice:two', added_at: t0 },
      })

      const res = await h.app.inject({ method: 'GET', url: '/api/v1/stats' })
      assert.equal(res.statusCode, 200, res.body)
      const body = res.json() as { totals: { saves: number } }
      assert.equal(body.totals.saves, 2)
    } finally {
      await prisma.$disconnect()
    }
  })

  it('counts a kit subscription as the skills it held at subscribe time', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)
      await addSkillVersionPrisma(prisma, 'alice', 'one', 'sha256:sub-1', 1_700_000_000)
      await addSkillVersionPrisma(prisma, 'alice', 'two', 'sha256:sub-2', 1_700_000_000)
      await prisma.authors.createMany({ data: [{ id: 'bob', name: 'bob' }], skipDuplicates: true })
      const t0 = 1_700_100_000
      await prisma.kits.create({
        data: { id: 'kit-bob', owner_id: 'bob', name: 'Bobs picks', visibility: 'public' },
      })
      await prisma.kit_skills.createMany({
        data: [
          { kit_id: 'kit-bob', skill_id: 'alice:one', added_at: t0 },
          { kit_id: 'kit-bob', skill_id: 'alice:two', added_at: t0 + 10 },
        ],
      })

      // carol subscribes between the two memberships: she saved one skill, not
      // the kit's later size of two.
      await prisma.users.create({ data: { id: 'u-carol', handle: 'carol' } })
      await prisma.kit_subscriptions.create({
        data: {
          id: 'sub-carol',
          user_id: 'u-carol',
          kind: 'kit',
          kit_id: 'kit-bob',
          created_at: t0 + 5,
        },
      })

      const res = await h.app.inject({ method: 'GET', url: '/api/v1/stats' })
      assert.equal(res.statusCode, 200, res.body)
      const body = res.json() as { totals: { saves: number } }
      // bob curated 2 (he is not the author) + carol's subscription brought 1.
      assert.equal(body.totals.saves, 3)
    } finally {
      await prisma.$disconnect()
    }
  })
})
