// U4: follow/unfollow HTTP against MySQL via freshMysqlServer.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import {
  addSkillVersionPrisma,
  claim,
  freshMysqlServer,
  mint,
  type Handle,
} from './helpers.js'
import { newId } from '../src/db/index.js'
import {
  createTestPrismaClient,
  mysqlTestsEnabled,
  resetMysqlRegistry,
} from './mysql-test-env.js'

const hasDatabaseUrl = mysqlTestsEnabled()

describe('follows http mysql (U4)', { skip: !hasDatabaseUrl }, () => {
  let h: Handle

  before(async () => {
    h = await freshMysqlServer()
  })

  after(async () => {
    await h?.app.close()
  })

  it('follow, list, unfollow on MySQL', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)

      const alice = await mint(h)
      await claim(h, alice, 'alice-follow', 21)
      const bob = await mint(h)
      await claim(h, bob, 'bob-follow', 22)

      const follow = await h.app.inject({
        method: 'POST',
        url: '/api/v1/follows',
        payload: { kind: 'author', id: 'bob-follow' },
        headers: { authorization: `Bearer ${alice.session_token}` },
      })
      assert.equal(follow.statusCode, 201, follow.body)
      const followBody = follow.json() as { following: boolean; followers: number }
      assert.equal(followBody.following, true)
      assert.equal(followBody.followers, 1)

      const me = await h.app.inject({
        method: 'GET',
        url: '/api/v1/me/following',
        headers: { authorization: `Bearer ${alice.session_token}` },
      })
      assert.equal(me.statusCode, 200, me.body)
      const meBody = me.json() as {
        following: Array<{ subject_kind: string; subject_id: string }>
      }
      assert.ok(
        meBody.following.some(
          (e) => e.subject_kind === 'author' && e.subject_id === 'bob-follow',
        ),
      )

      const followers = await h.app.inject({
        method: 'GET',
        url: '/api/v1/profiles/bob-follow/followers',
      })
      assert.equal(followers.statusCode, 200, followers.body)
      const followersBody = followers.json() as {
        count: number
        followers: Array<{ handle: string }>
      }
      assert.equal(followersBody.count, 1)
      assert.equal(followersBody.followers[0]?.handle, 'alice-follow')

      const unfollow = await h.app.inject({
        method: 'DELETE',
        url: '/api/v1/follows',
        payload: { kind: 'author', id: 'bob-follow' },
        headers: { authorization: `Bearer ${alice.session_token}` },
      })
      assert.equal(unfollow.statusCode, 200, unfollow.body)
      const unfollowBody = unfollow.json() as { following: boolean; followers: number }
      assert.equal(unfollowBody.following, false)
      assert.equal(unfollowBody.followers, 0)
    } finally {
      await prisma.$disconnect()
    }
  })

  it('GET /me/feed?view=following returns skill events on MySQL', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)

      const alice = await mint(h)
      await claim(h, alice, 'alice-feed', 31)
      const bob = await mint(h)
      await claim(h, bob, 'bob-feed', 32)

      await h.app.inject({
        method: 'POST',
        url: '/api/v1/follows',
        payload: { kind: 'author', id: 'bob-feed' },
        headers: { authorization: `Bearer ${alice.session_token}` },
      })

      await addSkillVersionPrisma(
        prisma,
        'bob-feed',
        'deploy',
        'sha256:feed-skill-v1',
        1_700_000_300,
      )

      const feed = await h.app.inject({
        method: 'GET',
        url: '/api/v1/me/feed?view=following&limit=30',
        headers: { authorization: `Bearer ${alice.session_token}` },
      })
      assert.equal(feed.statusCode, 200, feed.body)
      const body = feed.json() as {
        events: Array<{ kind: string; skill?: { author: string; slug: string } }>
        following_count: number
        view: string
      }
      assert.equal(body.view, 'following')
      assert.equal(body.following_count, 1)
      assert.ok(
        body.events.some(
          (e) => e.kind === 'skill' && e.skill?.author === 'bob-feed' && e.skill?.slug === 'deploy',
        ),
      )
    } finally {
      await prisma.$disconnect()
    }
  })

  it('GET /me/followed-curations returns public kit curations on MySQL', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)

      const alice = await mint(h)
      await claim(h, alice, 'alice-cur', 41)
      const bob = await mint(h)
      await claim(h, bob, 'bob-cur', 42)

      await h.app.inject({
        method: 'POST',
        url: '/api/v1/follows',
        payload: { kind: 'author', id: 'bob-cur' },
        headers: { authorization: `Bearer ${alice.session_token}` },
      })

      await addSkillVersionPrisma(
        prisma,
        'bob-cur',
        'lint',
        'sha256:cur-skill-v1',
        1_700_000_400,
      )

      const kitId = newId()
      await prisma.kits.create({
        data: {
          id: kitId,
          owner_id: 'bob-cur',
          name: 'Public Kit',
          slug: 'public-kit',
          visibility: 'public',
        },
      })
      await prisma.kit_skills.create({
        data: {
          kit_id: kitId,
          skill_id: 'bob-cur:lint',
          pinned_hash: null,
        },
      })

      const cur = await h.app.inject({
        method: 'GET',
        url: '/api/v1/me/followed-curations',
        headers: { authorization: `Bearer ${alice.session_token}` },
      })
      assert.equal(cur.statusCode, 200, cur.body)
      const body = cur.json() as { curations: Record<string, string[]> }
      assert.deepEqual(body.curations['bob-cur:lint'], ['bob-cur'])
    } finally {
      await prisma.$disconnect()
    }
  })

  it('GET /discover/feed returns public activity on MySQL', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)
      await addSkillVersionPrisma(
        prisma,
        'discover-author',
        'skill',
        'sha256:discover-feed-v1',
        1_700_000_500,
      )

      const feed = await h.app.inject({
        method: 'GET',
        url: '/api/v1/discover/feed?limit=10',
      })
      assert.equal(feed.statusCode, 200, feed.body)
      const body = feed.json() as {
        events: Array<{ kind: string; skill?: { author: string; slug: string } }>
        view: string
      }
      assert.equal(body.view, 'discover')
      assert.ok(
        body.events.some(
          (e) =>
            e.kind === 'skill' &&
            e.skill?.author === 'discover-author' &&
            e.skill?.slug === 'skill',
        ),
      )
    } finally {
      await prisma.$disconnect()
    }
  })

  it('GET /me/suggestions returns second-degree and popular authors on MySQL', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)

      const alice = await mint(h)
      await claim(h, alice, 'alice-sug', 41)
      const bob = await mint(h)
      await claim(h, bob, 'bob-sug', 42)
      const carol = await mint(h)
      await claim(h, carol, 'carol-sug', 43)
      await addSkillVersionPrisma(
        prisma,
        'carol-sug',
        'rail',
        'sha256:suggestions-carol-v1',
        1_700_000_700,
      )

      await h.app.inject({
        method: 'POST',
        url: '/api/v1/follows',
        payload: { kind: 'author', id: 'bob-sug' },
        headers: { authorization: `Bearer ${alice.session_token}` },
      })
      await h.app.inject({
        method: 'POST',
        url: '/api/v1/follows',
        payload: { kind: 'author', id: 'carol-sug' },
        headers: { authorization: `Bearer ${bob.session_token}` },
      })

      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/me/suggestions?limit=5',
        headers: { authorization: `Bearer ${alice.session_token}` },
      })
      assert.equal(res.statusCode, 200, res.body)
      const body = res.json() as {
        suggestions: Array<{ handle: string; skills: number }>
      }
      assert.ok(
        body.suggestions.some((s) => s.handle === 'carol-sug' && s.skills >= 1),
        res.body,
      )
    } finally {
      await prisma.$disconnect()
    }
  })

  it('GET /profiles/:author/activity returns author timeline on MySQL', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)
      await addSkillVersionPrisma(
        prisma,
        'profile-author',
        'tool',
        'sha256:profile-activity-v1',
        1_700_000_600,
      )

      const activity = await h.app.inject({
        method: 'GET',
        url: '/api/v1/profiles/profile-author/activity',
      })
      assert.equal(activity.statusCode, 200, activity.body)
      const body = activity.json() as {
        events: Array<{ kind: string; skill?: { author: string; slug: string } }>
      }
      assert.ok(
        body.events.some(
          (e) =>
            e.kind === 'skill' &&
            e.skill?.author === 'profile-author' &&
            e.skill?.slug === 'tool',
        ),
      )
    } finally {
      await prisma.$disconnect()
    }
  })

  it('GET /profiles/:author/adopters lists kit savers on MySQL', async () => {
    const prisma = createTestPrismaClient()
    try {
      await resetMysqlRegistry(prisma)
      await addSkillVersionPrisma(
        prisma,
        'adopt-author',
        'public-tool',
        'sha256:adopt-v1',
        1_700_000_700,
      )
      await prisma.authors.createMany({
        data: [{ id: 'adopter-user', name: 'Adopter User' }],
        skipDuplicates: true,
      })
      const kitId = newId()
      await prisma.kits.create({
        data: {
          id: kitId,
          owner_id: 'adopter-user',
          name: 'Saved',
          slug: 'saved',
          visibility: 'public',
          kind: 'saved',
        },
      })
      await prisma.kit_skills.create({
        data: { kit_id: kitId, skill_id: 'adopt-author:public-tool' },
      })

      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/profiles/adopt-author/adopters',
      })
      assert.equal(res.statusCode, 200, res.body)
      const body = res.json() as {
        count: number
        adopters: Array<{ handle: string; name: string }>
      }
      assert.equal(body.count, 1)
      assert.equal(body.adopters[0]?.handle, 'adopter-user')
    } finally {
      await prisma.$disconnect()
    }
  })
})
