// U4: activity events ingest / private toggle against MySQL via Prisma.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { authOf, claim, freshMysqlServer, mint, type Handle } from './helpers.js'
import {
  createTestPrismaClient,
  mysqlTestsEnabled,
  resetMysqlRegistry,
} from './mysql-test-env.js'

const hasMysql = mysqlTestsEnabled()

describe('events mysql (U4)', { skip: !hasMysql }, () => {
  let h: Handle

  before(async () => {
    h = await freshMysqlServer()
  })

  after(async () => {
    await h?.app.close()
  })

  it('ingests events, lists them, and honors private mode', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)

      const session = await mint(h)
      await claim(h, session, 'eventer', 0x21)

      const post = await h.app.inject({
        method: 'POST',
        url: '/api/v1/events',
        headers: authOf(session),
        payload: {
          events: [{ name: 'sync', initiator: 'human', meta: { ok: true } }],
        },
      })
      assert.equal(post.statusCode, 200, post.body)
      assert.equal((post.json() as { stored: number }).stored, 1)

      const list = await h.app.inject({
        method: 'GET',
        url: '/api/v1/me/events',
        headers: authOf(session),
      })
      assert.equal(list.statusCode, 200, list.body)
      const listBody = list.json() as {
        recording: boolean
        events: Array<{ name: string }>
      }
      assert.equal(listBody.recording, true)
      assert.equal(listBody.events.length, 1)
      assert.equal(listBody.events[0]?.name, 'sync')

      const priv = await h.app.inject({
        method: 'PUT',
        url: '/api/v1/me/activity',
        headers: authOf(session),
        payload: { private: true },
      })
      assert.equal(priv.statusCode, 200, priv.body)
      assert.equal((priv.json() as { private: boolean }).private, true)

      const dropped = await h.app.inject({
        method: 'POST',
        url: '/api/v1/events',
        headers: authOf(session),
        payload: { events: [{ name: 'sync', initiator: 'human' }] },
      })
      assert.equal(dropped.statusCode, 200, dropped.body)
      const droppedBody = dropped.json() as { stored: number; reason?: string }
      assert.equal(droppedBody.stored, 0)
      assert.equal(droppedBody.reason, 'private')
    } finally {
      await prisma.$disconnect()
    }
  })
})
