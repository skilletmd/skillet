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
})
