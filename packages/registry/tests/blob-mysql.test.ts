// U3: memory BlobStore metadata round-trip on MySQL via Prisma.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import type { PrismaClient } from '@prisma/client'
import { MemoryBlobStore } from '../src/blob-store/memory-blob-store.js'
import {
  ensureMysqlMigrated,
  freshMysqlPrisma,
  resetMysqlRegistry,
  mysqlTestsEnabled
} from './mysql-test-env.js'

const hasDatabaseUrl = mysqlTestsEnabled()

describe('blob meta mysql (U3)', { skip: !hasDatabaseUrl }, () => {
  let prisma: PrismaClient

  before(async () => {
    await ensureMysqlMigrated()
    prisma = await freshMysqlPrisma()
  })

  after(async () => {
    await prisma?.$disconnect()
  })

  it('MemoryBlobStore put persists bytes inline so they survive a restart', async () => {
    await resetMysqlRegistry(prisma)
    const store = new MemoryBlobStore(undefined, prisma)
    const bytes = new TextEncoder().encode('mysql memory blob')
    const hash = 'sha256:' + createHash('sha256').update(bytes).digest('hex')

    assert.equal(await store.has(hash), false)
    await store.put(hash, bytes)
    assert.equal(await store.has(hash), true)
    assert.deepEqual(await store.get(hash), bytes)

    const row = await prisma.blobs.findUnique({ where: { hash } })
    assert.ok(row)
    // Bytes are stored inline (not just metadata) so a fresh process — i.e. after
    // a registry restart, with an empty in-memory Map — still resolves them.
    assert.equal(row.storage_loc, 'inline')
    assert.equal(row.size, bytes.byteLength)
    const freshProcess = new MemoryBlobStore(undefined, prisma)
    assert.deepEqual(await freshProcess.get(hash), bytes)
  })
})
