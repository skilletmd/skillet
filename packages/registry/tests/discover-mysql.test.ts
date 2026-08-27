// U4: discover kits catalog helpers against MySQL via Prisma.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import type { PrismaClient } from '@prisma/client'
import {
  countDiscoverKitsPrisma,
  countDiscoverPeoplePrisma,
  listDiscoverKitsPrisma,
  listDiscoverPeoplePrisma,
} from '../src/lib/catalog-discover.js'
import { newId } from '../src/db/index.js'
import { addSkillVersionPrisma } from './helpers.js'
import {
  ensureMysqlMigrated,
  freshMysqlPrisma,
  resetMysqlRegistry,
  mysqlTestsEnabled
} from './mysql-test-env.js'

const hasDatabaseUrl = mysqlTestsEnabled()

describe('discover kits mysql (U4 catalog)', { skip: !hasDatabaseUrl }, () => {
  let prisma: PrismaClient

  before(async () => {
    await ensureMysqlMigrated()
    prisma = await freshMysqlPrisma()
  })

  after(async () => {
    await prisma?.$disconnect()
  })

  it('lists public kits and hides private / suspended-owner kits', async () => {
    await resetMysqlRegistry(prisma)
    const owner = 'kit-owner'
    const suspended = 'bad-owner'
    const now = 1_700_000_000

    await addSkillVersionPrisma(prisma, owner, 'alpha', 'sha256:discover-alpha', now)
    await prisma.users.create({
      data: { id: newId(), handle: owner },
    })
    await prisma.users.create({
      data: {
        id: newId(),
        handle: suspended,
        suspended_at: now,
      },
    })
    await prisma.authors.createMany({
      data: [
        { id: owner, name: 'Kit Owner' },
        { id: suspended, name: 'Suspended' },
      ],
      skipDuplicates: true,
    })

    const publicId = newId()
    const privateId = newId()
    const suspendedKitId = newId()
    await prisma.kits.createMany({
      data: [
        {
          id: publicId,
          owner_id: owner,
          name: 'Public Kit',
          slug: 'public-kit',
          visibility: 'public',
          moderation_status: 'none',
        },
        {
          id: privateId,
          owner_id: owner,
          name: 'Private Kit',
          slug: 'private-kit',
          visibility: 'private',
          moderation_status: 'none',
        },
        {
          id: suspendedKitId,
          owner_id: suspended,
          name: 'Suspended Kit',
          slug: 'suspended-kit',
          visibility: 'public',
          moderation_status: 'none',
        },
      ],
    })
    await prisma.kit_skills.create({
      data: { kit_id: publicId, skill_id: `${owner}:alpha` },
    })

    assert.equal(await countDiscoverKitsPrisma(prisma), 1)
    const listed = await listDiscoverKitsPrisma(prisma, { limit: 10, offset: 0 })
    assert.equal(listed.length, 1)
    assert.equal(listed[0]?.id, publicId)
    assert.equal(listed[0]?.skill_count, 1)
    assert.deepEqual(listed[0]?.skill_ids, [`${owner}:alpha`])
  })

  it('lists discover people with a public skill and hides suspended authors', async () => {
    await resetMysqlRegistry(prisma)
    const creator = 'people-creator'
    const suspended = 'people-suspended'
    const now = 1_700_000_100

    await addSkillVersionPrisma(prisma, creator, 'alpha', 'sha256:people-alpha', now)
    await addSkillVersionPrisma(prisma, suspended, 'beta', 'sha256:people-beta', now)
    await prisma.users.create({
      data: { id: newId(), handle: creator },
    })
    await prisma.users.create({
      data: {
        id: newId(),
        handle: suspended,
        suspended_at: now,
      },
    })
    await prisma.authors.update({
      where: { id: creator },
      data: { name: 'People Creator' },
    })
    await prisma.authors.update({
      where: { id: suspended },
      data: { name: 'Suspended' },
    })

    assert.equal(await countDiscoverPeoplePrisma(prisma), 1)
    const listed = await listDiscoverPeoplePrisma(prisma, { limit: 10, offset: 0 })
    assert.equal(listed.length, 1)
    assert.equal(listed[0]?.id, creator)
    assert.equal(listed[0]?.public_skills, 1)
    assert.equal(listed[0]?.name, 'People Creator')
  })

  // Both discover filters used to match the whole query as one substring, so a
  // two-word filter answered empty.
  describe('the q filter matches word by word', () => {
    const now = 1_700_000_000

    async function seedKit(owner: string, name: string): Promise<string> {
      await addSkillVersionPrisma(prisma, owner, `${name}-skill`, `sha256:dq-${name}`, now)
      const id = newId()
      await prisma.kits.create({
        data: {
          id,
          owner_id: owner,
          name,
          slug: name.replace(/[^a-z0-9]+/g, '-'),
          visibility: 'public',
          moderation_status: 'none',
        },
      })
      await prisma.kit_skills.create({ data: { kit_id: id, skill_id: `${owner}:${name}-skill` } })
      return id
    }

    it('finds a kit whose name carries both words', async () => {
      await resetMysqlRegistry(prisma)
      const wanted = await seedKit('alice', 'web-design')
      await seedKit('bob', 'lint-tools')

      const listed = await listDiscoverKitsPrisma(prisma, { limit: 10, offset: 0, q: 'web design' })
      assert.deepEqual(
        listed.map((k) => k.id),
        [wanted],
      )
      assert.equal(await countDiscoverKitsPrisma(prisma, { q: 'web design' }), 1)
    })

    it('narrows kits rather than widening them', async () => {
      await resetMysqlRegistry(prisma)
      await seedKit('alice', 'web-design')
      await seedKit('bob', 'design-only')

      assert.equal(
        await countDiscoverKitsPrisma(prisma, { q: 'web design' }),
        1,
        'a kit matching one word must not pass a filter',
      )
    })

    it('finds a person by handle and display name together', async () => {
      await resetMysqlRegistry(prisma)
      await addSkillVersionPrisma(prisma, 'web-designer', 'alpha', 'sha256:dqp1', now)
      await addSkillVersionPrisma(prisma, 'someone-else', 'beta', 'sha256:dqp2', now)
      await prisma.users.create({ data: { id: newId(), handle: 'web-designer' } })
      await prisma.users.create({ data: { id: newId(), handle: 'someone-else' } })
      await prisma.authors.update({ where: { id: 'web-designer' }, data: { name: 'Casey Web' } })
      await prisma.authors.update({ where: { id: 'someone-else' }, data: { name: 'Someone' } })

      const listed = await listDiscoverPeoplePrisma(prisma, { limit: 10, offset: 0, q: 'web designer' })
      assert.deepEqual(
        listed.map((p) => p.id),
        ['web-designer'],
      )
      assert.equal(await countDiscoverPeoplePrisma(prisma, { q: 'web designer' }), 1)
    })

    it('holds a short word to a word boundary on people', async () => {
      await resetMysqlRegistry(prisma)
      await addSkillVersionPrisma(prisma, 'ai-lab', 'alpha', 'sha256:dqp3', now)
      await addSkillVersionPrisma(prisma, 'explainer', 'beta', 'sha256:dqp4', now)
      await prisma.users.create({ data: { id: newId(), handle: 'ai-lab' } })
      await prisma.users.create({ data: { id: newId(), handle: 'explainer' } })

      const listed = await listDiscoverPeoplePrisma(prisma, { limit: 10, offset: 0, q: 'ai' })
      assert.deepEqual(
        listed.map((p) => p.id),
        ['ai-lab'],
        'ai must not match the middle of explainer',
      )
    })
  })
})
