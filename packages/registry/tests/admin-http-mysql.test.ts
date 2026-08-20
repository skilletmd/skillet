// U4: POST /api/v1/admin/users/:handle/suspend against MySQL via Prisma.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { newId } from '../src/db/index.js'
import { authOf, claim, freshMysqlServer, mint, type Handle } from './helpers.js'
import {
  createTestPrismaClient,
  mysqlTestsEnabled,
  resetMysqlRegistry,
} from './mysql-test-env.js'

const hasMysql = mysqlTestsEnabled()

describe('admin mysql (U4)', { skip: !hasMysql }, () => {
  let h: Handle

  before(async () => {
    h = await freshMysqlServer()
  })

  after(async () => {
    await h?.app.close()
  })

  it('suspends a user and lists them in admin moderation', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)

      const admin = await mint(h)
      const target = await mint(h)
      await claim(h, target, 'victim', 0x11)

      const adminId = newId()
      await prisma.users.update({
        where: { id: admin.user_id },
        data: { is_admin: 1 },
      })

      const suspendRes = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/users/victim/suspend',
        headers: authOf(admin),
        payload: { suspend: true },
      })
      assert.equal(suspendRes.statusCode, 200, suspendRes.body)
      const suspendedBody = suspendRes.json() as { handle: string; suspended: boolean }
      assert.equal(suspendedBody.handle, 'victim')
      assert.equal(suspendedBody.suspended, true)

      const victim = await prisma.users.findFirst({
        where: { handle: 'victim' },
        select: { suspended_at: true },
      })
      assert.notEqual(victim?.suspended_at, null)

      const modRes = await h.app.inject({
        method: 'GET',
        url: '/api/v1/admin/moderation',
        headers: authOf(admin),
      })
      assert.equal(modRes.statusCode, 200, modRes.body)
      const modBody = modRes.json() as {
        suspended: Array<{ handle: string; suspended_at: number }>
      }
      assert.equal(modBody.suspended.length, 1)
      assert.equal(modBody.suspended[0]?.handle, 'victim')
    } finally {
      await prisma.$disconnect()
    }
  })
})
