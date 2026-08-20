// Plan 012 U6: summon reach counter. Aggregate-only, no PII; emitted on a
// summon-marked (?src=summon) content fetch of a PUBLIC skill.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { canonicalContentHash } from '@skillet/protocol'
import { buildServer } from '../src/server.js'
import { MemoryBlobStore } from '../src/blob-store/memory-blob-store.js'
import { blobHash } from '../src/db/index.js'
import { emitSummonEvent } from '../src/lib/summon-events.js'
import {
  createTestPrismaClient,
  ensureMysqlMigrated,
  mysqlTestsEnabled,
  requireTestDatabaseUrl,
  resetMysqlRegistry,
} from './mysql-test-env.js'

const hasDatabaseUrl = mysqlTestsEnabled()

async function seedPublicSkill(
  prisma: ReturnType<typeof createTestPrismaClient>,
  store: MemoryBlobStore,
  author: string,
  slug: string,
): Promise<string> {
  const bytes = new TextEncoder().encode(`---\nname: ${slug}\ndescription: x\n---\n# ${slug}\n`)
  const bh = blobHash(bytes)
  await store.put(bh, bytes)
  const versionHash = canonicalContentHash(new Map<string, Uint8Array>([['SKILL.md', bytes]]))
  const skillId = `${author}:${slug}`
  await prisma.authors.upsert({ where: { id: author }, create: { id: author, name: author }, update: {} })
  await prisma.skills.create({
    data: { id: skillId, author_id: author, slug, description: 'x', visibility: 'public', latest_hash: versionHash, moderation_status: 'none' },
  })
  await prisma.skill_versions.create({
    data: { skill_id: skillId, hash: versionHash, published_by: author, published_at: 1_700_000_000, metadata_json: '{}', major: 1, minor: 0, patch: 0 },
  })
  await prisma.skill_version_files.create({
    data: { skill_id: skillId, version_hash: versionHash, path: 'SKILL.md', blob_hash: bh },
  })
  await prisma.skill_version_scans.create({
    data: { skill_id: skillId, skill_version_id: versionHash, status: 'clean', findings_json: '[]', scanned_at: 1_700_000_000 },
  })
  return versionHash
}

/** Sum the reach counter for a skill (fire-and-forget emit → poll to settle). */
async function reachFor(prisma: ReturnType<typeof createTestPrismaClient>, skillId: string): Promise<number> {
  for (let i = 0; i < 40; i++) {
    const rows = await prisma.skill_summon_counts.findMany({ where: { skill_id: skillId } })
    const total = rows.reduce((n, r) => n + r.count, 0)
    if (total > 0) return total
    await new Promise((r) => setTimeout(r, 25))
  }
  return 0
}

describe('summon reach counter (plan 012 U6)', { skip: !hasDatabaseUrl }, () => {
  it('emitSummonEvent bumps an aggregate tally and normalizes the handle', async () => {
    process.env.DATABASE_URL = requireTestDatabaseUrl()
    await ensureMysqlMigrated()
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)
      await emitSummonEvent({ prisma, skillId: 'a:x', viaHandle: '@karpathy' })
      await emitSummonEvent({ prisma, skillId: 'a:x', viaHandle: 'karpathy' })
      const rows = await prisma.skill_summon_counts.findMany({ where: { skill_id: 'a:x' } })
      // Both normalize to via_handle 'karpathy' (leading @ stripped) → one row, count 2.
      assert.equal(rows.length, 1)
      assert.equal(rows[0]?.via_handle, 'karpathy')
      assert.equal(rows[0]?.count, 2)
    } finally {
      await prisma.$disconnect()
    }
  })

  it('a summon-marked public content fetch counts; an unmarked one does not', async () => {
    process.env.DATABASE_URL = requireTestDatabaseUrl()
    process.env.BLOB_STORE = 'memory'
    await ensureMysqlMigrated()
    const prisma = createTestPrismaClient()
    await resetMysqlRegistry(prisma)
    const store = new MemoryBlobStore(undefined, prisma)
    const hash = await seedPublicSkill(prisma, store, 'karpathy', 'blog')
    const h = await buildServer({ logger: false, usePrismaAuth: true, auth: { devAuth: true }, blobStore: store })
    await h.app.ready()
    try {
      // Unmarked fetch — no count (installs/sync/web-views unaffected).
      const plain = await h.app.inject({ method: 'GET', url: `/api/v1/skills/karpathy/blog/versions/${hash}` })
      assert.equal(plain.statusCode, 200, plain.body)
      await new Promise((r) => setTimeout(r, 150))
      assert.equal(await prisma.skill_summon_counts.count({ where: { skill_id: 'karpathy:blog' } }), 0)

      // Summon-marked fetch — counts, keyed to the via handle.
      const marked = await h.app.inject({
        method: 'GET',
        url: `/api/v1/skills/karpathy/blog/versions/${hash}?src=summon&via=karpathy&runtime=claude-code`,
      })
      assert.equal(marked.statusCode, 200, marked.body)
      assert.equal(await reachFor(prisma, 'karpathy:blog'), 1)

      // Second summon increments.
      await h.app.inject({
        method: 'GET',
        url: `/api/v1/skills/karpathy/blog/versions/${hash}?src=summon&via=karpathy`,
      })
      for (let i = 0; i < 40; i++) {
        if ((await reachFor(prisma, 'karpathy:blog')) >= 2) break
        await new Promise((r) => setTimeout(r, 25))
      }
      assert.equal(await reachFor(prisma, 'karpathy:blog'), 2)
    } finally {
      await h.app.close()
      await prisma.$disconnect()
    }
  })

  it('surfaces summon_count per skill + total_summons on the profile (U7)', async () => {
    process.env.DATABASE_URL = requireTestDatabaseUrl()
    process.env.BLOB_STORE = 'memory'
    await ensureMysqlMigrated()
    const prisma = createTestPrismaClient()
    await resetMysqlRegistry(prisma)
    const store = new MemoryBlobStore(undefined, prisma)
    await seedPublicSkill(prisma, store, 'reachy', 'blog')
    // Two summons of reachy/blog via @reachy.
    await prisma.skill_summon_counts.create({
      data: { skill_id: 'reachy:blog', via_handle: 'reachy', day: 20_000, count: 2 },
    })
    const h = await buildServer({ logger: false, usePrismaAuth: true, auth: { devAuth: true }, blobStore: store })
    await h.app.ready()
    try {
      const res = await h.app.inject({ method: 'GET', url: '/api/v1/profiles/reachy' })
      assert.equal(res.statusCode, 200, res.body)
      const body = res.json() as {
        total_summons: number
        skills: Array<{ slug: string; summon_count: number }>
      }
      assert.equal(body.total_summons, 2)
      const blog = body.skills.find((s) => s.slug === 'blog')
      assert.equal(blog?.summon_count, 2)
    } finally {
      await h.app.close()
      await prisma.$disconnect()
    }
  })
})
