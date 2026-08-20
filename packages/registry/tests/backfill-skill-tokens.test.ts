import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import type { PrismaClient } from '@prisma/client'
import { canonicalContentHash } from '@skillet/protocol'
import { toSkillId } from '@skillet/protocol/skill-id'
import { MemoryBlobStore } from '../src/blob-store/memory-blob-store.js'
import { writeSkillPrisma } from '../src/sync/sync-repo.js'
import { computeSkillTokens } from '../src/lib/skill-tokens.js'
import { backfillSkillTokens } from '../scripts/backfill-skill-tokens.js'
import {
  ensureMysqlMigrated,
  freshMysqlPrisma,
  resetMysqlRegistry,
  mysqlTestsEnabled,
} from './mysql-test-env.js'

const hasDatabaseUrl = mysqlTestsEnabled()

function skillMd(name: string, body = 'Use it.'): string {
  return `---\nname: ${name}\ndescription: ${name} does a thing for tests\n---\n\n${body}`
}

describe('backfillSkillTokens (mysql)', { skip: !hasDatabaseUrl }, () => {
  let prisma: PrismaClient

  before(async () => {
    await ensureMysqlMigrated()
    prisma = await freshMysqlPrisma()
  })

  after(async () => {
    await prisma?.$disconnect()
  })

  // Write a mirror version (which sets token columns), then null them to
  // simulate a legacy row that predates the feature.
  async function seedLegacyVersion(): Promise<{
    skillId: string
    versionHash: string
    md: string
    store: MemoryBlobStore
  }> {
    await resetMysqlRegistry(prisma)
    await prisma.authors.create({ data: { id: 'acme', name: 'Acme', is_mirror: 1 } })
    const store = new MemoryBlobStore(undefined, prisma)
    const md = skillMd('alpha')
    const bundle = new Map<string, Uint8Array>([['SKILL.md', new TextEncoder().encode(md)]])
    const versionHash = canonicalContentHash(bundle)
    const skillId = toSkillId('acme/alpha')
    await writeSkillPrisma(
      prisma,
      { authorHandle: 'acme', repoFull: 'acme/skills', license: 'MIT', blobStore: store },
      { owner: 'acme', repo: 'skills', ref: 'main' },
      { dir: 'skills/alpha', slug: 'alpha', name: 'alpha', description: 'alpha does a thing for tests', coupled: false, files: [] },
      skillId,
      bundle,
      versionHash,
    )
    await prisma.skill_versions.update({
      where: { skill_id_hash: { skill_id: skillId, hash: versionHash } },
      data: { token_count: null, token_ambient: null, token_method: null },
    })
    return { skillId, versionHash, md, store }
  }

  it('populates null token columns from stored SKILL.md and is idempotent', async () => {
    const { skillId, versionHash, md, store } = await seedLegacyVersion()

    const first = await backfillSkillTokens(prisma, store, {})
    assert.equal(first.candidates, 1)
    assert.equal(first.updated, 1)

    const expected = computeSkillTokens(md)
    const row = await prisma.skill_versions.findUnique({
      where: { skill_id_hash: { skill_id: skillId, hash: versionHash } },
    })
    assert.ok(row)
    assert.equal(row.token_count, expected.count)
    assert.equal(row.token_ambient, expected.ambient)
    assert.equal(row.token_method, expected.method)
    assert.equal(row.token_bundle, null)

    // Second pass finds no null rows and writes nothing.
    const second = await backfillSkillTokens(prisma, store, {})
    assert.equal(second.candidates, 0)
    assert.equal(second.updated, 0)
  })

  it('dry-run reports the candidate but writes nothing', async () => {
    const { skillId, versionHash, store } = await seedLegacyVersion()

    const stats = await backfillSkillTokens(prisma, store, { dryRun: true })
    assert.equal(stats.candidates, 1)
    assert.equal(stats.updated, 0)

    const row = await prisma.skill_versions.findUnique({
      where: { skill_id_hash: { skill_id: skillId, hash: versionHash } },
    })
    assert.equal(row?.token_count, null)
  })
})
