// U4 catalog wave: seed + public catalog reads against MySQL via Prisma.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import type { PrismaClient } from '@prisma/client'
import {
  countPublicCatalogSkillsPrisma,
  findPublicCatalogSkillPrisma,
  listPublicCatalogSkillsPrisma,
} from '../src/lib/catalog-skills.js'
import { resolveSkillRefPrisma } from '../src/lib/ref-resolution.js'
import { newId } from '../src/db/index.js'
import { deriveVersionLabelPrisma } from '../src/version-label.js'
import {
  addSkillVersionPrisma,
  subscribeAuthorPrisma,
} from './helpers.js'
import {
  ensureMysqlMigrated,
  freshMysqlPrisma,
  resetMysqlRegistry,
  mysqlTestsEnabled
} from './mysql-test-env.js'

const hasDatabaseUrl = mysqlTestsEnabled()

describe('catalog mysql (U4 wave)', { skip: !hasDatabaseUrl }, () => {
  let prisma: PrismaClient

  before(async () => {
    await ensureMysqlMigrated()
    prisma = await freshMysqlPrisma()
  })

  after(async () => {
    await prisma?.$disconnect()
  })

  async function reset(): Promise<void> {
    await resetMysqlRegistry(prisma)
  }

  it('addSkillVersionPrisma seeds a public skill readable by catalog helpers', async () => {
    await reset()
    const author = 'alice'
    const slug = 'tool'
    const hash = 'sha256:catalog-public-v1'
    const skillId = `${author}:${slug}`

    await addSkillVersionPrisma(prisma, author, slug, hash, 1_700_000_000)

    const skill = await prisma.skills.findUnique({ where: { id: skillId } })
    assert.ok(skill)
    assert.equal(skill.visibility, 'public')
    assert.equal(skill.latest_hash, hash)

    const version = await prisma.skill_versions.findUnique({
      where: { skill_id_hash: { skill_id: skillId, hash } },
    })
    assert.ok(version)
    assert.equal(version.published_by, author)
    assert.equal(version.major, 1)
    assert.equal(version.minor, 0)
    assert.equal(version.patch, 0)

    const publicRow = await findPublicCatalogSkillPrisma(prisma, skillId)
    assert.ok(publicRow)
    assert.equal(publicRow.slug, slug)
    assert.equal(publicRow.latest_hash, hash)

    const listed = await listPublicCatalogSkillsPrisma(prisma, { limit: 10, offset: 0 })
    assert.equal(listed.length, 1)
    assert.equal(listed[0]?.id, skillId)
    assert.equal(await countPublicCatalogSkillsPrisma(prisma), 1)

    const resolved = await resolveSkillRefPrisma(prisma, author, slug)
    assert.ok(resolved)
    assert.equal(resolved.skillId, skillId)
    assert.equal(resolved.redirected, false)
  })

  it('catalog helpers hide private, unlisted, and suspended-author skills', async () => {
    await reset()
    await addSkillVersionPrisma(prisma, 'alice', 'live', 'sha256:live', 1000)
    await addSkillVersionPrisma(prisma, 'bob', 'hidden', 'sha256:hidden', 2000)

    await prisma.skills.update({
      where: { id: 'bob:hidden' },
      data: { visibility: 'private' },
    })

    await addSkillVersionPrisma(prisma, 'cara', 'gone', 'sha256:gone', 3000)
    await prisma.skills.update({
      where: { id: 'cara:gone' },
      data: { moderation_status: 'unlisted' },
    })

    const suspendedUserId = newId()
    await prisma.users.create({
      data: {
        id: suspendedUserId,
        handle: 'dave',
        suspended_at: Math.floor(Date.now() / 1000),
      },
    })
    await addSkillVersionPrisma(prisma, 'dave', 'blocked', 'sha256:blocked', 4000)

    const listed = await listPublicCatalogSkillsPrisma(prisma, { limit: 20, offset: 0 })
    assert.deepEqual(
      listed.map((row) => row.id),
      ['alice:live'],
    )
    assert.equal(await countPublicCatalogSkillsPrisma(prisma), 1)
    assert.equal(await findPublicCatalogSkillPrisma(prisma, 'bob:hidden'), null)
    assert.equal(await findPublicCatalogSkillPrisma(prisma, 'cara:gone'), null)
    assert.equal(await findPublicCatalogSkillPrisma(prisma, 'dave:blocked'), null)
  })

  it('subscribeAuthorPrisma and deriveVersionLabelPrisma work on seeded rows', async () => {
    await reset()
    const userId = newId()
    await prisma.users.create({ data: { id: userId, handle: 'reader' } })
    await addSkillVersionPrisma(prisma, 'olivia', 'widget', 'sha256:w1', 1000)
    await subscribeAuthorPrisma(prisma, userId, 'olivia')

    const sub = await prisma.kit_subscriptions.findUnique({
      where: { id: `sub-${userId}-olivia` },
    })
    assert.ok(sub)
    assert.equal(sub.kind, 'author')
    assert.equal(sub.author_id, 'olivia')

    const next = await deriveVersionLabelPrisma(prisma, 'olivia:widget', 'patch')
    assert.equal(next.versionLabel, '1.0.1')
  })

  it('addSkillVersionPrisma is idempotent on the skills row across versions', async () => {
    await reset()
    await addSkillVersionPrisma(prisma, 'alice', 'tool', 'sha256:v1', 1000)
    await addSkillVersionPrisma(prisma, 'alice', 'tool', 'sha256:v2', 2000, {
      major: 1,
      minor: 1,
      patch: 0,
    })

    const skill = await prisma.skills.findUnique({ where: { id: 'alice:tool' } })
    assert.ok(skill)
    assert.equal(skill.latest_hash, 'sha256:v2')

    const versions = await prisma.skill_versions.findMany({
      where: { skill_id: 'alice:tool' },
      orderBy: { published_at: 'asc' },
    })
    assert.equal(versions.length, 2)
    assert.deepEqual(
      versions.map((v) => v.hash),
      ['sha256:v1', 'sha256:v2'],
    )
  })

  // The catalog `q` filter used to match the whole query as one substring, so a
  // two-word filter answered empty while /search answered fine.
  describe('the q filter matches word by word', () => {
    it('finds a hyphenated slug from a two-word filter', async () => {
      await reset()
      await addSkillVersionPrisma(prisma, 'vercel', 'web-design-guidelines', 'sha256:cq1', 3000)
      await addSkillVersionPrisma(prisma, 'alice', 'lint-tool', 'sha256:cq2', 3001)

      const listed = await listPublicCatalogSkillsPrisma(prisma, {
        limit: 20,
        offset: 0,
        q: 'web design',
      })
      assert.deepEqual(
        listed.map((row) => row.id),
        ['vercel:web-design-guidelines'],
      )
      assert.equal(await countPublicCatalogSkillsPrisma(prisma, { q: 'web design' }), 1)
    })

    it('narrows rather than widening: every word must land', async () => {
      await reset()
      await addSkillVersionPrisma(prisma, 'wshobson', 'web-component-design', 'sha256:cq3', 3000)
      await addSkillVersionPrisma(prisma, 'stitch', 'design-md', 'sha256:cq4', 3001)

      const listed = await listPublicCatalogSkillsPrisma(prisma, {
        limit: 20,
        offset: 0,
        q: 'web design',
      })
      assert.deepEqual(
        listed.map((row) => row.id),
        ['wshobson:web-component-design'],
        'design-md matches only one word and must not appear in a filter',
      )
    })

    it('holds a short word to a word boundary', async () => {
      await reset()
      await addSkillVersionPrisma(prisma, 'alice', 'ai-tools', 'sha256:cq5', 3000)
      await addSkillVersionPrisma(prisma, 'bob', 'explain-code', 'sha256:cq6', 3001)

      const listed = await listPublicCatalogSkillsPrisma(prisma, { limit: 20, offset: 0, q: 'ai' })
      assert.deepEqual(
        listed.map((row) => row.id),
        ['alice:ai-tools'],
        'ai must not match the middle of explain',
      )
    })

    it('keeps count and list agreeing on the same filter', async () => {
      await reset()
      await addSkillVersionPrisma(prisma, 'vercel', 'web-design-guidelines', 'sha256:cq7', 3000)
      await addSkillVersionPrisma(prisma, 'alice', 'lint-tool', 'sha256:cq8', 3001)

      for (const q of ['web design', 'ai', 'zzzznothing']) {
        const listed = await listPublicCatalogSkillsPrisma(prisma, { limit: 50, offset: 0, q })
        assert.equal(
          await countPublicCatalogSkillsPrisma(prisma, { q }),
          listed.length,
          `count and list disagree for "${q}", which would break pagination`,
        )
      }
    })
  })
})
