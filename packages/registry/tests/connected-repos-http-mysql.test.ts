// U4: GET /api/v1/github/repos list against MySQL (no GitHub; seed a row).
process.env.SKILLET_REPO_TOKEN_KEY ??= 'test-repo-token-key'

import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { claim, freshMysqlServer, mint, type Handle } from './helpers.js'
import {
  createTestPrismaClient,
  mysqlTestsEnabled,
  resetMysqlRegistry,
} from './mysql-test-env.js'
import { newId } from '../src/db/index.js'

const hasDatabaseUrl = mysqlTestsEnabled()

describe('connected-repos http mysql (U4)', { skip: !hasDatabaseUrl }, () => {
  let h: Handle

  before(async () => {
    h = await freshMysqlServer()
  })

  after(async () => {
    await h?.app.close()
  })

  it('lists a seeded connected_repos row via Prisma', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)

      const session = await mint(h)
      await claim(h, session, 'linker', 0x41)

      const repoId = newId()
      const now = Math.floor(Date.now() / 1000)
      await prisma.connected_repos.create({
        data: {
          id: repoId,
          user_id: session.user_id,
          owner: 'acme',
          repo: 'demo-skills',
          default_branch: 'main',
          token_enc: null,
          status: 'active',
          created_at: now,
          selected_dirs: null,
          as_kit: 1,
          publish_as: null,
        },
      })

      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/github/repos',
        headers: { authorization: `Bearer ${session.session_token}` },
      })
      assert.equal(res.statusCode, 200, res.body)
      const body = res.json() as {
        repos: Array<{
          id: string
          owner: string
          repo: string
          full: string
          author: string
          skill_count: number
          skills: unknown[]
          kit: unknown
        }>
      }
      assert.equal(body.repos.length, 1)
      assert.equal(body.repos[0]!.id, repoId)
      assert.equal(body.repos[0]!.owner, 'acme')
      assert.equal(body.repos[0]!.repo, 'demo-skills')
      assert.equal(body.repos[0]!.full, 'acme/demo-skills')
      assert.equal(body.repos[0]!.author, 'linker')
      assert.equal(body.repos[0]!.skill_count, 0)
      assert.deepEqual(body.repos[0]!.skills, [])
      assert.equal(body.repos[0]!.kit, null)
    } finally {
      await prisma.$disconnect()
    }
  })
})
