// Consent-coverage invariant: every source the sync manifest serves must be
// covered by the pending-updates queue, except the caller's own authored
// skills (self-trust).
//
// Why: the web Updates page is the ONLY approval surface. Devices reconcile
// its decisions; nothing else can approve an update. A manifest source the
// queue doesn't cover therefore leaves a device gated forever with no web
// recourse (the Library-saved-skill bug). This test seeds one skill per
// manifest source kind — owned kit, member kit, kit subscription, author
// subscription, own authored — and asserts every external ref the manifest
// serves shows up in pendingTargetsPrisma. If you add a new manifest source,
// seed it here and extend the pending-target resolution in the same PR.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { addSkillVersionPrisma, claim, freshMysqlServer, mint, subscribeAuthorPrisma, type Handle } from './helpers.js'
import { createTestPrismaClient, mysqlTestsEnabled, resetMysqlRegistry } from './mysql-test-env.js'
import { buildSessionManifestPrisma } from '../src/lib/sync-manifest.js'
import { pendingTargetsPrisma } from '../src/lib/pending-update-targets.js'
import { pendingRemovalsPrisma, decideRemovalPrisma } from '../src/lib/pending-removals.js'
import { baselineSkillDecisionPrisma } from '../src/routes/approvals.js'
import { toSkillId } from '@skillet/protocol/skill-id'

const hasDatabaseUrl = mysqlTestsEnabled()

describe('consent coverage (manifest sources ⊆ pending queue)', { skip: !hasDatabaseUrl }, () => {
  let h: Handle

  before(async () => {
    h = await freshMysqlServer()
  })

  after(async () => {
    await h?.app.close()
  })

  it('every external manifest source appears in the pending queue; own authored never does', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)

      const session = await mint(h)
      await claim(h, session, 'consumer', 31)
      const userId = session.user_id
      const t0 = 1_700_000_000

      // One external skill per manifest source kind, plus one self-authored.
      await addSkillVersionPrisma(prisma, 'ownedauthor', 'in-owned-kit', 'sha256:cc-owned-1', t0)
      await addSkillVersionPrisma(prisma, 'memberauthor', 'in-member-kit', 'sha256:cc-member-1', t0)
      await addSkillVersionPrisma(prisma, 'kitsubauthor', 'in-subscribed-kit', 'sha256:cc-kitsub-1', t0)
      await addSkillVersionPrisma(prisma, 'subauthor', 'from-author-sub', 'sha256:cc-authorsub-1', t0)
      await addSkillVersionPrisma(prisma, 'orgauthor', 'in-org-kit', 'sha256:cc-org-1', t0)
      await addSkillVersionPrisma(prisma, 'consumer', 'self-authored', 'sha256:cc-self-1', t0)

      // Source 1: a kit the caller owns, holding someone else's skill.
      await prisma.kits.create({ data: { id: 'kit-owned', owner_id: 'consumer', name: 'toolbox' } })
      await prisma.kit_skills.create({ data: { kit_id: 'kit-owned', skill_id: 'ownedauthor:in-owned-kit' } })

      // Source 2: a kit the caller is a member of (owned by someone else).
      await prisma.kits.create({ data: { id: 'kit-member', owner_id: 'memberauthor', name: 'team kit' } })
      await prisma.kit_skills.create({ data: { kit_id: 'kit-member', skill_id: 'memberauthor:in-member-kit' } })
      await prisma.kit_members.create({ data: { kit_id: 'kit-member', user_id: userId } })

      // Source 3: a kit subscription (served from the latest kit_versions snapshot).
      await prisma.kits.create({ data: { id: 'kit-sub', owner_id: 'kitsubauthor', name: 'starter', visibility: 'public' } })
      await prisma.kit_versions.create({
        data: {
          id: 'kitver-sub-1',
          kit_id: 'kit-sub',
          version: 1,
          snapshot_json: JSON.stringify({
            skills: [{ skill_id: 'kitsubauthor:in-subscribed-kit', pinned_hash: null }],
          }),
        },
      })
      await prisma.kit_subscriptions.create({
        data: { id: 'sub-kit-1', user_id: userId, kind: 'kit', kit_id: 'kit-sub' },
      })

      // Source 4: an author subscription.
      await subscribeAuthorPrisma(prisma, userId, 'subauthor')

      // Source 5: a team (org) the caller is an accepted member of, owning a kit.
      // The org slug lives in the authors namespace (kits.owner_id → authors.id).
      await prisma.authors.createMany({ data: [{ id: 'org-team', name: 'Org Team' }], skipDuplicates: true })
      await prisma.organizations.create({ data: { id: 'org-1', slug: 'org-team', name: 'Org Team' } })
      await prisma.organization_members.create({ data: { org_id: 'org-1', user_id: userId, accepted_at: t0 } })
      await prisma.kits.create({ data: { id: 'kit-org', owner_id: 'org-team', name: 'Team Kit' } })
      await prisma.kit_skills.create({ data: { kit_id: 'kit-org', skill_id: 'orgauthor:in-org-kit' } })

      const manifest = await buildSessionManifestPrisma(prisma, userId, 'consumer')
      const externalRefs = manifest.filter((i) => i.external_author).map((i) => i.ref)

      // Seeding sanity: the manifest must actually serve all four external
      // sources (and the self-authored skill). If one is missing, the seed no
      // longer matches how that source is stored — fix the seed, don't skip it.
      for (const ref of [
        '@ownedauthor/in-owned-kit',
        '@memberauthor/in-member-kit',
        '@kitsubauthor/in-subscribed-kit',
        '@subauthor/from-author-sub',
        '@orgauthor/in-org-kit',
      ]) {
        assert.ok(externalRefs.includes(ref), `manifest lost the seeded source ${ref}`)
      }
      assert.ok(
        manifest.some((i) => i.ref === '@consumer/self-authored'),
        'manifest lost the seeded own-authored skill',
      )

      // The invariant. Nothing is edited, decided, or quarantined here, so
      // every external manifest ref must be pending on the web queue.
      const pending = await pendingTargetsPrisma(prisma, userId)
      const pendingRefs = new Set(pending.map((t) => `@${t.author_id}/${t.slug}`))
      const uncovered = externalRefs.filter((ref) => !pendingRefs.has(ref))
      assert.deepEqual(
        uncovered,
        [],
        `sync manifest serves sources the web Updates queue cannot approve: ${uncovered.join(', ')}. ` +
          'A device syncing these stays gated forever with no web recourse. ' +
          'Extend pendingTargets / pendingTargetsPrisma to cover the new source.',
      )

      // Self-trust: your own authored skills auto-apply and must never pend.
      assert.ok(
        !pendingRefs.has('@consumer/self-authored'),
        'own authored skill must not queue for approval (self-trust)',
      )
    } finally {
      await prisma.$disconnect()
    }
  })

  // R5 — removal consent: a kit author dropping a skill queues a removal
  // decision for subscribers who had it; Remove releases the device hold,
  // Keep re-serves via the Saved kit. Later subscribers and the kit's own
  // owner never see the row.
  it('kit removals queue for consented subscribers; Keep re-serves, Remove clears', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)

      const session = await mint(h)
      await claim(h, session, 'consumer', 31)
      const userId = session.user_id
      const t0 = 1_700_000_000

      await addSkillVersionPrisma(prisma, 'kitauthor', 'stays', 'sha256:rm-stays-1', t0)
      await addSkillVersionPrisma(prisma, 'kitauthor', 'dropped', 'sha256:rm-dropped-1', t0)

      // Subscribed public kit: v1 serves both skills, v2 drops one.
      await prisma.kits.create({ data: { id: 'kit-rm', owner_id: 'kitauthor', name: 'shifting', visibility: 'public' } })
      await prisma.kit_versions.createMany({
        data: [
          {
            id: 'kitver-rm-1', kit_id: 'kit-rm', version: 1,
            snapshot_json: JSON.stringify({ skills: [
              { skill_id: 'kitauthor:stays', pinned_hash: null },
              { skill_id: 'kitauthor:dropped', pinned_hash: null },
            ] }),
          },
          {
            id: 'kitver-rm-2', kit_id: 'kit-rm', version: 2,
            snapshot_json: JSON.stringify({ skills: [
              { skill_id: 'kitauthor:stays', pinned_hash: null },
            ] }),
          },
        ],
      })
      await prisma.kit_subscriptions.create({
        data: { id: 'sub-rm-1', user_id: userId, kind: 'kit', kit_id: 'kit-rm' },
      })

      // No baseline yet (a later subscriber): the removal must NOT queue.
      assert.deepEqual(await pendingRemovalsPrisma(prisma, userId), [])

      // With the add=consent baseline the removal queues, attributed to the kit.
      await baselineSkillDecisionPrisma(prisma, userId, toSkillId('kitauthor:dropped'), 'sha256:rm-dropped-1')
      const pending = await pendingRemovalsPrisma(prisma, userId)
      assert.equal(pending.length, 1)
      assert.equal(pending[0].skill_id, 'kitauthor:dropped')
      assert.equal(pending[0].source_kit.id, 'kit-rm')
      assert.equal(pending[0].keepable, true)

      // Scope guard mirrors /approvals: a non-pending pair is refused.
      assert.equal(await decideRemovalPrisma(prisma, userId, 'kitauthor:stays', 'kit-rm', 'remove'), 'not_pending')

      // Keep: re-served via the Saved kit, so the manifest carries it again
      // and the pending row clears without a prune.
      assert.equal(await decideRemovalPrisma(prisma, userId, 'kitauthor:dropped', 'kit-rm', 'keep'), 'ok')
      assert.deepEqual(await pendingRemovalsPrisma(prisma, userId), [])
      const manifest = await buildSessionManifestPrisma(prisma, userId, 'consumer')
      assert.ok(
        manifest.some((i) => i.ref === '@kitauthor/dropped'),
        'Keep must re-serve the skill through the Saved kit',
      )

      // Remove: with the decision reversed to remove (fresh state), the row
      // clears and nothing re-serves. Reset the decision + saved kit to test.
      await prisma.removal_decisions.deleteMany({ where: { user_id: userId } })
      const saved = await prisma.kits.findFirst({ where: { owner_id: 'consumer', kind: 'saved' }, select: { id: true } })
      if (saved) await prisma.kit_skills.deleteMany({ where: { kit_id: saved.id } })
      assert.equal((await pendingRemovalsPrisma(prisma, userId)).length, 1)
      assert.equal(await decideRemovalPrisma(prisma, userId, 'kitauthor:dropped', 'kit-rm', 'remove'), 'ok')
      assert.deepEqual(await pendingRemovalsPrisma(prisma, userId), [])
      const manifestAfterRemove = await buildSessionManifestPrisma(prisma, userId, 'consumer')
      assert.ok(
        !manifestAfterRemove.some((i) => i.ref === '@kitauthor/dropped'),
        'Remove must not re-serve the skill',
      )

      // R5 ETag interaction: an undecided removal must change the manifest ETag
      // even though it adds no item, and deciding it must change it back —
      // otherwise the device keeps getting 304 and never reconciles the
      // released hold (the wedged-prune bug). Rebuild the pending state for a
      // fresh subscriber-side look at both phases.
      await prisma.removal_decisions.deleteMany({ where: { user_id: userId } })
      const savedAgain = await prisma.kits.findFirst({ where: { owner_id: 'consumer', kind: 'saved' }, select: { id: true } })
      if (savedAgain) await prisma.kit_skills.deleteMany({ where: { kit_id: savedAgain.id } })
      assert.equal((await pendingRemovalsPrisma(prisma, userId)).length, 1)
      const manifestReq = { method: 'GET' as const, url: '/api/v1/sync/manifest', headers: { authorization: `Bearer ${session.session_token}` } }
      const withHold = await h.app.inject(manifestReq)
      assert.equal(withHold.statusCode, 200)
      const etagWithHold = withHold.headers.etag as string
      assert.equal(await decideRemovalPrisma(prisma, userId, 'kitauthor:dropped', 'kit-rm', 'remove'), 'ok')
      const afterDecide = await h.app.inject(manifestReq)
      assert.equal(afterDecide.statusCode, 200)
      assert.notEqual(
        afterDecide.headers.etag,
        etagWithHold,
        'deciding a removal must change the manifest ETag or devices 304 forever and never prune',
      )
      // And the conditional request with the stale hold-phase ETag must be a 200.
      const conditional = await h.app.inject({
        ...manifestReq,
        headers: { ...manifestReq.headers, 'if-none-match': etagWithHold },
      })
      assert.equal(conditional.statusCode, 200)

      // Self-trust: the kit owner never sees removal rows for their own kit.
      const ownerSession = await mint(h)
      await claim(h, ownerSession, 'kitauthor', 32)
      await prisma.kit_subscriptions.create({
        data: { id: 'sub-rm-own', user_id: ownerSession.user_id, kind: 'kit', kit_id: 'kit-rm' },
      })
      await baselineSkillDecisionPrisma(prisma, ownerSession.user_id, toSkillId('kitauthor:dropped'), 'sha256:rm-dropped-1')
      assert.deepEqual(await pendingRemovalsPrisma(prisma, ownerSession.user_id), [])
    } finally {
      await prisma.$disconnect()
    }
  })

  // R5 for live-served kits: org/team kits snapshot on membership change, so a
  // teammate's removal queues for every OTHER member. The remover themselves
  // prunes silently (editor exemption), and a muted team kit decides nothing.
  it('org-kit removals queue for members; the removing editor is exempt', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)

      const bystander = await mint(h)
      await claim(h, bystander, 'bystander', 33)
      const editor = await mint(h)
      await claim(h, editor, 'editor', 34)

      await addSkillVersionPrisma(prisma, 'teamauthor', 'team-dropped', 'sha256:org-rm-1', 1_700_000_000)

      await prisma.authors.createMany({ data: [{ id: 'rm-team', name: 'RM Team' }], skipDuplicates: true })
      await prisma.organizations.create({ data: { id: 'org-rm', slug: 'rm-team', name: 'RM Team' } })
      await prisma.organization_members.createMany({
        data: [
          { org_id: 'org-rm', user_id: bystander.user_id, accepted_at: 1_700_000_000 },
          { org_id: 'org-rm', user_id: editor.user_id, accepted_at: 1_700_000_000 },
        ],
      })
      await prisma.kits.create({ data: { id: 'kit-org-rm', owner_id: 'rm-team', name: 'Team Kit' } })
      await prisma.kit_versions.createMany({
        data: [
          {
            id: 'kitver-org-1', kit_id: 'kit-org-rm', version: 1, editor_id: 'editor',
            snapshot_json: JSON.stringify({ skills: [{ skill_id: 'teamauthor:team-dropped', pinned_hash: null }] }),
          },
          {
            id: 'kitver-org-2', kit_id: 'kit-org-rm', version: 2, editor_id: 'editor',
            snapshot_json: JSON.stringify({ skills: [] }),
          },
        ],
      })
      await baselineSkillDecisionPrisma(prisma, bystander.user_id, toSkillId('teamauthor:team-dropped'), 'sha256:org-rm-1')
      await baselineSkillDecisionPrisma(prisma, editor.user_id, toSkillId('teamauthor:team-dropped'), 'sha256:org-rm-1')

      const forBystander = await pendingRemovalsPrisma(prisma, bystander.user_id)
      assert.equal(forBystander.length, 1)
      assert.equal(forBystander[0].skill_id, 'teamauthor:team-dropped')
      assert.equal(forBystander[0].source_kit.id, 'kit-org-rm')

      // The teammate who made the removing edit acted deliberately: silent.
      assert.deepEqual(await pendingRemovalsPrisma(prisma, editor.user_id), [])

      // Muting the team kit silences its removal rows too.
      await prisma.muted_team_kits.create({ data: { user_id: bystander.user_id, kit_id: 'kit-org-rm' } })
      assert.deepEqual(await pendingRemovalsPrisma(prisma, bystander.user_id), [])
    } finally {
      await prisma.$disconnect()
    }
  })
})
