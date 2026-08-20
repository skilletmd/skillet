// U4: abuse report intake against MySQL via freshMysqlServer.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import {
  addSkillVersionPrisma,
  authOf,
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

describe('reports mysql (U4)', { skip: !hasDatabaseUrl }, () => {
  let h: Handle

  before(async () => {
    h = await freshMysqlServer()
  })

  after(async () => {
    await h?.app.close()
  })

  async function setupReporter(): Promise<{
    reporter: { user_id: string; session_token: string }
  }> {
    const prisma = createTestPrismaClient()
    await resetMysqlRegistry(prisma)
    await addSkillVersionPrisma(prisma, 'alice', 'tool', 'sha256:tool', 1000)
    await prisma.$disconnect()

    const alice = await mint(h)
    await claim(h, alice, 'alice', 0x61)
    const reporter = await mint(h)
    await claim(h, reporter, 'bob', 0x62)
    return { reporter }
  }

  function post(
    body: unknown,
    token?: string,
    path = '/api/v1/skills/alice/tool/report',
  ) {
    return h.app.inject({
      method: 'POST',
      url: path,
      headers: token ? authOf({ user_id: '', session_token: token }) : {},
      payload: body,
    })
  }

  it('rejects an anonymous reporter with 401', async () => {
    await setupReporter()
    const res = await post({ category: 'spam' })
    assert.equal(res.statusCode, 401)
  })

  it('accepts a valid safety report and writes an open row via Prisma', async () => {
    const { reporter } = await setupReporter()
    const res = await post(
      { category: 'malware', reason: 'ships a keylogger' },
      reporter.session_token,
    )
    assert.equal(res.statusCode, 201, res.body)
    const { id } = res.json() as { id: string }

    const prisma = createTestPrismaClient()
    try {
      const row = await prisma.skill_reports.findUnique({
        where: { id },
        select: {
          skill_id: true,
          category: true,
          status: true,
          reported_by: true,
          reason: true,
        },
      })
      assert.equal(row?.skill_id, 'alice:tool')
      assert.equal(row?.category, 'malware')
      assert.equal(row?.status, 'open')
      assert.equal(row?.reported_by, reporter.user_id)
      assert.equal(row?.reason, 'ships a keylogger')
    } finally {
      await prisma.$disconnect()
    }
  })

  it('404s an unknown skill', async () => {
    const { reporter } = await setupReporter()
    const res = await post(
      { category: 'spam' },
      reporter.session_token,
      '/api/v1/skills/alice/ghost/report',
    )
    assert.equal(res.statusCode, 404)
  })

  it('403s a suspended reporter', async () => {
    const { reporter } = await setupReporter()
    const prisma = createTestPrismaClient()
    try {
      await prisma.users.update({
        where: { id: reporter.user_id },
        data: { suspended_at: Math.floor(Date.now() / 1000) },
      })
      const res = await post({ category: 'spam' }, reporter.session_token)
      assert.equal(res.statusCode, 403)
      assert.equal((res.json() as { error: string }).error, 'account_suspended')
    } finally {
      await prisma.$disconnect()
    }
  })

  it('requires ownership acknowledgement on the copyright branch', async () => {
    const { reporter } = await setupReporter()
    const denied = await post({ category: 'copyright' }, reporter.session_token)
    assert.equal(denied.statusCode, 400)
    assert.equal((denied.json() as { error: string }).error, 'ownership_required')

    const ok = await post(
      { category: 'copyright', claims_ownership: true, reason: 'my repo, verbatim' },
      reporter.session_token,
    )
    assert.equal(ok.statusCode, 201, ok.body)
    const { id } = ok.json() as { id: string }

    const prisma = createTestPrismaClient()
    try {
      const row = await prisma.skill_reports.findUnique({
        where: { id },
        select: { claims_ownership: true, category: true },
      })
      assert.equal(row?.category, 'copyright')
      assert.equal(row?.claims_ownership, 1)
    } finally {
      await prisma.$disconnect()
    }
  })
})
