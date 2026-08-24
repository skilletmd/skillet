// Two-lane scan backfill: version-gated selection, keyset paging, missing-bundle
// skip, and idempotence. The recompute+persist path itself is the shared publish
// path (proven by publish-mysql + the shipped catalog re-scan); these tests pin
// the backfill's own new logic. Live MySQL only (SKILLET_MYSQL_TESTS=1).
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import type { PrismaClient } from '@prisma/client'
import { CAPABILITY_VERSION } from '../src/scanner/capabilities/scan.js'
import { DETECTOR_CORPUS_VERSION } from '../src/scanner/cache.js'
import { createPrismaBlobStore } from '../src/blob-store/create-blob-store.js'
import { MemoryBlobStore } from '../src/blob-store/memory-blob-store.js'
import { blobHash } from '../src/db/index.js'
import { canonicalContentHash } from '@skillet/protocol'
import {
  countTargetsPrisma,
  selectTargetBatchPrisma,
  processRowPrisma,
  backfillScansPrisma,
} from '../src/scanner/backfill-scans.js'
import { addSkillVersionPrisma } from './helpers.js'
import {
  ensureMysqlMigrated,
  freshMysqlPrisma,
  resetMysqlRegistry,
  mysqlTestsEnabled,
} from './mysql-test-env.js'

const hasDatabaseUrl = mysqlTestsEnabled()

describe('scan backfill (two-lane) mysql', { skip: !hasDatabaseUrl }, () => {
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

  async function seed(
    author: string,
    slug: string,
    hash: string,
    capV: number | null,
    detV: number | null,
    order: number,
  ): Promise<void> {
    await prisma.authors.createMany({ data: [{ id: author, name: author }], skipDuplicates: true })
    await addSkillVersionPrisma(prisma, author, slug, hash, order)
    await prisma.skill_version_scans.create({
      data: {
        skill_id: `${author}:${slug}`,
        skill_version_id: hash,
        status: 'clean',
        findings_json: '{"findings":[],"summary":{"total":0}}',
        scanned_at: 1000,
        capabilities_json: capV == null ? null : '{"capabilities":[]}',
        capabilities_version: capV,
        detector_corpus_version: detV,
      },
    })
  }

  it('selects rows stale on either lane; --all selects everything', async () => {
    await reset()
    await seed('a', 'current', 'sha256:cur', CAPABILITY_VERSION, DETECTOR_CORPUS_VERSION, 1)
    await seed('a', 'stale-cap', 'sha256:cap', CAPABILITY_VERSION - 1, DETECTOR_CORPUS_VERSION, 2)
    await seed('a', 'stale-det', 'sha256:det', CAPABILITY_VERSION, DETECTOR_CORPUS_VERSION - 1, 3)
    await seed('a', 'never', 'sha256:nul', null, null, 4)

    assert.equal(await countTargetsPrisma(prisma, false), 3)
    assert.equal(await countTargetsPrisma(prisma, true), 4)

    const stale = await selectTargetBatchPrisma(prisma, false, null, 100)
    const ids = stale.map((r) => r.skill_version_id).sort()
    assert.deepEqual(ids, ['sha256:cap', 'sha256:det', 'sha256:nul'])
    assert.ok(!ids.includes('sha256:cur'), 'a fully-current row is never targeted')
  })

  it('keyset cursor pages without overlap and covers every stale row', async () => {
    await reset()
    await seed('b', 'one', 'sha256:aaa', null, null, 1)
    await seed('b', 'two', 'sha256:bbb', null, null, 2)
    await seed('b', 'three', 'sha256:ccc', null, null, 3)

    const first = await selectTargetBatchPrisma(prisma, false, null, 2)
    assert.equal(first.length, 2)
    const second = await selectTargetBatchPrisma(prisma, false, first[first.length - 1], 2)

    const firstIds = new Set(first.map((r) => r.skill_version_id))
    for (const r of second) assert.ok(!firstIds.has(r.skill_version_id), 'no cursor overlap')
    const union = new Set([...first, ...second].map((r) => r.skill_version_id))
    assert.equal(union.size, 3, 'union covers all three stale rows')
  })

  it('missing bundle is a counted skip, never a write', async () => {
    await reset()
    await seed('c', 'noblob', 'sha256:noblob', null, null, 1)
    const blobStore = createPrismaBlobStore(prisma)

    const outcome = await processRowPrisma(
      prisma,
      blobStore,
      { skill_id: 'c:noblob', skill_version_id: 'sha256:noblob', capabilities_version: null, detector_corpus_version: null },
      false,
    )
    assert.equal(outcome, 'skipped-unavailable')

    const row = await prisma.skill_version_scans.findUnique({
      where: { skill_id_skill_version_id: { skill_id: 'c:noblob', skill_version_id: 'sha256:noblob' } },
    })
    assert.equal(row?.detector_corpus_version, null, 'row left untouched')
  })

  it('a fully-current catalog targets zero rows and drains immediately', async () => {
    await reset()
    await seed('d', 'cur1', 'sha256:d1', CAPABILITY_VERSION, DETECTOR_CORPUS_VERSION, 1)
    await seed('d', 'cur2', 'sha256:d2', CAPABILITY_VERSION, DETECTOR_CORPUS_VERSION, 2)
    const blobStore = createPrismaBlobStore(prisma)

    const result = await backfillScansPrisma(prisma, { blobStore })
    assert.equal(result.targeted, 0)
    assert.equal(result.processed, 0)
  })

  it('recompute advances both lane versions and counts the row refreshed', async () => {
    await reset()
    const store = new MemoryBlobStore(undefined, prisma)
    const bytes = new TextEncoder().encode('# Tool\n\nDoes a thing for tests.\n')
    const bhash = blobHash(bytes)
    await store.put(bhash, bytes)
    // The version id must be the bundle's canonical content hash — loadBundle
    // verifies the reassembled bundle against it.
    const versionHash = canonicalContentHash(new Map([['SKILL.md', bytes]]))

    // A stale scan row (both lanes NULL) whose bundle is reconstructable.
    await seed('f', 'real', versionHash, null, null, 1)
    await prisma.skill_version_files.create({
      data: { skill_id: 'f:real', version_hash: versionHash, path: 'SKILL.md', blob_hash: bhash },
    })

    const result = await backfillScansPrisma(prisma, { blobStore: store })
    assert.equal(result.refreshed, 1)
    assert.equal(result.skippedUnavailable, 0)

    const row = await prisma.skill_version_scans.findUnique({
      where: { skill_id_skill_version_id: { skill_id: 'f:real', skill_version_id: versionHash } },
    })
    assert.equal(row?.detector_corpus_version, DETECTOR_CORPUS_VERSION)
    assert.equal(row?.capabilities_version, CAPABILITY_VERSION)

    // Idempotent: the now-current row is no longer a target.
    assert.equal(await countTargetsPrisma(prisma, false), 0)
  })

  it('pages correctly when two skills share a version hash (PK tiebreak)', async () => {
    await reset()
    // Same content hash, two different skills → two rows sharing skill_version_id.
    await seed('g', 'alpha', 'sha256:shared', null, null, 1)
    await seed('h', 'beta', 'sha256:shared', null, null, 1)

    assert.equal(await countTargetsPrisma(prisma, false), 2)
    const first = await selectTargetBatchPrisma(prisma, false, null, 1)
    assert.equal(first.length, 1)
    const second = await selectTargetBatchPrisma(prisma, false, first[0], 1)
    assert.equal(second.length, 1)
    // The two rows are distinct (different skill_id), never the same row twice.
    assert.notEqual(first[0].skill_id, second[0].skill_id)
    const third = await selectTargetBatchPrisma(prisma, false, second[0], 1)
    assert.equal(third.length, 0)
  })

  it('a stale catalog with no blobs drains via the keyset without looping', async () => {
    await reset()
    await seed('e', 'x1', 'sha256:e1', null, null, 1)
    await seed('e', 'x2', 'sha256:e2', null, null, 2)
    const blobStore = createPrismaBlobStore(prisma)

    const result = await backfillScansPrisma(prisma, { blobStore, batch: 1 })
    assert.equal(result.targeted, 2)
    assert.equal(result.processed, 2)
    assert.equal(result.skippedUnavailable, 2)
    assert.equal(result.refreshed, 0)
  })
  // Refreshing the scan row is only half the job: `skills.latest_hash` is the
  // servable pointer, and sync recomputes it on CONTENT change only. Before this,
  // a corpus improvement that cleared a quarantine left the skill exactly as
  // unservable as before — clean scan, NULL pointer, viewer hidden. That is what
  // happened to K-Dense's paper-lookup on the corpus 17 -> 18 bump.
  it('reconciles latest_hash when a refresh clears a quarantine', async () => {
    await reset()
    const store = new MemoryBlobStore(undefined, prisma)
    const bytes = new TextEncoder().encode('# Tool\n\nDoes a thing for tests.\n')
    const bhash = blobHash(bytes)
    await store.put(bhash, bytes)
    const versionHash = canonicalContentHash(new Map([['SKILL.md', bytes]]))

    await seed('h', 'freed', versionHash, null, null, 1)
    await prisma.skill_version_files.create({
      data: { skill_id: 'h:freed', version_hash: versionHash, path: 'SKILL.md', blob_hash: bhash },
    })
    // The state a quarantine leaves behind: no servable pointer.
    await prisma.skill_version_scans.update({
      where: { skill_id_skill_version_id: { skill_id: 'h:freed', skill_version_id: versionHash } },
      data: { status: 'quarantined' },
    })
    await prisma.skills.update({ where: { id: 'h:freed' }, data: { latest_hash: null } })

    // The bundle is benign, so the re-scan comes back clean and the pointer must
    // follow it back.
    const result = await backfillScansPrisma(prisma, { blobStore: store })
    assert.equal(result.refreshed, 1)
    assert.equal(result.reconciled, 1)

    const skill = await prisma.skills.findUnique({ where: { id: 'h:freed' }, select: { latest_hash: true } })
    assert.equal(skill?.latest_hash, versionHash, 'latest_hash follows the cleared scan')
  })

  it('a dry run reconciles nothing', async () => {
    await reset()
    const store = new MemoryBlobStore(undefined, prisma)
    const bytes = new TextEncoder().encode('# Tool\n\nDoes a thing for tests.\n')
    const bhash = blobHash(bytes)
    await store.put(bhash, bytes)
    const versionHash = canonicalContentHash(new Map([['SKILL.md', bytes]]))
    await seed('i', 'dry', versionHash, null, null, 1)
    await prisma.skill_version_files.create({
      data: { skill_id: 'i:dry', version_hash: versionHash, path: 'SKILL.md', blob_hash: bhash },
    })
    await prisma.skills.update({ where: { id: 'i:dry' }, data: { latest_hash: null } })

    const result = await backfillScansPrisma(prisma, { blobStore: store, dryRun: true })
    assert.equal(result.reconciled, 0)
    const skill = await prisma.skills.findUnique({ where: { id: 'i:dry' }, select: { latest_hash: true } })
    assert.equal(skill?.latest_hash, null, 'a dry run leaves the pointer alone')
  })
})
