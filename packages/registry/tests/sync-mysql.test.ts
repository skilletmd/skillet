// U4 wave: sync manifest leaf helpers against MySQL (Prisma).
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import type { PrismaClient } from '@prisma/client'
import {
  bumpUserDeviceSyncPrisma,
  readDeviceSyncSnapshotPrisma,
} from '../src/lib/device-sync-stream.js'
import { newId } from '../src/db/index.js'
import {
  deleteSkillPrisma,
  getSkillMirrorCollisionPrisma,
  getSkillMirrorComputedHashPrisma,
  listRepoMirroredSkillsPrisma,
} from '../src/sync/sync-repo.js'
import {
  ensureMysqlMigrated,
  freshMysqlPrisma,
  mysqlTestsEnabled,
  resetMysqlRegistry,
} from './mysql-test-env.js'

const hasDatabaseUrl = mysqlTestsEnabled()

describe('sync mysql (U4 sync manifests)', { skip: !hasDatabaseUrl }, () => {
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

  it('bumpUserDeviceSyncPrisma increments seq and readDeviceSyncSnapshotPrisma sees it', async () => {
    await reset()
    const userId = newId()
    await prisma.users.create({
      data: { id: userId, handle: 'sync-user', device_sync_seq: 0 },
    })

    assert.deepEqual(await readDeviceSyncSnapshotPrisma(prisma, userId), { seq: 0 })

    const bumped = await bumpUserDeviceSyncPrisma(prisma, userId)
    assert.deepEqual(bumped, { seq: 1 })
    assert.deepEqual(await readDeviceSyncSnapshotPrisma(prisma, userId), { seq: 1 })

    const again = await bumpUserDeviceSyncPrisma(prisma, userId)
    assert.deepEqual(again, { seq: 2 })
  })

  it('mirror reads + deleteSkillPrisma clear kit membership without FK errors', async () => {
    await reset()
    const author = 'mirror-author'
    const repoFull = 'acme/skills'
    const skillId = `${author}:demo`
    const hash = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const now = Math.floor(Date.now() / 1000)

    await prisma.authors.create({ data: { id: author, name: 'Mirror Author' } })
    await prisma.skills.create({
      data: {
        id: skillId,
        author_id: author,
        slug: 'demo',
        latest_hash: hash,
        visibility: 'public',
        source_repo: repoFull,
      },
    })
    await prisma.skill_versions.create({
      data: {
        skill_id: skillId,
        hash,
        metadata_json: '{}',
        published_by: author,
        published_at: now,
      },
    })
    await prisma.skill_mirrors.create({
      data: {
        skill_id: skillId,
        source_repo: repoFull,
        source_ref: 'main',
        source_path: 'SKILL.md',
        source_url: `https://github.com/${repoFull}`,
        license: null,
        computed_hash: hash,
        synced_at: now,
      },
    })

    const kitId = newId()
    await prisma.kits.create({
      data: {
        id: kitId,
        owner_id: author,
        name: 'Demo Kit',
        visibility: 'public',
      },
    })
    await prisma.kit_skills.create({
      data: { kit_id: kitId, skill_id: skillId, pinned_hash: null },
    })

    const collision = await getSkillMirrorCollisionPrisma(prisma, skillId)
    assert.deepEqual(collision, { visibility: 'public', source_repo: repoFull })

    assert.equal(await getSkillMirrorComputedHashPrisma(prisma, skillId), hash)

    const listed = await listRepoMirroredSkillsPrisma(prisma, author, repoFull)
    assert.deepEqual(listed, [{ id: skillId, slug: 'demo' }])

    await deleteSkillPrisma(prisma, skillId)

    assert.equal(await prisma.skills.count({ where: { id: skillId } }), 0)
    assert.equal(await prisma.kit_skills.count({ where: { skill_id: skillId } }), 0)
    assert.equal(await prisma.skill_mirrors.count({ where: { skill_id: skillId } }), 0)
    assert.equal(await prisma.kits.count({ where: { id: kitId } }), 1)
    assert.deepEqual(await listRepoMirroredSkillsPrisma(prisma, author, repoFull), [])
  })
})
