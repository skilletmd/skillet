import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { assertMysqlSchemaReady } from '../src/assert-mysql-schema.js'
import type { PrismaClient } from '@prisma/client'

describe('assertMysqlSchemaReady', () => {
  it('resolves when muted_team_kits is queryable', async () => {
    const prisma = {
      muted_team_kits: {
        findFirst: async () => null,
      },
    } as unknown as PrismaClient
    await assertMysqlSchemaReady(prisma)
  })

  it('throws a migrate hint when the probe fails', async () => {
    const prisma = {
      muted_team_kits: {
        findFirst: async () => {
          throw new Error('Table muted_team_kits does not exist')
        },
      },
    } as unknown as PrismaClient
    await assert.rejects(
      () => assertMysqlSchemaReady(prisma),
      (err: unknown) => {
        assert.ok(err instanceof Error)
        assert.match(err.message, /muted_team_kits probe failed/)
        assert.match(err.message, /prisma migrate deploy/)
        return true
      },
    )
  })
})
