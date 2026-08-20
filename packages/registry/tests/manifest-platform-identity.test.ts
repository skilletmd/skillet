// U1 (key-rotation recovery plan): the manifest route serves author identity
// keyed to the SIGNER of the latest version, matching the version route. A
// platform-attested latest serves the platform key even when the handle is
// claimed, because core's pin recovery (fetchServedAuthorKey) reads this
// manifest and must receive the key that actually verifies served versions.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { addSkillVersionPrisma, freshMysqlServer, type Handle } from './helpers.js'
import {
  createTestPrismaClient,
  mysqlTestsEnabled,
  resetMysqlRegistry,
} from './mysql-test-env.js'
import { platformAttestationKeyPrisma } from '../src/lib/platform-signing.js'

const hasDatabaseUrl = mysqlTestsEnabled()

interface ManifestIdentity {
  author_key_id: string | null
  author_public_key: string | null
}

async function fetchManifestIdentity(h: Handle, author: string, slug: string) {
  const res = await h.app.inject({
    method: 'GET',
    url: `/api/v1/skills/${author}/${slug}/manifest`,
  })
  assert.equal(res.statusCode, 200, res.body)
  return res.json() as ManifestIdentity
}

describe('manifest platform identity (rotation recovery U1)', { skip: !hasDatabaseUrl }, () => {
  let h: Handle

  before(async () => {
    h = await freshMysqlServer()
  })

  after(async () => {
    await h?.app.close()
  })

  it('serves the platform key for a platform-attested unclaimed skill', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)
      await addSkillVersionPrisma(prisma, 'mirror-brand', 'tool', 'sha256:mi-1', 1_700_000_000)
      const platformKey = await platformAttestationKeyPrisma(prisma)
      await prisma.skill_versions.updateMany({
        where: { skill_id: 'mirror-brand:tool' },
        data: { author_key_id: platformKey.keyId },
      })

      const body = await fetchManifestIdentity(h, 'mirror-brand', 'tool')
      assert.equal(body.author_key_id, platformKey.keyId)
      assert.equal(body.author_public_key, platformKey.publicKeyB64)
    } finally {
      await prisma.$disconnect()
    }
  })

  it('serves the claimed key when the latest version is author-signed', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)
      await addSkillVersionPrisma(prisma, 'claimed-ann', 'kit', 'sha256:ca-1', 1_700_000_000)
      // Platform key exists but did not sign the latest version.
      await platformAttestationKeyPrisma(prisma)
      await prisma.users.create({
        data: {
          id: randomUUID(),
          handle: 'claimed-ann',
          author_key_id: 'a'.repeat(64),
          author_public_key: 'claimed-pub-base64',
        },
      })
      await prisma.skill_versions.updateMany({
        where: { skill_id: 'claimed-ann:kit' },
        data: { author_key_id: 'a'.repeat(64) },
      })

      const body = await fetchManifestIdentity(h, 'claimed-ann', 'kit')
      assert.equal(body.author_key_id, 'a'.repeat(64))
      assert.equal(body.author_public_key, 'claimed-pub-base64')
    } finally {
      await prisma.$disconnect()
    }
  })

  it('serves the platform key for a claimed handle whose latest version is platform-signed', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)
      await addSkillVersionPrisma(prisma, 'claimed-brand', 'mirror', 'sha256:cb-1', 1_700_000_000)
      const platformKey = await platformAttestationKeyPrisma(prisma)
      await prisma.users.create({
        data: {
          id: randomUUID(),
          handle: 'claimed-brand',
          author_key_id: 'b'.repeat(64),
          author_public_key: 'claimed-brand-pub',
        },
      })
      await prisma.skill_versions.updateMany({
        where: { skill_id: 'claimed-brand:mirror' },
        data: { author_key_id: platformKey.keyId },
      })

      // Signer of the latest version wins over claim status: the served
      // identity must verify the platform-signed envelope or pin recovery
      // loops on key_id_mismatch.
      const body = await fetchManifestIdentity(h, 'claimed-brand', 'mirror')
      assert.equal(body.author_key_id, platformKey.keyId)
      assert.equal(body.author_public_key, platformKey.publicKeyB64)
    } finally {
      await prisma.$disconnect()
    }
  })

  it('keeps nulls for an unclaimed author with no signed versions', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)
      await addSkillVersionPrisma(prisma, 'plain-anon', 'notes', 'sha256:pa-1', 1_700_000_000)
      await platformAttestationKeyPrisma(prisma)
      // author_key_id stays null on the version; no users row exists.

      const body = await fetchManifestIdentity(h, 'plain-anon', 'notes')
      assert.equal(body.author_key_id, null)
      assert.equal(body.author_public_key, null)
    } finally {
      await prisma.$disconnect()
    }
  })

  it('keeps nulls on the zero-versions edge (null latest_hash)', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)
      await prisma.authors.createMany({
        data: [{ id: 'empty-author', name: 'empty-author' }],
        skipDuplicates: true,
      })
      await prisma.skills.create({
        data: {
          id: 'empty-author:empty',
          author_id: 'empty-author',
          slug: 'empty',
          latest_hash: null,
          visibility: 'public',
        },
      })

      const body = await fetchManifestIdentity(h, 'empty-author', 'empty')
      assert.equal(body.author_key_id, null)
      assert.equal(body.author_public_key, null)
    } finally {
      await prisma.$disconnect()
    }
  })
})
