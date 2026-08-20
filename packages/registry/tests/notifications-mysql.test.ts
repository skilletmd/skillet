// U4: GET /me/notifications against MySQL via Prisma.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { authOf, claim, freshMysqlServer, mint, type Handle } from './helpers.js'
import {
  createTestPrismaClient,
  mysqlTestsEnabled,
  resetMysqlRegistry,
} from './mysql-test-env.js'

const hasMysql = mysqlTestsEnabled()

describe('notifications mysql (U4)', { skip: !hasMysql }, () => {
  let h: Handle

  before(async () => {
    h = await freshMysqlServer()
  })

  after(async () => {
    await h?.app.close()
  })

  it('lists followed-you events for the viewer via Prisma', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)

      const alice = await mint(h)
      await claim(h, alice, 'alice', 0x01)
      const bob = await mint(h)
      await claim(h, bob, 'bob', 0x02)

      const followedAt = 1_700_000_100
      await prisma.follows.create({
        data: {
          follower_user_id: bob.user_id,
          subject_kind: 'author',
          subject_id: 'alice',
          is_private: 0,
          created_at: followedAt,
        },
      })

      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/me/notifications',
        headers: authOf(alice),
      })
      assert.equal(res.statusCode, 200, res.body)
      const body = res.json() as {
        unread_count: number
        events: Array<{ kind: string; actor: string; at: number }>
      }
      assert.equal(body.unread_count, 1)
      assert.equal(body.events.length, 1)
      assert.equal(body.events[0]?.kind, 'followed_you')
      assert.equal(body.events[0]?.actor, 'bob')
      assert.equal(body.events[0]?.at, followedAt)
    } finally {
      await prisma.$disconnect()
    }
  })
})
