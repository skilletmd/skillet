// U4: skill install + dedupe + auto-follow against MySQL via freshMysqlServer.
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
  mysqlTestsEnabled,
  resetMysqlRegistry,
} from './mysql-test-env.js'

const hasDatabaseUrl = mysqlTestsEnabled()

describe('skill install http mysql (U4)', { skip: !hasDatabaseUrl }, () => {
  let h: Handle

  before(async () => {
    h = await freshMysqlServer()
  })

  after(async () => {
    await h?.app.close()
  })

  it('dedupes anonymous installs and bumps install_count once', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)
      await prisma.authors.create({ data: { id: 'alice-inst', name: 'Alice' } })
      await addSkillVersionPrisma(prisma, 'alice-inst', 'demo', 'hash-inst-1', 1_700_000_000)

      const url = '/api/v1/skills/alice-inst/demo/install'
      const first = await h.app.inject({
        method: 'POST',
        url,
        remoteAddress: '203.0.113.40',
      })
      assert.equal(first.statusCode, 200, first.body)
      assert.equal((first.json() as { recorded: boolean }).recorded, true)

      const second = await h.app.inject({
        method: 'POST',
        url,
        remoteAddress: '203.0.113.40',
      })
      assert.equal(second.statusCode, 200, second.body)
      assert.equal((second.json() as { recorded: boolean }).recorded, false)

      const skill = await prisma.skills.findUnique({
        where: { id: 'alice-inst:demo' },
        select: { install_count: true },
      })
      assert.equal(skill?.install_count, 1)
    } finally {
      await prisma.$disconnect()
    }
  })

  it('session install auto-follows the author on first record', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)
      await prisma.authors.create({ data: { id: 'carol-inst', name: 'Carol' } })
      await addSkillVersionPrisma(prisma, 'carol-inst', 'tool', 'hash-inst-2', 1_700_000_100)

      const bob = await mint(h)
      await claim(h, bob, 'bob-inst', 31)

      const first = await h.app.inject({
        method: 'POST',
        url: '/api/v1/skills/carol-inst/tool/install',
        headers: { authorization: `Bearer ${bob.session_token}` },
      })
      assert.equal(first.statusCode, 200, first.body)
      const body = first.json() as { recorded: boolean; followed: boolean }
      assert.equal(body.recorded, true)
      assert.equal(body.followed, true)

      const edge = await prisma.follows.findFirst({
        where: {
          follower_user_id: bob.user_id,
          subject_kind: 'author',
          subject_id: 'carol-inst',
        },
      })
      assert.ok(edge)

      const second = await h.app.inject({
        method: 'POST',
        url: '/api/v1/skills/carol-inst/tool/install',
        headers: { authorization: `Bearer ${bob.session_token}` },
      })
      assert.equal(second.statusCode, 200, second.body)
      const again = second.json() as { recorded: boolean; followed: boolean }
      assert.equal(again.recorded, false)
      assert.equal(again.followed, false)
    } finally {
      await prisma.$disconnect()
    }
  })
})
