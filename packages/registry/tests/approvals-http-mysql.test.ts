// U4: approvals decide + updates list against MySQL.
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

const hasDatabaseUrl = mysqlTestsEnabled()

describe('approvals http mysql (U4)', { skip: !hasDatabaseUrl }, () => {
  let h: Handle

  before(async () => {
    h = await freshMysqlServer()
  })

  after(async () => {
    await h?.app.close()
  })

  it('lists pending updates and records an approval on MySQL', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)

      const author = await mint(h)
      await claim(h, author, 'upd-author', 61)
      const reader = await mint(h)
      await claim(h, reader, 'upd-reader', 62)

      await addSkillVersionPrisma(
        prisma,
        'upd-author',
        'notifier',
        'sha256:upd-v1',
        1_700_000_500,
      )

      // Public curated kit + subscribe so the skill enters the reader's sync set.
      const kit = await h.app.inject({
        method: 'POST',
        url: '/api/v1/kits',
        payload: { name: 'Updates Kit', visibility: 'public' },
        headers: { authorization: `Bearer ${author.session_token}` },
      })
      assert.equal(kit.statusCode, 201, kit.body)
      const kitId = (kit.json() as { id: string }).id

      const add = await h.app.inject({
        method: 'POST',
        url: `/api/v1/kits/${kitId}/skills`,
        payload: { author: 'upd-author', slug: 'notifier' },
        headers: { authorization: `Bearer ${author.session_token}` },
      })
      assert.equal(add.statusCode, 200, add.body)

      const pub = await h.app.inject({
        method: 'POST',
        url: `/api/v1/kits/${kitId}/publish`,
        headers: { authorization: `Bearer ${author.session_token}` },
      })
      // publish may 200 or 201 depending on path; accept either success
      assert.ok(pub.statusCode < 300, pub.body)

      const sub = await h.app.inject({
        method: 'POST',
        url: `/api/v1/kits/${kitId}/subscribe`,
        headers: { authorization: `Bearer ${reader.session_token}` },
      })
      assert.ok(sub.statusCode < 300, sub.body)

      // Ship a newer version so the subscriber has a pending target after baseline.
      await addSkillVersionPrisma(
        prisma,
        'upd-author',
        'notifier',
        'sha256:upd-v2',
        1_700_000_600,
      )

      const updates = await h.app.inject({
        method: 'GET',
        url: '/api/v1/me/updates',
        headers: { authorization: `Bearer ${reader.session_token}` },
      })
      assert.equal(updates.statusCode, 200, updates.body)
      const body = updates.json() as {
        pending: Array<{
          skill_id: string
          to_hash: string
          source_kit: { id: string; name: string; owner: string; avatar_url: string | null } | null
        }>
      }
      assert.ok(body.pending.length >= 1, updates.body)
      const row = body.pending.find((p) => p.skill_id === 'upd-author:notifier')
      assert.ok(row, updates.body)
      assert.equal(row.to_hash, 'sha256:upd-v2')

      // The pending row arrived through the subscribed kit, so it carries that
      // kit as its grouping source (id/name/owner), not a bare skill.
      assert.ok(row.source_kit, updates.body)
      assert.equal(row.source_kit.id, kitId)
      assert.equal(row.source_kit.name, 'Updates Kit')
      assert.equal(row.source_kit.owner, 'upd-author')

      const approve = await h.app.inject({
        method: 'POST',
        url: '/api/v1/approvals',
        payload: { skill_id: row.skill_id, version_hash: row.to_hash },
        headers: { authorization: `Bearer ${reader.session_token}` },
      })
      assert.equal(approve.statusCode, 200, approve.body)

      const after = await h.app.inject({
        method: 'GET',
        url: '/api/v1/me/updates',
        headers: { authorization: `Bearer ${reader.session_token}` },
      })
      assert.equal(after.statusCode, 200, after.body)
      const afterBody = after.json() as {
        pending: Array<{ skill_id: string }>
      }
      assert.ok(
        !afterBody.pending.some((p) => p.skill_id === 'upd-author:notifier'),
        after.body,
      )
    } finally {
      await prisma.$disconnect()
    }
  })

  // Team membership is a first-class sync source: an accepted org member gets the
  // org's kits' skills in their update queue, attributed to the team kit, and can
  // approve them (the /approvals guard covers the org source).
  it('serves an accepted team member the team kit skills, attributed to the team kit', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)

      const owner = await mint(h)
      await claim(h, owner, 'team-owner', 71)
      const member = await mint(h)
      await claim(h, member, 'team-member', 72)
      const author = await mint(h)
      await claim(h, author, 'team-skill-author', 73)

      await addSkillVersionPrisma(prisma, 'team-skill-author', 'kit-skill', 'sha256:team-v1', 1_700_001_000)

      // Owner creates a team and the member accepts the invite.
      const org = await h.app.inject({
        method: 'POST',
        url: '/api/v1/orgs',
        payload: { slug: 'dev-team', name: 'Dev Team' },
        headers: { authorization: `Bearer ${owner.session_token}` },
      })
      assert.equal(org.statusCode, 201, org.body)
      const invite = await h.app.inject({
        method: 'POST',
        url: '/api/v1/orgs/dev-team/invites',
        payload: { handle: 'team-member', role: 'member' },
        headers: { authorization: `Bearer ${owner.session_token}` },
      })
      assert.equal(invite.statusCode, 200, invite.body)
      const inviteId = (invite.json() as { invite_id: string }).invite_id
      const accept = await h.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/dev-team/invites/${inviteId}/accept`,
        headers: { authorization: `Bearer ${member.session_token}` },
      })
      assert.equal(accept.statusCode, 200, accept.body)

      // Owner publishes a team kit (owned by the org) with the author's skill,
      // AFTER the member joined — so it's a pending update for the member.
      const kit = await h.app.inject({
        method: 'POST',
        url: '/api/v1/kits',
        payload: { name: 'Team Kit', visibility: 'public', owner: 'dev-team' },
        headers: { authorization: `Bearer ${owner.session_token}` },
      })
      assert.equal(kit.statusCode, 201, kit.body)
      const kitId = (kit.json() as { id: string }).id
      const add = await h.app.inject({
        method: 'POST',
        url: `/api/v1/kits/${kitId}/skills`,
        payload: { author: 'team-skill-author', slug: 'kit-skill' },
        headers: { authorization: `Bearer ${owner.session_token}` },
      })
      assert.equal(add.statusCode, 200, add.body)
      const pub = await h.app.inject({
        method: 'POST',
        url: `/api/v1/kits/${kitId}/publish`,
        headers: { authorization: `Bearer ${owner.session_token}` },
      })
      assert.ok(pub.statusCode < 300, pub.body)

      // The member sees the team kit's skill, attributed to the team kit.
      const updates = await h.app.inject({
        method: 'GET',
        url: '/api/v1/me/updates',
        headers: { authorization: `Bearer ${member.session_token}` },
      })
      assert.equal(updates.statusCode, 200, updates.body)
      const body = updates.json() as {
        pending: Array<{
          skill_id: string
          to_hash: string
          source_kit: { name: string; owner: string } | null
        }>
      }
      const row = body.pending.find((p) => p.skill_id === 'team-skill-author:kit-skill')
      assert.ok(row, updates.body)
      assert.equal(row.source_kit?.name, 'Team Kit')
      assert.equal(row.source_kit?.owner, 'dev-team')

      // The member can approve it — the /approvals guard covers the org source.
      const approve = await h.app.inject({
        method: 'POST',
        url: '/api/v1/approvals',
        payload: { skill_id: row.skill_id, version_hash: row.to_hash },
        headers: { authorization: `Bearer ${member.session_token}` },
      })
      assert.equal(approve.statusCode, 200, approve.body)

      // A non-member (the skill's author, not on the team) does not get it via the
      // team source.
      const authorUpdates = await h.app.inject({
        method: 'GET',
        url: '/api/v1/me/updates',
        headers: { authorization: `Bearer ${author.session_token}` },
      })
      const authorBody = authorUpdates.json() as { pending: Array<{ skill_id: string }> }
      assert.ok(
        !authorBody.pending.some((p) => p.skill_id === 'team-skill-author:kit-skill'),
        authorUpdates.body,
      )
    } finally {
      await prisma.$disconnect()
    }
  })

  // Join = consent: accepting membership baselines the team kits' CURRENT versions
  // as approved (not pending); only versions published AFTER joining queue.
  it('baselines a team kit on join; only later versions pend', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)

      const owner = await mint(h)
      await claim(h, owner, 'baseline-owner', 74)
      const member = await mint(h)
      await claim(h, member, 'baseline-member', 75)
      const author = await mint(h)
      await claim(h, author, 'baseline-author', 76)

      await addSkillVersionPrisma(prisma, 'baseline-author', 'preseed', 'sha256:base-v1', 1_700_002_000)

      // Team + a published kit with the skill exist BEFORE the member joins.
      const org = await h.app.inject({
        method: 'POST',
        url: '/api/v1/orgs',
        payload: { slug: 'baseline-team', name: 'Baseline Team' },
        headers: { authorization: `Bearer ${owner.session_token}` },
      })
      assert.equal(org.statusCode, 201, org.body)
      const kit = await h.app.inject({
        method: 'POST',
        url: '/api/v1/kits',
        payload: { name: 'Team Kit', visibility: 'public', owner: 'baseline-team' },
        headers: { authorization: `Bearer ${owner.session_token}` },
      })
      const kitId = (kit.json() as { id: string }).id
      await h.app.inject({
        method: 'POST',
        url: `/api/v1/kits/${kitId}/skills`,
        payload: { author: 'baseline-author', slug: 'preseed' },
        headers: { authorization: `Bearer ${owner.session_token}` },
      })
      await h.app.inject({
        method: 'POST',
        url: `/api/v1/kits/${kitId}/publish`,
        headers: { authorization: `Bearer ${owner.session_token}` },
      })

      // Member joins AFTER the kit is published → join baselines the current version.
      const invite = await h.app.inject({
        method: 'POST',
        url: '/api/v1/orgs/baseline-team/invites',
        payload: { handle: 'baseline-member', role: 'member' },
        headers: { authorization: `Bearer ${owner.session_token}` },
      })
      const inviteId = (invite.json() as { invite_id: string }).invite_id
      const accept = await h.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/baseline-team/invites/${inviteId}/accept`,
        headers: { authorization: `Bearer ${member.session_token}` },
      })
      assert.equal(accept.statusCode, 200, accept.body)

      // The current version is baselined (approved), so it is NOT pending.
      const afterJoin = await h.app.inject({
        method: 'GET',
        url: '/api/v1/me/updates',
        headers: { authorization: `Bearer ${member.session_token}` },
      })
      const afterJoinBody = afterJoin.json() as { pending: Array<{ skill_id: string }> }
      assert.ok(
        !afterJoinBody.pending.some((p) => p.skill_id === 'baseline-author:preseed'),
        `join should baseline the current version: ${afterJoin.body}`,
      )

      // A NEW version published after joining does queue.
      await addSkillVersionPrisma(prisma, 'baseline-author', 'preseed', 'sha256:base-v2', 1_700_002_100)
      const afterBump = await h.app.inject({
        method: 'GET',
        url: '/api/v1/me/updates',
        headers: { authorization: `Bearer ${member.session_token}` },
      })
      const afterBumpBody = afterBump.json() as {
        pending: Array<{ skill_id: string; to_hash: string }>
      }
      const bumped = afterBumpBody.pending.find((p) => p.skill_id === 'baseline-author:preseed')
      assert.ok(bumped, `a version published after joining should pend: ${afterBump.body}`)
      assert.equal(bumped.to_hash, 'sha256:base-v2')
    } finally {
      await prisma.$disconnect()
    }
  })

  // Muting a team kit drops its skills from the update queue; unmuting restores
  // them. A version bump published after joining is pending (not baselined).
  it('mutes and unmutes a team kit', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)

      const owner = await mint(h)
      await claim(h, owner, 'mute-owner', 77)
      const member = await mint(h)
      await claim(h, member, 'mute-member', 78)
      const author = await mint(h)
      await claim(h, author, 'mute-author', 79)
      await addSkillVersionPrisma(prisma, 'mute-author', 'muteskill', 'sha256:mute-v1', 1_700_003_000)

      await h.app.inject({
        method: 'POST',
        url: '/api/v1/orgs',
        payload: { slug: 'mute-team', name: 'Mute Team' },
        headers: { authorization: `Bearer ${owner.session_token}` },
      })
      const invite = await h.app.inject({
        method: 'POST',
        url: '/api/v1/orgs/mute-team/invites',
        payload: { handle: 'mute-member', role: 'member' },
        headers: { authorization: `Bearer ${owner.session_token}` },
      })
      const inviteId = (invite.json() as { invite_id: string }).invite_id
      await h.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/mute-team/invites/${inviteId}/accept`,
        headers: { authorization: `Bearer ${member.session_token}` },
      })

      // Publish the kit AFTER join so the skill pends (not baselined).
      const kit = await h.app.inject({
        method: 'POST',
        url: '/api/v1/kits',
        payload: { name: 'Mute Kit', visibility: 'public', owner: 'mute-team' },
        headers: { authorization: `Bearer ${owner.session_token}` },
      })
      const kitId = (kit.json() as { id: string }).id
      await h.app.inject({
        method: 'POST',
        url: `/api/v1/kits/${kitId}/skills`,
        payload: { author: 'mute-author', slug: 'muteskill' },
        headers: { authorization: `Bearer ${owner.session_token}` },
      })
      await h.app.inject({
        method: 'POST',
        url: `/api/v1/kits/${kitId}/publish`,
        headers: { authorization: `Bearer ${owner.session_token}` },
      })

      const pendingCount = async () => {
        const r = await h.app.inject({
          method: 'GET',
          url: '/api/v1/me/updates',
          headers: { authorization: `Bearer ${member.session_token}` },
        })
        return (r.json() as { pending: Array<{ skill_id: string }> }).pending.filter(
          (p) => p.skill_id === 'mute-author:muteskill',
        ).length
      }

      assert.equal(await pendingCount(), 1, 'team kit skill should pend before mute')

      const mute = await h.app.inject({
        method: 'PUT',
        url: `/api/v1/me/team-kits/${kitId}/mute`,
        headers: { authorization: `Bearer ${member.session_token}` },
      })
      assert.equal(mute.statusCode, 200, mute.body)
      assert.equal(await pendingCount(), 0, 'muted team kit skill should drop from the queue')

      const unmute = await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/me/team-kits/${kitId}/mute`,
        headers: { authorization: `Bearer ${member.session_token}` },
      })
      assert.equal(unmute.statusCode, 200, unmute.body)
      assert.equal(await pendingCount(), 1, 'unmuted team kit skill should return')

      // A non-member cannot mute the kit.
      const forbidden = await h.app.inject({
        method: 'PUT',
        url: `/api/v1/me/team-kits/${kitId}/mute`,
        headers: { authorization: `Bearer ${author.session_token}` },
      })
      assert.equal(forbidden.statusCode, 403, forbidden.body)
    } finally {
      await prisma.$disconnect()
    }
  })
})
