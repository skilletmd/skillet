// U4: account update-mode routes against MySQL via freshMysqlServer.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import {
  addSkillVersionPrisma,
  authOf,
  claim,
  freshMysqlServer,
  mint,
  subscribeAuthorPrisma,
  type Handle,
} from './helpers.js'
import {
  createTestPrismaClient,
  mysqlTestsEnabled,
  resetMysqlRegistry,
} from './mysql-test-env.js'

const hasDatabaseUrl = mysqlTestsEnabled()

describe('account mysql (U4)', { skip: !hasDatabaseUrl }, () => {
  let h: Handle

  before(async () => {
    h = await freshMysqlServer()
  })

  after(async () => {
    await h?.app.close()
  })

  it('GET /me/update-mode defaults to manual and PATCH can set manual', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)
      const sam = await mint(h)
      await claim(h, sam, 'sam', 0x63)

      const get = await h.app.inject({
        method: 'GET',
        url: '/api/v1/me/update-mode',
        headers: authOf(sam),
      })
      assert.equal(get.statusCode, 200)
      assert.equal((get.json() as { mode: string }).mode, 'manual')

      const bad = await h.app.inject({
        method: 'PATCH',
        url: '/api/v1/me/update-mode',
        payload: { mode: 'bogus' },
        headers: authOf(sam),
      })
      assert.equal(bad.statusCode, 400)

      const patch = await h.app.inject({
        method: 'PATCH',
        url: '/api/v1/me/update-mode',
        payload: { mode: 'manual' },
        headers: authOf(sam),
      })
      assert.equal(patch.statusCode, 200)
      assert.equal((patch.json() as { mode: string; applied: number }).applied, 0)

      const row = await prisma.users.findUnique({
        where: { id: sam.user_id },
        select: { update_mode: true },
      })
      assert.equal(row?.update_mode, 'manual')
    } finally {
      await prisma.$disconnect()
    }
  })

  it('flipping to auto stamps pending via Prisma and reports applied count', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)

      const olivia = await mint(h)
      await claim(h, olivia, 'olivia', 0x61)
      await addSkillVersionPrisma(prisma, 'olivia', 'tool', 'sha256:v1', 1000)

      const ursula = await mint(h)
      await claim(h, ursula, 'ursula', 0x65)
      await subscribeAuthorPrisma(prisma, ursula.user_id, 'olivia')

      const flip = await h.app.inject({
        method: 'PATCH',
        url: '/api/v1/me/update-mode',
        payload: { mode: 'auto' },
        headers: authOf(ursula),
      })
      assert.equal(flip.statusCode, 200, flip.body)
      const body = flip.json() as { mode: string; applied: number }
      assert.equal(body.mode, 'auto')
      assert.equal(body.applied, 1)

      const stamped = await prisma.update_decisions.findFirst({
        where: { user_id: ursula.user_id },
        select: { state: true, source: true },
      })
      assert.equal(stamped?.state, 'approved')
      assert.equal(stamped?.source, 'auto')
    } finally {
      await prisma.$disconnect()
    }
  })
})
