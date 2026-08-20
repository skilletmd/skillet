// U4: kit create + GET + skill writes against MySQL via freshMysqlServer.
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

describe('kits http mysql (U4)', { skip: !hasDatabaseUrl }, () => {
  let h: Handle

  before(async () => {
    h = await freshMysqlServer()
  })

  after(async () => {
    await h?.app.close()
  })

  it('creates a kit and reads it by handle on MySQL', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)

      const session = await mint(h)
      await claim(h, session, 'kitmaker', 31)

      const create = await h.app.inject({
        method: 'POST',
        url: '/api/v1/kits',
        payload: { name: 'My Tools', visibility: 'public' },
        headers: { authorization: `Bearer ${session.session_token}` },
      })
      assert.equal(create.statusCode, 201, create.body)
      const created = create.json() as { id: string; owner: string; slug: string; name: string }
      assert.equal(created.owner, 'kitmaker')
      assert.equal(created.slug, 'my-tools')
      assert.equal(created.name, 'My Tools')

      const byId = await h.app.inject({
        method: 'GET',
        url: `/api/v1/kits/${created.id}`,
        headers: { authorization: `Bearer ${session.session_token}` },
      })
      assert.equal(byId.statusCode, 200, byId.body)

      const byHandle = await h.app.inject({
        method: 'GET',
        url: '/api/v1/kits/by-handle/kitmaker/my-tools',
      })
      assert.equal(byHandle.statusCode, 200, byHandle.body)
      const body = byHandle.json() as { id: string; slug: string }
      assert.equal(body.id, created.id)
      assert.equal(body.slug, 'my-tools')

      const row = await prisma.kits.findUnique({ where: { id: created.id } })
      assert.equal(row?.owner_id, 'kitmaker')
      assert.equal(row?.visibility, 'public')
    } finally {
      await prisma.$disconnect()
    }
  })

  it('adds a skill to a kit and GET shows it on MySQL', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)

      const session = await mint(h)
      await claim(h, session, 'kitcurator', 42)

      await addSkillVersionPrisma(
        prisma,
        'kitcurator',
        'lint-fix',
        'sha256:lint-v1',
        1_700_000_100,
      )

      const create = await h.app.inject({
        method: 'POST',
        url: '/api/v1/kits',
        payload: { name: 'Curated', visibility: 'private' },
        headers: { authorization: `Bearer ${session.session_token}` },
      })
      assert.equal(create.statusCode, 201, create.body)
      const kit = create.json() as { id: string }

      const add = await h.app.inject({
        method: 'POST',
        url: `/api/v1/kits/${kit.id}/skills`,
        payload: { author: 'kitcurator', slug: 'lint-fix' },
        headers: { authorization: `Bearer ${session.session_token}` },
      })
      assert.equal(add.statusCode, 200, add.body)

      const byId = await h.app.inject({
        method: 'GET',
        url: `/api/v1/kits/${kit.id}`,
        headers: { authorization: `Bearer ${session.session_token}` },
      })
      assert.equal(byId.statusCode, 200, byId.body)
      const payload = byId.json() as {
        skills: Array<{ skill_id: string; current_hash: string | null }>
      }
      assert.equal(payload.skills.length, 1)
      assert.equal(payload.skills[0].skill_id, 'kitcurator:lint-fix')
      assert.equal(payload.skills[0].current_hash, 'sha256:lint-v1')

      const row = await prisma.kit_skills.findUnique({
        where: {
          kit_id_skill_id: { kit_id: kit.id, skill_id: 'kitcurator:lint-fix' },
        },
      })
      assert.ok(row)
    } finally {
      await prisma.$disconnect()
    }
  })

  it('patches kit name/visibility on MySQL and lists empty versions', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)

      const session = await mint(h)
      await claim(h, session, 'kitpatcher', 55)

      const create = await h.app.inject({
        method: 'POST',
        url: '/api/v1/kits',
        payload: { name: 'Draft Kit', visibility: 'private' },
        headers: { authorization: `Bearer ${session.session_token}` },
      })
      assert.equal(create.statusCode, 201, create.body)
      const kit = create.json() as { id: string }

      const patch = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/kits/${kit.id}`,
        payload: { name: 'Renamed Kit', visibility: 'public' },
        headers: { authorization: `Bearer ${session.session_token}` },
      })
      assert.equal(patch.statusCode, 200, patch.body)
      const patched = patch.json() as { name: string; slug: string; visibility: string }
      assert.equal(patched.name, 'Renamed Kit')
      assert.equal(patched.slug, 'renamed-kit')
      assert.equal(patched.visibility, 'public')

      const row = await prisma.kits.findUnique({ where: { id: kit.id } })
      assert.equal(row?.name, 'Renamed Kit')
      assert.equal(row?.slug, 'renamed-kit')
      assert.equal(row?.visibility, 'public')

      const alias = await prisma.kit_slug_aliases.findUnique({
        where: { owner_id_slug: { owner_id: 'kitpatcher', slug: 'draft-kit' } },
      })
      assert.equal(alias?.kit_id, kit.id)

      const versions = await h.app.inject({
        method: 'GET',
        url: `/api/v1/kits/${kit.id}/versions`,
        headers: { authorization: `Bearer ${session.session_token}` },
      })
      assert.equal(versions.statusCode, 200, versions.body)
      const verBody = versions.json() as { versions: unknown[] }
      assert.equal(verBody.versions.length, 0)
    } finally {
      await prisma.$disconnect()
    }
  })

  it('draft payload reports unpublished skill-set changes on MySQL', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)
      const session = await mint(h)
      await claim(h, session, 'kitdraft', 55)
      await addSkillVersionPrisma(prisma, 'kitdraft', 'alpha', 'sha256:alpha-v1', 1000)
      await addSkillVersionPrisma(prisma, 'kitdraft', 'beta', 'sha256:beta-v1', 1001)

      const create = await h.app.inject({
        method: 'POST',
        url: '/api/v1/kits',
        payload: { name: 'Draft Kit', visibility: 'private' },
        headers: { authorization: `Bearer ${session.session_token}` },
      })
      assert.equal(create.statusCode, 201, create.body)
      const kit = create.json() as {
        id: string
        has_unpublished_changes: boolean
        unpublished_diff: { added: string[]; removed: string[] } | null
      }
      // Never-published kits differ from a null snapshot (sqlite parity).
      assert.equal(kit.has_unpublished_changes, true)
      assert.deepEqual(kit.unpublished_diff, { added: [], removed: [] })

      const add = await h.app.inject({
        method: 'POST',
        url: `/api/v1/kits/${kit.id}/skills`,
        payload: { author: 'kitdraft', slug: 'alpha' },
        headers: { authorization: `Bearer ${session.session_token}` },
      })
      assert.equal(add.statusCode, 200, add.body)
      const afterAdd = add.json() as {
        has_unpublished_changes: boolean
        unpublished_diff: { added: string[]; removed: string[] }
      }
      assert.equal(afterAdd.has_unpublished_changes, true)
      assert.ok(afterAdd.unpublished_diff.added.includes('kitdraft:alpha'))

      const publish = await h.app.inject({
        method: 'POST',
        url: `/api/v1/kits/${kit.id}/publish`,
        headers: { authorization: `Bearer ${session.session_token}` },
      })
      assert.equal(publish.statusCode, 200, publish.body)

      const get = await h.app.inject({
        method: 'GET',
        url: `/api/v1/kits/${kit.id}`,
        headers: { authorization: `Bearer ${session.session_token}` },
      })
      assert.equal(get.statusCode, 200, get.body)
      const clean = get.json() as {
        has_unpublished_changes: boolean
        unpublished_diff: { added: string[]; removed: string[] }
      }
      assert.equal(clean.has_unpublished_changes, false)
      assert.deepEqual(clean.unpublished_diff, { added: [], removed: [] })

      const addBeta = await h.app.inject({
        method: 'POST',
        url: `/api/v1/kits/${kit.id}/skills`,
        payload: { author: 'kitdraft', slug: 'beta' },
        headers: { authorization: `Bearer ${session.session_token}` },
      })
      assert.equal(addBeta.statusCode, 200, addBeta.body)
      const dirty = addBeta.json() as {
        has_unpublished_changes: boolean
        unpublished_diff: { added: string[]; removed: string[] }
      }
      assert.equal(dirty.has_unpublished_changes, true)
      assert.ok(dirty.unpublished_diff.added.includes('kitdraft:beta'))
    } finally {
      await prisma.$disconnect()
    }
  })

  it('POST /me/library/skills saves to the caller Saved kit (first-class add)', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)
      const session = await mint(h)
      await claim(h, session, 'libowner', 43)
      await addSkillVersionPrisma(prisma, 'strangerauthor', 'tool', 'sha256:tool-v1', 1_700_000_200)

      const save = await h.app.inject({
        method: 'POST',
        url: '/api/v1/me/library/skills',
        payload: { author: 'strangerauthor', slug: 'tool' },
        headers: { authorization: `Bearer ${session.session_token}` },
      })
      assert.equal(save.statusCode, 200, save.body)
      const body = save.json() as { ok: boolean; kit_ref: string; added: boolean }
      assert.equal(body.ok, true)
      assert.equal(body.kit_ref, '@libowner/saved')
      assert.equal(body.added, true)

      // The skill is a member of the caller's auto Saved kit (kind='saved').
      const savedKit = await prisma.kits.findFirst({
        where: { owner_id: 'libowner', kind: 'saved' },
        select: { id: true },
      })
      assert.ok(savedKit, 'a Saved kit was created for the caller')
      const row = await prisma.kit_skills.findUnique({
        where: { kit_id_skill_id: { kit_id: savedKit.id, skill_id: 'strangerauthor:tool' } },
      })
      assert.ok(row, 'skill is a member of the Saved kit')
    } finally {
      await prisma.$disconnect()
    }
  })

  it('POST /me/library/skills requires a claimed handle', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)
      const session = await mint(h) // minted, never claimed a handle
      await addSkillVersionPrisma(prisma, 'strangerauthor', 'tool', 'sha256:tool-v1', 1_700_000_300)

      const save = await h.app.inject({
        method: 'POST',
        url: '/api/v1/me/library/skills',
        payload: { author: 'strangerauthor', slug: 'tool' },
        headers: { authorization: `Bearer ${session.session_token}` },
      })
      assert.equal(save.statusCode, 403, save.body)
      assert.equal((save.json() as { error: string }).error, 'handle_required')
    } finally {
      await prisma.$disconnect()
    }
  })

  // #467: reading a private skill (via kit membership) must NOT authorize
  // re-exporting it. Only the owner or an org-admin may curate a private skill
  // into a kit; a member who can merely read it cannot re-add it elsewhere.
  it('#467: a kit member cannot re-add another user private skill to their own kit', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)

      // Alice owns a PRIVATE skill and puts it in her private kit K1.
      const alice = await mint(h)
      await claim(h, alice, 'alice', 51)
      await addSkillVersionPrisma(prisma, 'alice', 'secret', 'sha256:secret-v1', 1_700_001_000)
      await prisma.skills.update({ where: { id: 'alice:secret' }, data: { visibility: 'private' } })

      const k1 = (
        await h.app.inject({
          method: 'POST',
          url: '/api/v1/kits',
          payload: { name: 'Alice K1', visibility: 'private' },
          headers: { authorization: `Bearer ${alice.session_token}` },
        })
      ).json() as { id: string }

      // R2: the owner CAN add her own private skill to a kit she manages.
      const ownerAdd = await h.app.inject({
        method: 'POST',
        url: `/api/v1/kits/${k1.id}/skills`,
        payload: { author: 'alice', slug: 'secret' },
        headers: { authorization: `Bearer ${alice.session_token}` },
      })
      assert.equal(ownerAdd.statusCode, 200, ownerAdd.body)

      // Bob is a legit member of K1, so he can READ alice:secret.
      const bob = await mint(h)
      await claim(h, bob, 'bob', 52)
      await prisma.kit_members.create({
        data: { kit_id: k1.id, user_id: bob.user_id, accepted_at: 1_700_000_000 },
      })

      const k2 = (
        await h.app.inject({
          method: 'POST',
          url: '/api/v1/kits',
          payload: { name: 'Bob K2', visibility: 'private' },
          headers: { authorization: `Bearer ${bob.session_token}` },
        })
      ).json() as { id: string }

      // R1 + KTD3: Bob re-adding alice:secret to HIS kit is 403 (not 404). The
      // 403 (rather than the not-readable 404) proves Bob CAN read it but may
      // not re-export it — exactly the transitive re-share this fix closes.
      const reshare = await h.app.inject({
        method: 'POST',
        url: `/api/v1/kits/${k2.id}/skills`,
        payload: { author: 'alice', slug: 'secret' },
        headers: { authorization: `Bearer ${bob.session_token}` },
      })
      assert.equal(reshare.statusCode, 403, reshare.body)
      assert.equal(
        (reshare.json() as { error: string }).error,
        'only_owner_can_add_private_skill',
      )

      // KTD2: the Saved-library path enforces the same gate.
      const savedReshare = await h.app.inject({
        method: 'POST',
        url: '/api/v1/me/library/skills',
        payload: { author: 'alice', slug: 'secret' },
        headers: { authorization: `Bearer ${bob.session_token}` },
      })
      assert.equal(savedReshare.statusCode, 403, savedReshare.body)
      assert.equal(
        (savedReshare.json() as { error: string }).error,
        'only_owner_can_add_private_skill',
      )

      // R4: a PUBLIC skill by another author is still freely curatable by Bob.
      await addSkillVersionPrisma(prisma, 'openauthor', 'pub', 'sha256:pub-v1', 1_700_001_100)
      const publicAdd = await h.app.inject({
        method: 'POST',
        url: `/api/v1/kits/${k2.id}/skills`,
        payload: { author: 'openauthor', slug: 'pub' },
        headers: { authorization: `Bearer ${bob.session_token}` },
      })
      assert.equal(publicAdd.statusCode, 200, publicAdd.body)
    } finally {
      await prisma.$disconnect()
    }
  })

  // #472 (item 2): an UNACCEPTED kit membership grants no read. The add gate
  // returns 404 (not readable), not 403 (readable-but-not-manageable) — the
  // accepted_at filter denies read entirely for a pending membership.
  it('#472: an unaccepted kit member cannot even read a private kit skill', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)

      const alice = await mint(h)
      await claim(h, alice, 'alice2', 53)
      await addSkillVersionPrisma(prisma, 'alice2', 'secret', 'sha256:secret2-v1', 1_700_002_000)
      await prisma.skills.update({ where: { id: 'alice2:secret' }, data: { visibility: 'private' } })

      const k1 = (
        await h.app.inject({
          method: 'POST',
          url: '/api/v1/kits',
          payload: { name: 'Alice2 K1', visibility: 'private' },
          headers: { authorization: `Bearer ${alice.session_token}` },
        })
      ).json() as { id: string }
      await h.app.inject({
        method: 'POST',
        url: `/api/v1/kits/${k1.id}/skills`,
        payload: { author: 'alice2', slug: 'secret' },
        headers: { authorization: `Bearer ${alice.session_token}` },
      })

      // Bob has a PENDING (accepted_at null) membership — not yet a real member.
      const bob = await mint(h)
      await claim(h, bob, 'bob2', 54)
      await prisma.kit_members.create({
        data: { kit_id: k1.id, user_id: bob.user_id, accepted_at: null },
      })

      const k2 = (
        await h.app.inject({
          method: 'POST',
          url: '/api/v1/kits',
          payload: { name: 'Bob2 K2', visibility: 'private' },
          headers: { authorization: `Bearer ${bob.session_token}` },
        })
      ).json() as { id: string }

      const reshare = await h.app.inject({
        method: 'POST',
        url: `/api/v1/kits/${k2.id}/skills`,
        payload: { author: 'alice2', slug: 'secret' },
        headers: { authorization: `Bearer ${bob.session_token}` },
      })
      // 404 (not readable), not 403 — the pending membership grants no read.
      assert.equal(reshare.statusCode, 404, reshare.body)
    } finally {
      await prisma.$disconnect()
    }
  })
})
