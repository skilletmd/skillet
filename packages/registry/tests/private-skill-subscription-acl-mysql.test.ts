// #461 — privatizing a skill (or a kit) must not leak it to prior public-kit
// subscribers. The read ACL's subscription grant used to hand read access to
// any skill inside a subscribed kit with no visibility re-check; since public
// skills are already granted earlier in canReadSkillPrisma, that branch only
// ever conveyed PRIVATE skills. These suites prove the branch is gone: a bare
// subscriber loses access the moment a skill goes private, while owners and
// explicit kit members keep it, and the now-private member stops leaking its
// id/category on discovery surfaces.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import {
  addSkillVersionPrisma,
  authOf,
  claim,
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

const AUTHOR = 'author-a'
const SECRET = 'secret'
const SECRET_ID = `${AUTHOR}:${SECRET}`
const SECRET_HASH = 'sha256:secret-v1'
const PUBLIC2 = 's2'
const PUBLIC2_ID = `${AUTHOR}:${PUBLIC2}`
const PUBLIC2_HASH = 'sha256:s2-v1'

describe('private-skill subscription ACL (#461)', { skip: !hasDatabaseUrl }, () => {
  let h: Handle

  before(async () => {
    h = await freshMysqlServer()
  })

  after(async () => {
    await h?.app.close()
  })

  it('a bare kit-subscriber loses read when a member skill is privatized; owner + kit member keep it', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)

      // Author A owns two public skills; kit K (public) curates both.
      const owner = await mint(h)
      await claim(h, owner, AUTHOR, 11)
      await addSkillVersionPrisma(prisma, AUTHOR, SECRET, SECRET_HASH, 1000)
      await addSkillVersionPrisma(prisma, AUTHOR, PUBLIC2, PUBLIC2_HASH, 1001)
      await prisma.kits.create({
        data: { id: 'kit-k', owner_id: AUTHOR, name: 'K', visibility: 'public', kind: 'manual', slug: 'k' },
      })
      await prisma.kit_skills.createMany({
        data: [
          { kit_id: 'kit-k', skill_id: SECRET_ID },
          { kit_id: 'kit-k', skill_id: PUBLIC2_ID },
        ],
      })

      // B only subscribes to K. M is an explicit accepted kit member.
      const sub = await mint(h)
      await claim(h, sub, 'subscriber-b', 12)
      await prisma.kit_subscriptions.create({
        data: { id: 'sub-b-k', user_id: sub.user_id, kind: 'kit', kit_id: 'kit-k' },
      })
      const member = await mint(h)
      await claim(h, member, 'member-m', 13)
      await prisma.kit_members.create({
        data: { kit_id: 'kit-k', user_id: member.user_id, accepted_at: 1000 },
      })

      const manifestUrl = `/api/v1/skills/${AUTHOR}/${SECRET}/manifest`

      // Control: while SECRET is public, the subscriber reads it (public, not the
      // subscription branch — but proves the endpoint + fixture are wired).
      const pre = await h.app.inject({ method: 'GET', url: manifestUrl, headers: authOf(sub) })
      assert.equal(pre.statusCode, 200, `subscriber should read a public skill: ${pre.body}`)

      // Privatize SECRET. It stays a member of public kit K (owner acted on the
      // skill, not the kit).
      await prisma.skills.update({ where: { id: SECRET_ID }, data: { visibility: 'private' } })

      // R1: the bare subscriber is now cut off across every content endpoint.
      for (const url of [
        manifestUrl,
        `/api/v1/skills/${AUTHOR}/${SECRET}/versions/${SECRET_HASH}`,
        `/api/v1/skills/${AUTHOR}/${SECRET}/download`,
        `/api/v1/sync/content/${SECRET_HASH}`,
      ]) {
        const res = await h.app.inject({ method: 'GET', url, headers: authOf(sub) })
        assert.equal(res.statusCode, 404, `subscriber must 404 on ${url} after privatize: ${res.statusCode} ${res.body}`)
      }

      // R2: legitimate access is preserved through the owner + kit-member branches.
      const ownerRead = await h.app.inject({ method: 'GET', url: manifestUrl, headers: authOf(owner) })
      assert.equal(ownerRead.statusCode, 200, `owner must still read: ${ownerRead.body}`)
      const memberRead = await h.app.inject({ method: 'GET', url: manifestUrl, headers: authOf(member) })
      assert.equal(memberRead.statusCode, 200, `explicit kit member must still read: ${memberRead.body}`)
      // (The org-access branch is unchanged by this fix, so it is not re-proven here.)
    } finally {
      await prisma.$disconnect()
    }
  })

  it('a now-private member is absent from discover/kits and the /kits member list (R5)', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)

      const owner = await mint(h)
      await claim(h, owner, AUTHOR, 11)
      await addSkillVersionPrisma(prisma, AUTHOR, SECRET, SECRET_HASH, 1000)
      await addSkillVersionPrisma(prisma, AUTHOR, PUBLIC2, PUBLIC2_HASH, 1001)
      await prisma.kits.create({
        data: { id: 'kit-k', owner_id: AUTHOR, name: 'K', visibility: 'public', kind: 'manual', slug: 'k' },
      })
      await prisma.kit_skills.createMany({
        data: [
          { kit_id: 'kit-k', skill_id: SECRET_ID },
          { kit_id: 'kit-k', skill_id: PUBLIC2_ID },
        ],
      })

      await prisma.skills.update({ where: { id: SECRET_ID }, data: { visibility: 'private' } })

      // discover/kits: K appears (public), but only lists the public member.
      const disc = await h.app.inject({ method: 'GET', url: '/api/v1/discover/kits' })
      assert.equal(disc.statusCode, 200, disc.body)
      const discBody = disc.json() as { kits?: Array<Record<string, unknown>>; items?: Array<Record<string, unknown>> }
      const kits = (discBody.kits ?? discBody.items ?? []) as Array<{ id: string; skill_ids: string[]; skill_count: number }>
      const k = kits.find((row) => row.id === 'kit-k')
      assert.ok(k, 'kit K should be discoverable')
      assert.ok(!k!.skill_ids.includes(SECRET_ID), 'now-private member id must not leak in discover/kits')
      assert.ok(k!.skill_ids.includes(PUBLIC2_ID), 'public member should still be listed')
      assert.equal(k!.skill_count, 1, 'skill_count must count public members only (no differencing oracle)')

      // /skills/:a/:s/kits for the still-public S2: K's inner member list excludes SECRET.
      const kitsFor = await h.app.inject({ method: 'GET', url: `/api/v1/skills/${AUTHOR}/${PUBLIC2}/kits` })
      assert.equal(kitsFor.statusCode, 200, kitsFor.body)
      const kf = kitsFor.json() as { kits: Array<{ id: string; skill_ids: string[] }> }
      const kEntry = kf.kits.find((row) => row.id === 'kit-k')
      assert.ok(kEntry, 'K should be listed as a kit containing S2')
      assert.ok(!kEntry!.skill_ids.includes(SECRET_ID), 'now-private member id must not leak in /skills/:a/:s/kits')
    } finally {
      await prisma.$disconnect()
    }
  })

  it('kit privatization variant: a private skill added to a now-private kit does not leak to its public-era subscriber (R4)', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)

      const owner = await mint(h)
      await claim(h, owner, AUTHOR, 11)
      await prisma.kits.create({
        data: { id: 'kit-k2', owner_id: AUTHOR, name: 'K2', visibility: 'public', kind: 'manual', slug: 'k2' },
      })

      // B subscribes while K2 is public.
      const sub = await mint(h)
      await claim(h, sub, 'subscriber-b', 12)
      await prisma.kit_subscriptions.create({
        data: { id: 'sub-b-k2', user_id: sub.user_id, kind: 'kit', kit_id: 'kit-k2' },
      })

      // Owner flips K2 private, then adds a NEW private skill P to it.
      await prisma.kits.update({ where: { id: 'kit-k2' }, data: { visibility: 'private' } })
      await addSkillVersionPrisma(prisma, AUTHOR, 'p', 'sha256:p-v1', 1002)
      await prisma.skills.update({ where: { id: `${AUTHOR}:p` }, data: { visibility: 'private' } })
      await prisma.kit_skills.create({ data: { kit_id: 'kit-k2', skill_id: `${AUTHOR}:p` } })

      // The public-era subscriber (not a member) must not read P.
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/skills/${AUTHOR}/p/manifest`,
        headers: authOf(sub),
      })
      assert.equal(res.statusCode, 404, `public-era subscriber must not read a private skill in a now-private kit: ${res.body}`)
    } finally {
      await prisma.$disconnect()
    }
  })
})
