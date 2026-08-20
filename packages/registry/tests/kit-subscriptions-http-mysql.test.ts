// U4: kits/mine + author subscribe paths against MySQL via freshMysqlServer.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import {
  addSkillVersionPrisma,
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
import { newId } from '../src/db/index.js'

const hasDatabaseUrl = mysqlTestsEnabled()

describe('kit subscriptions http mysql (U4)', { skip: !hasDatabaseUrl }, () => {
  let h: Handle

  before(async () => {
    h = await freshMysqlServer()
  })

  after(async () => {
    await h?.app.close()
  })

  it('provisions Saved on /kits/mine and supports author subscribe round-trip', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)

      const alice = await mint(h)
      const bob = await mint(h)
      await claim(h, alice, 'alice-kit', 11)
      await claim(h, bob, 'bob-kit', 12)

      await addSkillVersionPrisma(
        prisma,
        'alice-kit',
        'hello',
        'sha256:' + 'a'.repeat(64),
        Math.floor(Date.now() / 1000),
      )

      const mine = await h.app.inject({
        method: 'GET',
        url: '/api/v1/kits/mine',
        headers: { authorization: `Bearer ${bob.session_token}` },
      })
      assert.equal(mine.statusCode, 200, mine.body)
      const mineBody = mine.json() as {
        owned: Array<{ kind?: string; slug?: string; name?: string }>
        author_kits: Array<{ owner: string; self: boolean }>
      }
      assert.ok(
        mineBody.owned.some((k) => k.kind === 'saved' || k.slug === 'saved' || k.name === 'Saved'),
        `expected Saved kit in owned: ${mine.body}`,
      )
      assert.ok(
        mineBody.author_kits.some((k) => k.owner === 'bob-kit' && k.self === true),
        `expected self author-kit: ${mine.body}`,
      )

      const savedRow = await prisma.kits.findFirst({
        where: { owner_id: 'bob-kit', kind: 'saved' },
      })
      assert.ok(savedRow, 'Saved kit should land in MySQL')

      const sub = await h.app.inject({
        method: 'POST',
        url: '/api/v1/authors/alice-kit/subscribe',
        headers: { authorization: `Bearer ${bob.session_token}` },
      })
      assert.equal(sub.statusCode, 201, sub.body)

      const authSub = await prisma.kit_subscriptions.findFirst({
        where: { user_id: bob.user_id, kind: 'author', author_id: 'alice-kit' },
      })
      assert.ok(authSub, 'author subscription should land in MySQL')

      const authorKit = await h.app.inject({
        method: 'GET',
        url: '/api/v1/authors/alice-kit/kit',
        headers: { authorization: `Bearer ${bob.session_token}` },
      })
      assert.equal(authorKit.statusCode, 200, authorKit.body)
      const kitBody = authorKit.json() as {
        subscribed: boolean
        skills: Array<{ skill_id: string }>
      }
      assert.equal(kitBody.subscribed, true)
      assert.ok(kitBody.skills.some((s) => s.skill_id === 'alice-kit:hello'))

      const list = await h.app.inject({
        method: 'GET',
        url: '/api/v1/subscriptions',
        headers: { authorization: `Bearer ${bob.session_token}` },
      })
      assert.equal(list.statusCode, 200, list.body)
      const listBody = list.json() as {
        subscriptions: Array<{ kind: string; author_id: string | null }>
      }
      assert.ok(listBody.subscriptions.some((s) => s.kind === 'author' && s.author_id === 'alice-kit'))

      const unsub = await h.app.inject({
        method: 'DELETE',
        url: '/api/v1/authors/alice-kit/subscribe',
        headers: { authorization: `Bearer ${bob.session_token}` },
      })
      assert.equal(unsub.statusCode, 200, unsub.body)
    } finally {
      await prisma.$disconnect()
    }
  })

  it('lets an accepted org member subscribe to a private team kit, but not an outsider', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)

      const member = await mint(h)
      const outsider = await mint(h)

      // Team owned by a third user; `member` is an accepted org member, not a
      // per-kit invitee (no kit_members row).
      const orgId = newId()
      const orgSlug = 'test-team'
      await prisma.organizations.create({
        data: { id: orgId, slug: orgSlug, name: 'Test Team' },
      })
      await prisma.authors.createMany({
        data: [{ id: orgSlug, name: 'Test Team' }],
        skipDuplicates: true,
      })
      await prisma.organization_members.create({
        data: { org_id: orgId, user_id: member.user_id, role: 'member', accepted_at: 1000 },
      })

      const kitId = newId()
      await prisma.kits.create({
        data: { id: kitId, owner_id: orgSlug, name: 'Team Kit', visibility: 'private' },
      })

      // Org member: allowed (regression — this used to 403 because only
      // kit_members was consulted, not organization_members).
      const memberSub = await h.app.inject({
        method: 'POST',
        url: `/api/v1/kits/${kitId}/subscribe`,
        headers: { authorization: `Bearer ${member.session_token}` },
      })
      assert.equal(memberSub.statusCode, 201, memberSub.body)

      const row = await prisma.kit_subscriptions.findFirst({
        where: { user_id: member.user_id, kind: 'kit', kit_id: kitId },
      })
      assert.ok(row, 'org member subscription should land in MySQL')

      // Outsider: still gated.
      const outsiderSub = await h.app.inject({
        method: 'POST',
        url: `/api/v1/kits/${kitId}/subscribe`,
        headers: { authorization: `Bearer ${outsider.session_token}` },
      })
      assert.equal(outsiderSub.statusCode, 403, outsiderSub.body)
    } finally {
      await prisma.$disconnect()
    }
  })

  it('surfaces team kits the caller admins in /kits/mine owned (add-to-kit targets)', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)

      const admin = await mint(h)
      await claim(h, admin, 'admin-user', 21)
      const plainMember = await mint(h)
      await claim(h, plainMember, 'plain-member', 22)

      const orgId = newId()
      const orgSlug = 'team-two'
      await prisma.organizations.create({
        data: { id: orgId, slug: orgSlug, name: 'Team Two' },
      })
      await prisma.authors.createMany({
        data: [{ id: orgSlug, name: 'Team Two' }],
        skipDuplicates: true,
      })
      await prisma.organization_members.createMany({
        data: [
          { org_id: orgId, user_id: admin.user_id, role: 'admin', accepted_at: 1000 },
          { org_id: orgId, user_id: plainMember.user_id, role: 'member', accepted_at: 1001 },
        ],
      })

      const teamKitId = newId()
      await prisma.kits.create({
        data: { id: teamKitId, owner_id: orgSlug, name: 'Team Kit', visibility: 'private' },
      })

      // Admin sees the team kit as an editable (owned) destination, gets the
      // team listed under `teams`, and the team's Saved kit is provisioned.
      const adminMine = await h.app.inject({
        method: 'GET',
        url: '/api/v1/kits/mine',
        headers: { authorization: `Bearer ${admin.session_token}` },
      })
      assert.equal(adminMine.statusCode, 200, adminMine.body)
      const adminBody = adminMine.json() as {
        owned: Array<{ id: string; owner: string; kind?: string; name: string }>
        teams?: Array<{ slug: string; name: string }>
      }
      assert.ok(
        adminBody.owned.some((k) => k.id === teamKitId && k.owner === orgSlug),
        `admin should see team kit in owned: ${adminMine.body}`,
      )
      assert.ok(
        adminBody.teams?.some((t) => t.slug === orgSlug && t.name === 'Team Two'),
        `admin should get team listed in teams: ${adminMine.body}`,
      )
      assert.ok(
        adminBody.owned.some((k) => k.owner === orgSlug && k.kind === 'saved'),
        `team Saved kit should be provisioned in owned: ${adminMine.body}`,
      )

      // Plain member (no write access) does not get it as an editable target.
      const memberMine = await h.app.inject({
        method: 'GET',
        url: '/api/v1/kits/mine',
        headers: { authorization: `Bearer ${plainMember.session_token}` },
      })
      assert.equal(memberMine.statusCode, 200, memberMine.body)
      const memberBody = memberMine.json() as {
        owned: Array<{ id: string; owner: string }>
        teams?: Array<{ slug: string }>
      }
      assert.ok(
        !memberBody.owned.some((k) => k.owner === orgSlug),
        `plain member should not see team kits in owned: ${memberMine.body}`,
      )
      assert.ok(
        !memberBody.teams?.some((t) => t.slug === orgSlug),
        `plain member should not get team in teams: ${memberMine.body}`,
      )
    } finally {
      await prisma.$disconnect()
    }
  })
})
