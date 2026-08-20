// U4 remainder: publish-path Prisma leaf helpers against MySQL.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import type { PrismaClient } from '@prisma/client'
import { newId } from '../src/db/index.js'
import { deriveVersionLabelPrisma } from '../src/version-label.js'
import {
  getSkillForPublishPrisma,
  insertSkillOnPublishPrisma,
  insertSkillVersionFilesPrisma,
  insertSkillVersionOnPublishPrisma,
  persistVersionScanPrisma,
  republishUpdateSkillVisibilityPrisma,
  skillVersionExistsPrisma,
  updateSkillLatestOnPublishPrisma,
  updateSkillVisibilityPrisma,
} from '../src/lib/skill-publish.js'
import { CAPABILITY_VERSION } from '../src/scanner/capabilities/scan.js'
import { DETECTOR_CORPUS_VERSION } from '../src/scanner/cache.js'
import { addSkillVersionPrisma } from './helpers.js'
import {
  ensureMysqlMigrated,
  freshMysqlPrisma,
  resetMysqlRegistry,
  mysqlTestsEnabled
} from './mysql-test-env.js'

const hasDatabaseUrl = mysqlTestsEnabled()

describe('publish mysql (U4 remainder)', { skip: !hasDatabaseUrl }, () => {
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

  async function ensureAuthor(author: string): Promise<void> {
    await prisma.authors.createMany({
      data: [{ id: author, name: author }],
      skipDuplicates: true,
    })
  }

  it('getSkillForPublishPrisma and skillVersionExistsPrisma reflect seeded rows', async () => {
    await reset()
    const author = 'publisher'
    const slug = 'tool'
    const hash = 'sha256:pub-v1'
    const skillId = `${author}:${slug}`

    await ensureAuthor(author)
    await addSkillVersionPrisma(prisma, author, slug, hash, 1000)

    const skill = await getSkillForPublishPrisma(prisma, skillId)
    assert.ok(skill)
    assert.equal(skill.latest_hash, hash)
    assert.equal(skill.visibility, 'public')
    assert.equal(skill.moderation_status, 'none')

    assert.equal(await skillVersionExistsPrisma(prisma, skillId, hash), true)
    assert.equal(await skillVersionExistsPrisma(prisma, skillId, 'sha256:missing'), false)
  })

  it('updateSkillVisibilityPrisma flips private to public on idempotent republish', async () => {
    await reset()
    const author = 'alice'
    const slug = 'hidden'
    const hash = 'sha256:same-bytes'
    const skillId = `${author}:${slug}`

    await ensureAuthor(author)
    await addSkillVersionPrisma(prisma, author, slug, hash, 1000)
    await prisma.skills.update({ where: { id: skillId }, data: { visibility: 'private' } })

    await updateSkillVisibilityPrisma(prisma, skillId, 'public')

    const skill = await prisma.skills.findUnique({ where: { id: skillId } })
    assert.equal(skill?.visibility, 'public')
    assert.equal(await skillVersionExistsPrisma(prisma, skillId, hash), true)
  })

  it('insertSkillOnPublishPrisma + version insert mirrors publish txn leaves', async () => {
    await reset()
    const userId = newId()
    const author = 'new-author'
    const slug = 'fresh'
    const skillId = `${author}:${slug}`
    const versionHash = 'sha256:fresh-v1'
    const blobHash = 'sha256:skill-md'

    await prisma.users.create({ data: { id: userId, handle: author } })
    await ensureAuthor(author)
    await prisma.blobs.create({ data: { hash: blobHash, size: 12 } })

    await insertSkillOnPublishPrisma(prisma, {
      skillId,
      authorId: author,
      slug,
      description: 'A new skill',
      visibility: 'private',
      createdByUserId: userId,
      orgId: null,
      sourceRepo: null,
      sourceUrl: null,
    })

    const { label } = await deriveVersionLabelPrisma(prisma, skillId, 'major')
    await insertSkillVersionOnPublishPrisma(prisma, {
      versionHash,
      skillId,
      signatureAlg: 'ed25519',
      signatureKeyId: 'kid-1',
      signatureB64: 'sig-b64',
      authorKeyId: 'primary-kid',
      sigVersion: 1,
      delegationJson: null,
      label,
      metadataJson: JSON.stringify({ eval: 'clean' }),
      publishedBy: author,
      tokenCount: 140,
      tokenAmbient: 20,
      tokenBundle: null,
      tokenMethod: 'gpt-tokenizer-o200k',
    })
    await insertSkillVersionFilesPrisma(prisma, skillId, versionHash, [
      { path: 'SKILL.md', blobHash },
    ])
    await updateSkillLatestOnPublishPrisma(prisma, skillId, versionHash, 'Updated desc')

    const skill = await getSkillForPublishPrisma(prisma, skillId)
    assert.ok(skill)
    assert.equal(skill.latest_hash, versionHash)
    assert.equal(skill.visibility, 'private')

    const version = await prisma.skill_versions.findUnique({
      where: { skill_id_hash: { skill_id: skillId, hash: versionHash } },
    })
    assert.ok(version)
    assert.equal(version.major, 1)
    assert.equal(version.published_by, author)
    // Context-weight metering (U3): token columns persist on the version row.
    assert.equal(version.token_count, 140)
    assert.equal(version.token_ambient, 20)
    assert.equal(version.token_bundle, null)
    assert.equal(version.token_method, 'gpt-tokenizer-o200k')

    const files = await prisma.skill_version_files.findMany({ where: { skill_id: skillId } })
    assert.equal(files.length, 1)
    assert.equal(files[0]?.path, 'SKILL.md')

    await republishUpdateSkillVisibilityPrisma(prisma, skillId, 'public')
    const publicSkill = await prisma.skills.findUnique({ where: { id: skillId } })
    assert.equal(publicSkill?.visibility, 'public')
  })

  it('persistVersionScanPrisma stamps capabilities_version and rebalances quarantined latest', async () => {
    await reset()
    const author = 'scan-author'
    const slug = 'live-skill'
    const skillId = `${author}:${slug}`
    const cleanHash = 'sha256:clean-v1'
    const badHash = 'sha256:bad-v2'

    await ensureAuthor(author)
    await addSkillVersionPrisma(prisma, author, slug, cleanHash, 1000, {
      major: 1,
      minor: 0,
      patch: 0,
    })
    await addSkillVersionPrisma(prisma, author, slug, badHash, 2000, {
      major: 1,
      minor: 0,
      patch: 1,
    })
    await prisma.skills.update({ where: { id: skillId }, data: { latest_hash: badHash } })

    await persistVersionScanPrisma(
      prisma,
      skillId,
      cleanHash,
      'clean',
      JSON.stringify({ findings: [], summary: { total: 0 } }),
      '{"capabilities":[]}',
    )
    const cleanScan = await prisma.skill_version_scans.findUnique({
      where: {
        skill_id_skill_version_id: { skill_id: skillId, skill_version_id: cleanHash },
      },
    })
    assert.equal(cleanScan?.capabilities_json, '{"capabilities":[]}')
    assert.equal(cleanScan?.capabilities_version, CAPABILITY_VERSION)
    // Threat lane is stamped alongside status/findings on every write.
    assert.equal(cleanScan?.detector_corpus_version, DETECTOR_CORPUS_VERSION)

    await persistVersionScanPrisma(
      prisma,
      skillId,
      badHash,
      'quarantined',
      JSON.stringify({ findings: [{ category: 'exec' }], summary: { total: 1 } }),
      null,
    )
    const afterNullCaps = await prisma.skill_version_scans.findUnique({
      where: {
        skill_id_skill_version_id: { skill_id: skillId, skill_version_id: badHash },
      },
    })
    assert.equal(afterNullCaps?.status, 'quarantined')
    assert.equal(afterNullCaps?.capabilities_json, null)
    assert.equal(afterNullCaps?.capabilities_version, null)
    // Caps stay untouched, but the threat lane is still stamped (sync shape).
    assert.equal(afterNullCaps?.detector_corpus_version, DETECTOR_CORPUS_VERSION)

    const skill = await prisma.skills.findUnique({ where: { id: skillId } })
    assert.equal(skill?.latest_hash, cleanHash)

    const notice = await prisma.version_scan_notices.findUnique({
      where: { version_hash: badHash },
    })
    assert.ok(notice)
    assert.equal(notice.reason, 'quarantined')
    assert.equal(notice.author_id, author)
  })
})
