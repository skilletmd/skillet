import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import {
  MissingDatabaseUrlError,
  createPrismaClient,
  requireDatabaseUrl,
  runPrismaTransaction,
} from '../src/db/prisma-client.js'
import type { PrismaClient } from '@prisma/client'
import { mysqlTestsEnabled } from './mysql-test-env.js'

const DEFAULT_DATABASE_URL = 'mysql://skillet:skillet@127.0.0.1:3307/skillet_registry'
const DATABASE_URL = (process.env.DATABASE_URL ?? '').trim() || DEFAULT_DATABASE_URL
// Live MySQL proofs run only via `pnpm test:mysql` (SKILLET_MYSQL_TESTS=1).
const skipLiveMysql = !mysqlTestsEnabled({
  ...process.env,
  DATABASE_URL,
  SKILLET_MYSQL_TESTS: process.env.SKILLET_MYSQL_TESTS,
})

describe('prisma client boot (U2)', () => {
  it('requireDatabaseUrl throws when unset', () => {
    assert.throws(() => requireDatabaseUrl({}), MissingDatabaseUrlError)
    assert.throws(() => requireDatabaseUrl({ DATABASE_URL: '   ' }), MissingDatabaseUrlError)
  })

  it('requireDatabaseUrl returns trimmed URL', () => {
    assert.equal(requireDatabaseUrl({ DATABASE_URL: ` ${DATABASE_URL} ` }), DATABASE_URL)
  })

  it('buildServer usePrismaAuth fails closed without DATABASE_URL', async () => {
    const prev = process.env.DATABASE_URL
    delete process.env.DATABASE_URL
    try {
      const { buildServer } = await import('../src/server.js')
      await assert.rejects(
        () => buildServer({ logger: false, usePrismaAuth: true, dbPath: ':memory:' }),
        MissingDatabaseUrlError,
      )
    } finally {
      if (prev === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = prev
    }
  })

  describe('against MySQL', { skip: skipLiveMysql }, () => {
    let prisma: PrismaClient | undefined

    before(async () => {
      prisma = createPrismaClient({ databaseUrl: DATABASE_URL })
      await prisma.$connect()
    })

    after(async () => {
      await prisma?.$disconnect()
    })

    it('connects and reads from MySQL', async () => {
      assert.ok(prisma)
      const rows = await prisma.$queryRawUnsafe<Array<{ ok: bigint | number }>>('SELECT 1 AS ok')
      assert.equal(Number(rows[0]?.ok), 1)
    })

    it('rolls back interactive transactions', async () => {
      assert.ok(prisma)
      const id = `tx-test-${Date.now()}`
      await assert.rejects(async () => {
        await runPrismaTransaction(prisma!, async (tx) => {
          await tx.alerts.create({
            data: {
              id,
              kind: 'test',
              payload_json: '{}',
              raised_at: Math.floor(Date.now() / 1000),
            },
          })
          throw new Error('force rollback')
        })
      }, /force rollback/)

      const found = await prisma.alerts.findUnique({ where: { id } })
      assert.equal(found, null)
    })
  })
})
