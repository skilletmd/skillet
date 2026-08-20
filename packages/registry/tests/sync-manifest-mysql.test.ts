// U4: GET /sync/manifest session path against MySQL.
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
import { newId } from '../src/db/index.js'

const hasDatabaseUrl = mysqlTestsEnabled()

describe('sync manifest http mysql (U4)', { skip: !hasDatabaseUrl }, () => {
  let h: Handle

  before(async () => {
    h = await freshMysqlServer()
  })

  after(async () => {
    await h?.app.close()
  })

  it('returns own authored skills in the session union', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)

      const session = await mint(h)
      await claim(h, session, 'syncer', 21)
      await addSkillVersionPrisma(prisma, 'syncer', 'tool', 'sha256:sync-manifest-1', 1_700_000_100)

      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/sync/manifest',
        headers: { authorization: `Bearer ${session.session_token}` },
      })
      assert.equal(res.statusCode, 200, res.body)
      const body = res.json() as {
        account_scope: string
        items: Array<{ ref: string; content_hash: string }>
      }
      assert.equal(body.account_scope, 'user')
      assert.ok(body.items.some((item) => item.ref === '@syncer/tool'))
      assert.ok(
        body.items.some((item) => item.content_hash.includes('sync-manifest-1')),
      )
    } finally {
      await prisma.$disconnect()
    }
  })

  it('includes skills from a kit the caller owns', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)

      const session = await mint(h)
      await claim(h, session, 'kitowner', 22)
      await addSkillVersionPrisma(
        prisma,
        'kitowner',
        'shared',
        'sha256:kit-manifest-skill',
        1_700_000_200,
      )

      const kitId = newId()
      await prisma.kits.create({
        data: {
          id: kitId,
          owner_id: 'kitowner',
          name: 'Team Kit',
          slug: 'team-kit',
          visibility: 'private',
        },
      })
      await prisma.kit_skills.create({
        data: {
          kit_id: kitId,
          skill_id: 'kitowner:shared',
          pinned_hash: null,
        },
      })

      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/sync/manifest',
        headers: { authorization: `Bearer ${session.session_token}` },
      })
      assert.equal(res.statusCode, 200, res.body)
      const body = res.json() as { items: Array<{ ref: string; kit_id?: string }> }
      const owned = body.items.find((item) => item.ref === '@kitowner/shared')
      assert.ok(owned)
      assert.equal(owned.kit_id, kitId)
    } finally {
      await prisma.$disconnect()
    }
  })
})
