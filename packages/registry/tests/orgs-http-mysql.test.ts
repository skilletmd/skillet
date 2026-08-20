// U4 Wave A: org HTTP against MySQL via freshMysqlServer.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import {
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

describe('orgs http mysql (U4 Wave A)', { skip: !hasDatabaseUrl }, () => {
  let h: Handle

  before(async () => {
    h = await freshMysqlServer()
  })

  after(async () => {
    await h?.app.close()
  })

  it('create org, list members, invite + accept on MySQL', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)

      const owner = await mint(h)
      await claim(h, owner, 'owner-user', 11)
      const invitee = await mint(h)
      await claim(h, invitee, 'invitee-user', 12)

      const create = await h.app.inject({
        method: 'POST',
        url: '/api/v1/orgs',
        payload: { slug: 'acme-team', name: 'Acme Team' },
        headers: { authorization: `Bearer ${owner.session_token}` },
      })
      assert.equal(create.statusCode, 201, create.body)
      const created = create.json() as { org_id: string; slug: string }
      assert.equal(created.slug, 'acme-team')

      const list = await h.app.inject({
        method: 'GET',
        url: '/api/v1/orgs',
        headers: { authorization: `Bearer ${owner.session_token}` },
      })
      assert.equal(list.statusCode, 200, list.body)
      const listed = list.json() as { orgs: Array<{ slug: string; role: string }> }
      assert.equal(listed.orgs.length, 1)
      assert.equal(listed.orgs[0]?.slug, 'acme-team')
      assert.equal(listed.orgs[0]?.role, 'owner')

      const invite = await h.app.inject({
        method: 'POST',
        url: '/api/v1/orgs/acme-team/invites',
        payload: { handle: 'invitee-user', role: 'member' },
        headers: { authorization: `Bearer ${owner.session_token}` },
      })
      assert.equal(invite.statusCode, 200, invite.body)
      const invited = invite.json() as { invite_id: string; status: string }
      assert.equal(invited.status, 'invited')

      const accept = await h.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/acme-team/invites/${invited.invite_id}/accept`,
        headers: { authorization: `Bearer ${invitee.session_token}` },
      })
      assert.equal(accept.statusCode, 200, accept.body)
      const accepted = accept.json() as { status: string; role: string }
      assert.equal(accepted.status, 'accepted')
      assert.equal(accepted.role, 'member')

      const members = await h.app.inject({
        method: 'GET',
        url: '/api/v1/orgs/acme-team/members',
        headers: { authorization: `Bearer ${owner.session_token}` },
      })
      assert.equal(members.statusCode, 200, members.body)
      const body = members.json() as {
        members: Array<{ handle: string | null; role: string }>
      }
      assert.equal(body.members.length, 2)
      assert.ok(body.members.some((m) => m.handle === 'owner-user' && m.role === 'owner'))
      assert.ok(body.members.some((m) => m.handle === 'invitee-user' && m.role === 'member'))

      const orgRow = await prisma.organizations.findUnique({ where: { id: created.org_id } })
      assert.equal(orgRow?.slug, 'acme-team')
      const author = await prisma.authors.findUnique({ where: { id: 'acme-team' } })
      assert.ok(author)
    } finally {
      await prisma.$disconnect()
    }
  })

  // Regression: an email-addressed org invite must only be accepted by a user
  // holding an IdP-VERIFIED identity for that address. Matching an unverified
  // email would let anyone who parked the invited address on an identity join
  // the org and read its private skills.
  it('email invite: rejects an unverified identity, accepts a verified one', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)

      const owner = await mint(h)
      await claim(h, owner, 'beta-owner', 41)
      const create = await h.app.inject({
        method: 'POST',
        url: '/api/v1/orgs',
        payload: { slug: 'beta-team', name: 'Beta Team' },
        headers: { authorization: `Bearer ${owner.session_token}` },
      })
      assert.equal(create.statusCode, 201, create.body)

      const invite = await h.app.inject({
        method: 'POST',
        url: '/api/v1/orgs/beta-team/invites',
        payload: { email: 'victim@company.com', role: 'member' },
        headers: { authorization: `Bearer ${owner.session_token}` },
      })
      assert.equal(invite.statusCode, 200, invite.body)
      const { invite_id } = invite.json() as { invite_id: string }

      // Attacker holds an UNVERIFIED identity carrying the invited email.
      const attacker = await mint(h)
      await claim(h, attacker, 'attacker-user', 42)
      await prisma.user_identities.create({
        data: {
          user_id: attacker.user_id,
          provider: 'twitter',
          provider_subject_id: 'attacker-twitter',
          email: 'victim@company.com',
          email_verified: 0,
        },
      })
      const rejected = await h.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/beta-team/invites/${invite_id}/accept`,
        headers: { authorization: `Bearer ${attacker.session_token}` },
      })
      assert.equal(
        rejected.statusCode,
        403,
        `unverified email must not accept the invite: ${rejected.body}`,
      )

      // A user with an IdP-VERIFIED identity for the address may accept.
      const legit = await mint(h)
      await claim(h, legit, 'legit-user', 43)
      await prisma.user_identities.create({
        data: {
          user_id: legit.user_id,
          provider: 'google',
          provider_subject_id: 'legit-google',
          email: 'victim@company.com',
          email_verified: 1,
        },
      })
      const accepted = await h.app.inject({
        method: 'POST',
        url: `/api/v1/orgs/beta-team/invites/${invite_id}/accept`,
        headers: { authorization: `Bearer ${legit.session_token}` },
      })
      assert.equal(
        accepted.statusCode,
        200,
        `verified email must accept the invite: ${accepted.body}`,
      )
    } finally {
      await prisma.$disconnect()
    }
  })
})
