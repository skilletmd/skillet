// U4: GET /profiles/:author against MySQL.
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

describe('profiles http mysql (U4)', { skip: !hasDatabaseUrl }, () => {
  let h: Handle

  before(async () => {
    h = await freshMysqlServer()
  })

  after(async () => {
    await h?.app.close()
  })

  it('returns a claimed author profile with a public skill', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)

      const session = await mint(h)
      await claim(h, session, 'profiler', 41)
      await addSkillVersionPrisma(
        prisma,
        'profiler',
        'widget',
        'sha256:profile-skill-1',
        1_700_000_300,
      )

      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/profiles/profiler',
      })
      assert.equal(res.statusCode, 200, res.body)
      const body = res.json() as {
        id: string
        skills: Array<{ slug: string; skill_id: string }>
        total_installs: number
      }
      assert.equal(body.id, 'profiler')
      assert.equal(body.skills.length, 1)
      assert.equal(body.skills[0]?.slug, 'widget')
      assert.equal(typeof body.total_installs, 'number')
    } finally {
      await prisma.$disconnect()
    }
  })

  it('serves author page and PATCH bio on MySQL', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)

      const session = await mint(h)
      await claim(h, session, 'authorpage', 51)
      await addSkillVersionPrisma(
        prisma,
        'authorpage',
        'gizmo',
        'sha256:author-page-skill-1',
        1_700_000_400,
      )

      const page = await h.app.inject({
        method: 'GET',
        url: '/api/v1/authors/authorpage',
      })
      assert.equal(page.statusCode, 200, page.body)
      const pageBody = page.json() as {
        id: string
        kind: string
        skills: Array<{ slug: string }>
      }
      assert.equal(pageBody.id, 'authorpage')
      assert.equal(pageBody.kind, 'user')
      assert.equal(pageBody.skills.length, 1)
      assert.equal(pageBody.skills[0]?.slug, 'gizmo')

      const patch = await h.app.inject({
        method: 'PATCH',
        url: '/api/v1/profiles/authorpage',
        payload: { bio: 'ships agents' },
        headers: { authorization: `Bearer ${session.session_token}` },
      })
      assert.equal(patch.statusCode, 200, patch.body)
      const patched = patch.json() as { bio: string | null }
      assert.equal(patched.bio, 'ships agents')
    } finally {
      await prisma.$disconnect()
    }
  })

  // #011: GET /authors/:handle/summon — a handle's public kit as routing
  // candidates: authored-public UNION publicly-curated, with `via` on curated
  // and the true author ref. Private skills and private kits never surface.
  it('serves a handle public kit (authored + curated) for @handle routing', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)

      const karpathy = await mint(h)
      await claim(h, karpathy, 'karpathy', 71)
      // Authored: one public, one private.
      await addSkillVersionPrisma(prisma, 'karpathy', 'blog-tips', 'sha256:kk-pub-1', 1_700_003_000)
      await addSkillVersionPrisma(prisma, 'karpathy', 'secret', 'sha256:kk-priv-1', 1_700_003_050)
      await prisma.skills.update({ where: { id: 'karpathy:secret' }, data: { visibility: 'private' } })

      // Another author's PUBLIC skill that karpathy curates.
      await addSkillVersionPrisma(prisma, 'thiago', 'blog-writer', 'sha256:th-pub-1', 1_700_003_100)

      // karpathy's PUBLIC kit with the curated skill.
      const pubKit = (
        await h.app.inject({
          method: 'POST',
          url: '/api/v1/kits',
          payload: { name: 'Karpathy Picks', visibility: 'public' },
          headers: { authorization: `Bearer ${karpathy.session_token}` },
        })
      ).json() as { id: string }
      const curate = await h.app.inject({
        method: 'POST',
        url: `/api/v1/kits/${pubKit.id}/skills`,
        payload: { author: 'thiago', slug: 'blog-writer' },
        headers: { authorization: `Bearer ${karpathy.session_token}` },
      })
      assert.equal(curate.statusCode, 200, curate.body)

      // A PRIVATE kit with a public skill — must NOT surface (curation is
      // public-kits-only).
      await addSkillVersionPrisma(prisma, 'thiago', 'hidden-pick', 'sha256:th-pub-2', 1_700_003_150)
      const privKit = (
        await h.app.inject({
          method: 'POST',
          url: '/api/v1/kits',
          payload: { name: 'Karpathy Private', visibility: 'private' },
          headers: { authorization: `Bearer ${karpathy.session_token}` },
        })
      ).json() as { id: string }
      await h.app.inject({
        method: 'POST',
        url: `/api/v1/kits/${privKit.id}/skills`,
        payload: { author: 'thiago', slug: 'hidden-pick' },
        headers: { authorization: `Bearer ${karpathy.session_token}` },
      })

      const res = await h.app.inject({ method: 'GET', url: '/api/v1/authors/karpathy/summon' })
      assert.equal(res.statusCode, 200, res.body)
      assert.equal(res.headers['cache-control'], 'public, max-age=300')
      const body = res.json() as {
        handle: string
        skills: Array<{ ref: string; slug: string; via: string | null; latest_hash: string | null }>
      }
      assert.equal(body.handle, 'karpathy')
      const byRef = new Map(body.skills.map((s) => [s.ref, s]))

      // Authored-public appears, via null.
      assert.ok(byRef.has('@karpathy/blog-tips'), 'authored-public skill present')
      assert.equal(byRef.get('@karpathy/blog-tips')?.via, null)
      // Curated appears with the TRUE author ref and via=karpathy.
      assert.ok(byRef.has('@thiago/blog-writer'), 'curated skill present under its true author ref')
      assert.equal(byRef.get('@thiago/blog-writer')?.via, 'karpathy')
      // Private authored skill is absent.
      assert.ok(!byRef.has('@karpathy/secret'), 'private authored skill omitted')
      // Skill only in a PRIVATE kit is absent.
      assert.ok(!byRef.has('@thiago/hidden-pick'), 'skill in a private kit omitted')

      // @-prefixed handle resolves the same.
      const withAt = await h.app.inject({ method: 'GET', url: '/api/v1/authors/@karpathy/summon' })
      assert.equal(withAt.statusCode, 200, withAt.body)

      // Unknown handle -> 404.
      const missing = await h.app.inject({ method: 'GET', url: '/api/v1/authors/nobody/summon' })
      assert.equal(missing.statusCode, 404, missing.body)
    } finally {
      await prisma.$disconnect()
    }
  })
})
