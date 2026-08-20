// MySQL coverage for mergeDeviceIntoPrisma (U2).
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { mergeDeviceIntoPrisma } from '../src/auth/device-merge.js'
import { runPrismaTransaction } from '../src/db/prisma-client.js'
import {
  createTestPrismaClient,
  mysqlTestsEnabled,
  resetMysqlRegistry,
} from './mysql-test-env.js'

const hasDatabaseUrl = mysqlTestsEnabled()

describe('mergeDeviceIntoPrisma mysql (U2)', { skip: !hasDatabaseUrl }, () => {
  const prisma = createTestPrismaClient()

  before(async () => {
    await resetMysqlRegistry(prisma)
    await prisma.users.create({ data: { id: 'U1', handle: 'alice-merge' } })
  })

  after(async () => {
    await prisma.$disconnect()
  })

  async function seedDevice(id: string, kinds: string[]): Promise<void> {
    await prisma.devices.create({
      data: {
        id,
        token_hash: `hash-${id}`,
        user_id: 'U1',
        label: id,
        client_kinds: JSON.stringify(kinds),
        machine_id: 'M1',
        created_at: 100,
        last_seen_at: 200,
      },
    })
  }

  it('carries loser-only edit and materialization, unions kinds, revokes sessions', async () => {
    await seedDevice('WIN', ['cli'])
    await seedDevice('LOSE', ['desktop'])
    await prisma.device_skill_edits.create({
      data: {
        device_id: 'LOSE',
        user_id: 'U1',
        skill_id: 'skill-only-loser',
        baseline_hash: 'h-loser',
      },
    })
    await prisma.device_skill_materializations.create({
      data: {
        device_id: 'LOSE',
        skill_slug: 'skill-a',
        runtime: 'claude-code',
        status: 'materialized',
        reported_at: 5,
      },
    })
    const now = Math.floor(Date.now() / 1000)
    await prisma.sessions.create({
      data: {
        id: 'S-LOSE',
        user_id: 'U1',
        token_hash: 'sh-lose',
        expires_at: now + 3600,
        device_id: 'LOSE',
      },
    })

    await runPrismaTransaction(prisma, async (tx) => {
      await mergeDeviceIntoPrisma(tx, 'WIN', 'LOSE', now)
    })

    const devices = await prisma.devices.findMany({ select: { id: true }, orderBy: { id: 'asc' } })
    assert.deepEqual(
      devices.map((d) => d.id),
      ['WIN'],
    )

    const edit = await prisma.device_skill_edits.findFirst({
      where: { skill_id: 'skill-only-loser' },
    })
    assert.equal(edit?.device_id, 'WIN')

    const mat = await prisma.device_skill_materializations.findUnique({
      where: {
        device_id_skill_slug_runtime: {
          device_id: 'WIN',
          skill_slug: 'skill-a',
          runtime: 'claude-code',
        },
      },
    })
    assert.equal(mat?.reported_at, 5)

    const winner = await prisma.devices.findUnique({ where: { id: 'WIN' } })
    assert.deepEqual(JSON.parse(winner!.client_kinds!).sort(), ['cli', 'desktop'])

    const session = await prisma.sessions.findUnique({ where: { id: 'S-LOSE' } })
    assert.ok(session?.revoked_at != null)
  })

  it('keeps winner edit and newer materialization on conflict', async () => {
    await resetMysqlRegistry(prisma)
    await prisma.users.create({ data: { id: 'U1', handle: 'alice-merge' } })
    await seedDevice('WIN2', [])
    await seedDevice('LOSE2', [])
    await prisma.device_skill_edits.create({
      data: {
        device_id: 'WIN2',
        user_id: 'U1',
        skill_id: 'shared-skill',
        baseline_hash: 'h-winner',
      },
    })
    await prisma.device_skill_edits.create({
      data: {
        device_id: 'LOSE2',
        user_id: 'U1',
        skill_id: 'shared-skill',
        baseline_hash: 'h-loser',
      },
    })
    await prisma.device_skill_materializations.create({
      data: {
        device_id: 'WIN2',
        skill_slug: 'skill-b',
        runtime: 'claude-code',
        status: 'materialized',
        reported_at: 10,
      },
    })
    await prisma.device_skill_materializations.create({
      data: {
        device_id: 'LOSE2',
        skill_slug: 'skill-b',
        runtime: 'claude-code',
        status: 'materialized',
        reported_at: 20,
      },
    })

    const now = Math.floor(Date.now() / 1000)
    await runPrismaTransaction(prisma, async (tx) => {
      await mergeDeviceIntoPrisma(tx, 'WIN2', 'LOSE2', now)
    })

    const edits = await prisma.device_skill_edits.findMany({
      where: { skill_id: 'shared-skill' },
    })
    assert.equal(edits.length, 1)
    assert.equal(edits[0]?.device_id, 'WIN2')
    assert.equal(edits[0]?.baseline_hash, 'h-winner')

    const mat = await prisma.device_skill_materializations.findUnique({
      where: {
        device_id_skill_slug_runtime: {
          device_id: 'WIN2',
          skill_slug: 'skill-b',
          runtime: 'claude-code',
        },
      },
    })
    assert.equal(mat?.reported_at, 20)
  })
})
