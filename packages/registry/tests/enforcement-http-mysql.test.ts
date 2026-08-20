// U6: admin skill/kit moderation + mirror-grant HTTP smoke against MySQL via
// Prisma. Covers the enforcement.ts and brand-grant.ts Prisma twins that were
// already wired behind `if (prisma)` in routes/admin.ts but had no MySQL
// regression coverage yet.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { newId } from '../src/db/index.js'
import { addSkillVersionPrisma, authOf, claim, freshMysqlServer, mint, type Handle } from './helpers.js'
import {
  createTestPrismaClient,
  mysqlTestsEnabled,
  resetMysqlRegistry,
} from './mysql-test-env.js'

const hasMysql = mysqlTestsEnabled()

describe('enforcement + brand-grant http mysql (U6)', { skip: !hasMysql }, () => {
  let h: Handle

  before(async () => {
    h = await freshMysqlServer()
  })

  after(async () => {
    await h?.app.close()
  })

  it('unlists then relists a skill via admin moderate on MySQL', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)
      await addSkillVersionPrisma(prisma, 'alice', 'tool', 'sha256:enf-1', 1_700_000_000)

      const admin = await mint(h)
      await prisma.users.update({ where: { id: admin.user_id }, data: { is_admin: 1 } })

      const unlist = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/skills/alice:tool/moderate',
        headers: authOf(admin),
        payload: { action: 'unlist' },
      })
      assert.equal(unlist.statusCode, 200, unlist.body)
      const unlistBody = unlist.json() as { skill_id: string; moderation_status: string }
      assert.equal(unlistBody.moderation_status, 'unlisted')

      const afterUnlist = await prisma.skills.findUnique({ where: { id: 'alice:tool' } })
      assert.equal(afterUnlist?.moderation_status, 'unlisted')

      const relist = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/skills/alice:tool/moderate',
        headers: authOf(admin),
        payload: { action: 'relist' },
      })
      assert.equal(relist.statusCode, 200, relist.body)
      const relistBody = relist.json() as { moderation_status: string }
      assert.equal(relistBody.moderation_status, 'none')

      const missing = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/skills/nobody:missing/moderate',
        headers: authOf(admin),
        payload: { action: 'unlist' },
      })
      assert.equal(missing.statusCode, 404, missing.body)
    } finally {
      await prisma.$disconnect()
    }
  })

  it('hides then unhides a kit via admin moderate on MySQL', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)

      const owner = await mint(h)
      await claim(h, owner, 'kitowner', 0x21)
      const admin = await mint(h)
      await prisma.users.update({ where: { id: admin.user_id }, data: { is_admin: 1 } })

      const kitId = newId()
      await prisma.kits.create({
        data: { id: kitId, owner_id: 'kitowner', name: 'Tools', slug: 'tools', visibility: 'public' },
      })

      const hide = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/kits/${kitId}/moderate`,
        headers: authOf(admin),
        payload: { action: 'hide' },
      })
      assert.equal(hide.statusCode, 200, hide.body)
      const hideBody = hide.json() as { kit_id: string; moderation_status: string }
      assert.equal(hideBody.moderation_status, 'hidden')

      const afterHide = await prisma.kits.findUnique({ where: { id: kitId } })
      assert.equal(afterHide?.moderation_status, 'hidden')

      const unhide = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/kits/${kitId}/moderate`,
        headers: authOf(admin),
        payload: { action: 'unhide' },
      })
      assert.equal(unhide.statusCode, 200, unhide.body)
      const unhideBody = unhide.json() as { moderation_status: string }
      assert.equal(unhideBody.moderation_status, 'none')
    } finally {
      await prisma.$disconnect()
    }
  })

  it('grants a seeded mirror to its owner via admin grant on MySQL', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)

      const admin = await mint(h)
      await prisma.users.update({ where: { id: admin.user_id }, data: { is_admin: 1 } })

      const target = await mint(h)
      await claim(h, target, 'newowner', 0x33)

      await prisma.authors.create({
        data: {
          id: 'acme',
          name: 'Acme',
          is_mirror: 1,
          mirror_source_url: 'https://github.com/acme/skills',
        },
      })

      const grant = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/mirrors/acme/grant',
        headers: authOf(admin),
        payload: { handle: 'newowner' },
      })
      assert.equal(grant.statusCode, 201, grant.body)
      const grantBody = grant.json() as { org_id: string; slug: string; owner_user_id: string }
      assert.equal(grantBody.slug, 'acme')
      assert.equal(grantBody.owner_user_id, target.user_id)

      const org = await prisma.organizations.findUnique({ where: { slug: 'acme' } })
      assert.equal(org?.owner_user_id, target.user_id)

      const mirror = await prisma.authors.findUnique({ where: { id: 'acme' } })
      assert.notEqual(mirror?.mirror_claimed_at, null)

      // A second grant attempt against the now-claimed mirror surfaces the
      // BrandGrantError code, not a sqlite-stub throw.
      const regrant = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/mirrors/acme/grant',
        headers: authOf(admin),
        payload: { handle: 'newowner' },
      })
      assert.equal(regrant.statusCode, 409, regrant.body)
      assert.equal((regrant.json() as { error: string }).error, 'already_claimed')
    } finally {
      await prisma.$disconnect()
    }
  })
})
