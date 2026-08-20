// Smoke proof that the U5 MySQL harness migrates, inserts, and truncates.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import type { PrismaClient } from '@prisma/client'
import {
  MissingTestDatabaseUrlError,
  createTestPrismaClient,
  ensureMysqlMigrated,
  freshMysqlPrisma,
  mysqlTestsEnabled,
  requireTestDatabaseUrl,
  resetMysqlRegistry,
} from './mysql-test-env.js'

describe('mysql harness (U5)', () => {
  it('requireTestDatabaseUrl fails closed when unset', () => {
    assert.throws(() => requireTestDatabaseUrl({}), MissingTestDatabaseUrlError)
    assert.throws(
      () => requireTestDatabaseUrl({ DATABASE_URL: '   ' }),
      MissingTestDatabaseUrlError,
    )
  })

  // Live MySQL proofs opt in via SKILLET_MYSQL_TESTS=1 (`pnpm test:mysql`).
  const hasDatabaseUrl = mysqlTestsEnabled()
  describe('against MySQL', { skip: !hasDatabaseUrl }, () => {
    let prisma: PrismaClient | undefined

    before(async () => {
      await ensureMysqlMigrated()
      prisma = await freshMysqlPrisma()
    })

    after(async () => {
      await prisma?.$disconnect()
    })

    it('inserts a row then truncate clears it', async () => {
      assert.ok(prisma)
      const id = `harness-${Date.now()}`

      await prisma.alerts.create({
        data: {
          id,
          kind: 'harness-smoke',
          payload_json: '{}',
          raised_at: Math.floor(Date.now() / 1000),
        },
      })

      const found = await prisma.alerts.findUnique({ where: { id } })
      assert.ok(found)
      assert.equal(found.kind, 'harness-smoke')

      await resetMysqlRegistry(prisma)

      const afterReset = await prisma.alerts.findUnique({ where: { id } })
      assert.equal(afterReset, null)
    })

    it('createTestPrismaClient returns a usable client', async () => {
      const client = createTestPrismaClient()
      try {
        const rows = await client.$queryRawUnsafe<Array<{ ok: bigint | number }>>(
          'SELECT 1 AS ok',
        )
        assert.equal(Number(rows[0]?.ok), 1)
      } finally {
        await client.$disconnect()
      }
    })
  })
})
