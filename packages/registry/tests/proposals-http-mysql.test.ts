// We exercise U4 Wave A proposal HTTP paths against MySQL via freshMysqlServer.
import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { canonicalContentHash, decodeBundle, type BundleFiles } from '@skillet/protocol'
import {
  addSkillVersionPrisma,
  freshMysqlServer,
  mint,
  type Handle,
} from './helpers.js'
import {
  createTestPrismaClient,
  mysqlTestsEnabled,
  resetMysqlRegistry,
} from './mysql-test-env.js'

const hasDatabaseUrl = mysqlTestsEnabled()
const proposalFiles: BundleFiles = {
  'SKILL.md': { enc: 'utf8', data: '---\nname: Empty Inbox\n---\n# Proposed\n' },
}

describe('proposals http mysql (U4 Wave A)', { skip: !hasDatabaseUrl }, () => {
  let h: Handle

  before(async () => {
    h = await freshMysqlServer()
  })

  after(async () => {
    await h?.app.close()
  })

  it('lists an empty proposal collection from MySQL', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)
      const owner = await mint(h)
      const { publicKey } = generateKeyPairSync('ed25519')
      const jwk = publicKey.export({ format: 'jwk' }) as { x: string }
      const publicBytes = Buffer.from(jwk.x, 'base64url')
      const claimRes = await h.app.inject({
        method: 'POST',
        url: '/api/v1/claim',
        headers: { authorization: `Bearer ${owner.session_token}` },
        payload: {
          handle: 'proposal-owner',
          public_key: publicBytes.toString('base64'),
          key_id: createHash('sha256').update(publicBytes).digest('hex'),
        },
      })
      assert.equal(claimRes.statusCode, 201, claimRes.body)
      await addSkillVersionPrisma(
        prisma,
        'proposal-owner',
        'empty-inbox',
        'sha256:proposal-http-base',
        1_700_000_000,
      )

      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/skills/proposal-owner/empty-inbox/proposals',
        headers: { authorization: `Bearer ${owner.session_token}` },
      })

      assert.equal(res.statusCode, 200, res.body)
      assert.deepEqual(res.json(), { proposals: [] })
    } finally {
      await prisma.$disconnect()
    }
  })

  it('creates, reads, and rejects a proposal through Prisma', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)
      const owner = await mint(h)
      const { publicKey, privateKey } = generateKeyPairSync('ed25519')
      const jwk = publicKey.export({ format: 'jwk' }) as { x: string }
      const publicBytes = Buffer.from(jwk.x, 'base64url')
      const keyId = createHash('sha256').update(publicBytes).digest('hex')
      const claimRes = await h.app.inject({
        method: 'POST',
        url: '/api/v1/claim',
        headers: { authorization: `Bearer ${owner.session_token}` },
        payload: {
          handle: 'proposal-owner',
          public_key: publicBytes.toString('base64'),
          key_id: keyId,
        },
      })
      assert.equal(claimRes.statusCode, 201, claimRes.body)

      const baseHash = 'sha256:proposal-http-base'
      await addSkillVersionPrisma(
        prisma,
        'proposal-owner',
        'review-me',
        baseHash,
        1_700_000_000,
      )
      const proposedHash = canonicalContentHash(decodeBundle(proposalFiles))
      const signature = sign(null, Buffer.from(proposedHash, 'utf8'), privateKey).toString('base64')
      const auth = { authorization: `Bearer ${owner.session_token}` }

      const createRes = await h.app.inject({
        method: 'POST',
        url: '/api/v1/skills/proposal-owner/review-me/proposals',
        headers: auth,
        payload: {
          files: proposalFiles,
          base_hash: baseHash,
          signature: { alg: 'ed25519', key_id: keyId, sig: signature },
        },
      })
      assert.equal(createRes.statusCode, 201, createRes.body)
      const created = createRes.json() as { proposal_id: string; state: string }
      assert.equal(created.state, 'pending')

      const detailRes = await h.app.inject({
        method: 'GET',
        url: `/api/v1/skills/proposal-owner/review-me/proposals/${created.proposal_id}`,
        headers: auth,
      })
      assert.equal(detailRes.statusCode, 200, detailRes.body)
      const detail = detailRes.json() as { proposed_hash: string; state: string }
      assert.equal(detail.proposed_hash, proposedHash)
      assert.equal(detail.state, 'pending')

      const rejectRes = await h.app.inject({
        method: 'POST',
        url: `/api/v1/skills/proposal-owner/review-me/proposals/${created.proposal_id}/decision`,
        headers: auth,
        payload: { decision: 'reject', note: 'Needs another pass' },
      })
      assert.equal(rejectRes.statusCode, 200, rejectRes.body)
      assert.equal((rejectRes.json() as { state: string }).state, 'rejected')

      const persisted = await prisma.skill_proposals.findUnique({
        where: { id: created.proposal_id },
      })
      assert.equal(persisted?.state, 'rejected')
      assert.equal(persisted?.decision_note, 'Needs another pass')
    } finally {
      await prisma.$disconnect()
    }
  })
})
