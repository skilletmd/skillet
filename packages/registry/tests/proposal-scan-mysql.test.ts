// U3: proposal scan Prisma twin must not fall through to sqlite when there is
// no in-memory bundle (rescan from proposal_files + blob store).
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { newId } from '../src/db/index.js'
import { MemoryBlobStore } from '../src/blob-store/memory-blob-store.js'
import { runScanForProposalPrisma } from '../src/scanner/runner.js'
import {
  ensureMysqlMigrated,
  freshMysqlPrisma,
  resetMysqlRegistry,
  mysqlTestsEnabled,
} from './mysql-test-env.js'
import type { PrismaClient } from '@prisma/client'

const hasDatabaseUrl = mysqlTestsEnabled()

describe('proposal scan mysql (U3)', { skip: !hasDatabaseUrl }, () => {
  let prisma: PrismaClient

  before(async () => {
    await ensureMysqlMigrated()
    prisma = await freshMysqlPrisma()
  })

  after(async () => {
    await prisma?.$disconnect()
  })

  it('runScanForProposalPrisma reads proposal_files and upserts proposal_scans', async () => {
    await resetMysqlRegistry(prisma)
    const author = 'prop-scan'
    const slug = 'target'
    const skillId = `${author}:${slug}`
    const proposalId = newId()
    const skillMd = '---\nname: Proposed\n---\n# Ok\n'
    const blobHash = `sha256:${createHash('sha256').update(skillMd).digest('hex')}`
    const blobStore = new MemoryBlobStore()
    await blobStore.put(blobHash, new TextEncoder().encode(skillMd))

    await prisma.authors.create({ data: { id: author, name: author } })
    await prisma.users.create({ data: { id: newId(), handle: author } })
    await prisma.skills.create({
      data: {
        id: skillId,
        author_id: author,
        slug,
        visibility: 'public',
        latest_hash: null,
      },
    })
    await prisma.blobs.create({ data: { hash: blobHash, size: skillMd.length } })
    await prisma.skill_proposals.create({
      data: {
        id: proposalId,
        skill_id: skillId,
        base_hash: 'sha256:base',
        proposed_hash: 'sha256:proposed',
        proposer_author_id: author,
        signature_alg: 'ed25519',
        signature_key_id: 'kid',
        signature_b64: 'sig',
      },
    })
    await prisma.proposal_files.create({
      data: { proposal_id: proposalId, path: 'SKILL.md', blob_hash: blobHash },
    })
    await prisma.proposal_scans.create({
      data: {
        proposal_id: proposalId,
        status: 'pending',
        findings_json: '[]',
        scanned_at: null,
      },
    })

    const result = await runScanForProposalPrisma(prisma, blobStore, proposalId)
    assert.ok(result)
    assert.equal(typeof result.status, 'string')

    const scan = await prisma.proposal_scans.findUnique({
      where: { proposal_id: proposalId },
    })
    assert.ok(scan)
    assert.equal(scan.status, result.status)
    assert.notEqual(scan.status, 'pending')
    assert.ok(scan.scanned_at != null)
  })
})
