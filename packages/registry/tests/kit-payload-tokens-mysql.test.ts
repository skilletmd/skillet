import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import type { PrismaClient } from '@prisma/client'
import { addSkillVersionPrisma } from './helpers.js'
import { getKitPayloadPrisma } from '../src/lib/kit-payload.js'
import {
  createTestPrismaClient,
  mysqlTestsEnabled,
  resetMysqlRegistry,
} from './mysql-test-env.js'

const hasDatabaseUrl = mysqlTestsEnabled()

describe('kit token totals (mysql)', { skip: !hasDatabaseUrl }, () => {
  let prisma: PrismaClient

  before(() => {
    prisma = createTestPrismaClient()
  })
  after(async () => {
    await prisma.$disconnect()
  })

  async function setTokens(
    slug: string,
    hash: string,
    count: number | null,
    ambient: number | null,
  ): Promise<void> {
    await prisma.skill_versions.update({
      where: { skill_id_hash: { skill_id: `kt:${slug}`, hash } },
      data: {
        token_count: count,
        token_ambient: ambient,
        token_method: count != null ? 'gpt-tokenizer-o200k' : null,
      },
    })
  }

  async function makeKit(members: Array<{ slug: string; pinned?: string }>): Promise<Record<string, unknown>> {
    await prisma.kits.create({
      data: { id: 'kt-kit', owner_id: 'kt', name: 'Kit', slug: 'kit', visibility: 'public' },
    })
    for (const m of members) {
      await prisma.kit_skills.create({
        data: { kit_id: 'kt-kit', skill_id: `kt:${m.slug}`, added_at: 1_700_000_000, pinned_hash: m.pinned ?? null },
      })
    }
    return (await getKitPayloadPrisma(prisma, 'kt-kit', { draft: true })) as Record<string, unknown>
  }

  it('sums token_count and token_ambient across members', async () => {
    await resetMysqlRegistry(prisma)
    await addSkillVersionPrisma(prisma, 'kt', 'a', 'sha256:a1', 1_700_000_000)
    await addSkillVersionPrisma(prisma, 'kt', 'b', 'sha256:b1', 1_700_000_000)
    await setTokens('a', 'sha256:a1', 1000, 40)
    await setTokens('b', 'sha256:b1', 320, 44)

    const body = await makeKit([{ slug: 'a' }, { slug: 'b' }])
    assert.equal(body.kit_token_count, 1320)
    assert.equal(body.kit_token_ambient, 84)
  })

  it('omits kit totals when any member lacks token data (no misleading partial)', async () => {
    await resetMysqlRegistry(prisma)
    await addSkillVersionPrisma(prisma, 'kt', 'a', 'sha256:a1', 1_700_000_000)
    await addSkillVersionPrisma(prisma, 'kt', 'b', 'sha256:b1', 1_700_000_000)
    await setTokens('a', 'sha256:a1', 1000, 40)
    await setTokens('b', 'sha256:b1', null, null)

    const body = await makeKit([{ slug: 'a' }, { slug: 'b' }])
    assert.equal('kit_token_count' in body, false)
    assert.equal('kit_token_ambient' in body, false)
  })

  it('uses the pinned version tokens, not latest', async () => {
    await resetMysqlRegistry(prisma)
    await addSkillVersionPrisma(prisma, 'kt', 'a', 'sha256:a1', 1_700_000_000)
    await setTokens('a', 'sha256:a1', 1000, 40)
    // Newer latest version with a much larger count, which must be ignored.
    await prisma.skill_versions.create({
      data: {
        hash: 'sha256:a2',
        skill_id: 'kt:a',
        published_by: 'kt',
        published_at: 1_700_000_100,
        metadata_json: '{}',
        major: 2,
        token_count: 5000,
        token_ambient: 90,
        token_method: 'gpt-tokenizer-o200k',
      },
    })
    await prisma.skills.update({ where: { id: 'kt:a' }, data: { latest_hash: 'sha256:a2' } })

    const body = await makeKit([{ slug: 'a', pinned: 'sha256:a1' }])
    assert.equal(body.kit_token_count, 1000)
    assert.equal(body.kit_token_ambient, 40)
  })
})
