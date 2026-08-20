// U1: writeSkillPrisma stores bytes via BlobStore (memory meta), not MySQL inline.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import type { PrismaClient } from '@prisma/client'
import { canonicalContentHash } from '@skillet/protocol'
import { toSkillId } from '@skillet/protocol/skill-id'
import { MemoryBlobStore } from '../src/blob-store/memory-blob-store.js'
import { writeSkillPrisma } from '../src/sync/sync-repo.js'
import { computeSkillTokens } from '../src/lib/skill-tokens.js'
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

describe('writeSkillPrisma blob store (mysql)', { skip: !hasDatabaseUrl }, () => {
  let prisma: PrismaClient

  before(async () => {
    await ensureMysqlMigrated()
    prisma = await freshMysqlPrisma()
  })

  after(async () => {
    await prisma?.$disconnect()
  })

  it('persists blob bytes inline in MySQL and loads via blobStore.get', async () => {
    await resetMysqlRegistry(prisma)
    await prisma.authors.create({
      data: { id: 'acme', name: 'Acme', is_mirror: 1 },
    })
    const store = new MemoryBlobStore(undefined, prisma)
    const md = skillMd('alpha')
    const bundle = new Map<string, Uint8Array>([
      ['SKILL.md', new TextEncoder().encode(md)],
    ])
    const versionHash = canonicalContentHash(bundle)
    const skillId = toSkillId('acme/alpha')

    await writeSkillPrisma(
      prisma,
      {
        authorHandle: 'acme',
        repoFull: 'acme/skills',
        license: 'MIT',
        blobStore: store,
      },
      { owner: 'acme', repo: 'skills', ref: 'main' },
      {
        dir: 'skills/alpha',
        slug: 'alpha',
        name: 'alpha',
        description: 'alpha does a thing for tests',
        coupled: false,
        files: [],
      },
      skillId,
      bundle,
      versionHash,
    )

    const files = await prisma.skill_version_files.findMany({
      where: { skill_id: skillId, version_hash: versionHash },
    })
    assert.ok(files.length >= 1)
    for (const f of files) {
      const row = await prisma.blobs.findUnique({ where: { hash: f.blob_hash } })
      assert.ok(row)
      // Bytes persist inline so they survive a registry restart (empty Map).
      assert.equal(row.storage_loc, 'inline')
      assert.ok(row.bytes != null && row.bytes.length > 0)
      const got = await store.get(f.blob_hash)
      assert.ok(got)
      assert.ok(got.byteLength > 0)
    }

    // Context-weight metering (U4): the mirror-written version carries token
    // columns matching a fresh compute of the same SKILL.md.
    const expected = computeSkillTokens(md)
    const version = await prisma.skill_versions.findUnique({
      where: { skill_id_hash: { skill_id: skillId, hash: versionHash } },
    })
    assert.ok(version)
    assert.equal(version.token_count, expected.count)
    assert.equal(version.token_ambient, expected.ambient)
    assert.equal(version.token_bundle, null)
    assert.equal(version.token_method, expected.method)
    assert.ok(expected.ambient > 0 && expected.count > expected.ambient)
  })

  it('second sync with changed SKILL.md bumps via blobStore.get for prior content', async () => {
    await resetMysqlRegistry(prisma)
    await prisma.authors.create({
      data: { id: 'acme', name: 'Acme', is_mirror: 1 },
    })
    const store = new MemoryBlobStore(undefined, prisma)
    const ctx = {
      authorHandle: 'acme',
      repoFull: 'acme/skills',
      license: 'MIT',
      blobStore: store,
    }
    const discovery = { owner: 'acme', repo: 'skills', ref: 'main' }
    const skill = {
      dir: 'skills/alpha',
      slug: 'alpha',
      name: 'alpha',
      description: 'alpha does a thing for tests',
      coupled: false,
      files: [],
    }
    const skillId = toSkillId('acme/alpha')

    const bundle1 = new Map<string, Uint8Array>([
      ['SKILL.md', new TextEncoder().encode(skillMd('alpha', 'v1'))],
    ])
    await writeSkillPrisma(
      prisma,
      ctx,
      discovery,
      skill,
      skillId,
      bundle1,
      canonicalContentHash(bundle1),
    )

    const bundle2 = new Map<string, Uint8Array>([
      ['SKILL.md', new TextEncoder().encode(skillMd('alpha', 'v2 changed'))],
    ])
    const hash2 = canonicalContentHash(bundle2)
    await writeSkillPrisma(prisma, ctx, discovery, skill, skillId, bundle2, hash2)

    const skillRow = await prisma.skills.findUnique({ where: { id: skillId } })
    assert.equal(skillRow?.latest_hash, hash2)
    const versions = await prisma.skill_versions.findMany({ where: { skill_id: skillId } })
    assert.ok(versions.length >= 2)

    const files = await prisma.skill_version_files.findMany({
      where: { skill_id: skillId, version_hash: hash2 },
    })
    for (const f of files) {
      const row = await prisma.blobs.findUnique({ where: { hash: f.blob_hash } })
      assert.equal(row?.storage_loc, 'inline')
      assert.ok(row?.bytes != null && row.bytes.length > 0)
    }
  })

  it('put failure prevents a new skill_versions row', async () => {
    await resetMysqlRegistry(prisma)
    await prisma.authors.create({
      data: { id: 'acme', name: 'Acme', is_mirror: 1 },
    })
    const store = new MemoryBlobStore(undefined, prisma)
    store.put = async () => {
      throw new Error('simulated put failure')
    }
    const bundle = new Map<string, Uint8Array>([
      ['SKILL.md', new TextEncoder().encode(skillMd('alpha'))],
    ])
    const skillId = toSkillId('acme/alpha')
    await assert.rejects(
      () =>
        writeSkillPrisma(
          prisma,
          {
            authorHandle: 'acme',
            repoFull: 'acme/skills',
            license: 'MIT',
            blobStore: store,
          },
          { owner: 'acme', repo: 'skills', ref: 'main' },
          { dir: 'skills/alpha', slug: 'alpha', name: 'alpha', description: 'alpha does a thing for tests', coupled: false, files: [] },
          skillId,
          bundle,
          canonicalContentHash(bundle),
        ),
      /simulated put failure/,
    )
    assert.equal(await prisma.skills.count({ where: { id: skillId } }), 0)
    assert.equal(await prisma.skill_versions.count({ where: { skill_id: skillId } }), 0)
  })
})
