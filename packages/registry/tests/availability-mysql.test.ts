// U4: availability routes against MySQL via Prisma (sqlite auth harness + MySQL data).
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import Fastify, { type FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { registerAuthDecorator } from '../src/auth/middleware.js'
import { registerAvailabilityRoutes } from '../src/routes/availability.js'
import { mintToken } from '../src/auth/tokens.js'
import { newId } from '../src/db/index.js'
import {
  ensureMysqlMigrated,
  freshMysqlPrisma,
  resetMysqlRegistry,
  mysqlTestsEnabled
} from './mysql-test-env.js'

const hasDatabaseUrl = mysqlTestsEnabled()

async function buildAvailabilityHarness(
  prisma: PrismaClient,
): Promise<{ app: FastifyInstance; db: DatabaseSync; token: string; userId: string }> {
  const db = new DatabaseSync(':memory:')
  const app = Fastify({ logger: false })
  app.decorate('skilletDb', db)
  app.decorate('skilletPrisma', prisma)
  registerAuthDecorator(app, db, { prisma })
  registerAvailabilityRoutes(app, prisma)
  await app.ready()

  const userId = newId()
  await prisma.users.create({
    data: { id: userId, handle: `avail-${userId.slice(0, 8)}`, two_factor: 0 },
  })
  const { secret, hash } = mintToken('session')
  await prisma.sessions.create({
    data: {
      id: newId(),
      user_id: userId,
      token_hash: hash,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    },
  })

  return { app, db, token: secret, userId }
}

/** Seed an author + skill at a given visibility (#463 filter operates on this). */
async function seedSkill(
  prisma: PrismaClient,
  author: string,
  slug: string,
  visibility: 'public' | 'private' = 'public',
): Promise<void> {
  await prisma.authors.createMany({ data: [{ id: author, name: author }], skipDuplicates: true })
  await prisma.skills.upsert({
    where: { id: `${author}:${slug}` },
    create: { id: `${author}:${slug}`, author_id: author, slug, visibility },
    update: { visibility },
  })
}

describe('availability mysql (U4)', { skip: !hasDatabaseUrl }, () => {
  let prisma: PrismaClient

  before(async () => {
    await ensureMysqlMigrated()
    prisma = await freshMysqlPrisma()
  })

  after(async () => {
    await prisma?.$disconnect()
  })

  async function reset(): Promise<void> {
    await resetMysqlRegistry(prisma)
  }

  it('upserts (skill × runtime) availability via Prisma and lists via GET', async () => {
    await reset()
    const { app, db, token } = await buildAvailabilityHarness(prisma)
    try {
      await seedSkill(prisma, 'a', 'x', 'public')
      await seedSkill(prisma, 'a', 'y', 'public')
      const post = await app.inject({
        method: 'POST',
        url: '/api/v1/sync/availability',
        payload: { skill_refs: ['@a/x', '@a/y'], runtimes: ['claude', 'codex'] },
        headers: { authorization: `Bearer ${token}` },
      })
      assert.equal(post.statusCode, 200)
      assert.equal((post.json() as { stored: number }).stored, 4)

      await app.inject({
        method: 'POST',
        url: '/api/v1/sync/availability',
        payload: { skill_refs: ['@a/x'], runtimes: ['claude'] },
        headers: { authorization: `Bearer ${token}` },
      })

      const me = await app.inject({
        method: 'GET',
        url: '/api/v1/me/availability',
        headers: { authorization: `Bearer ${token}` },
      })
      assert.equal(me.statusCode, 200)
      const rows = (me.json() as { availability: Array<{ skill_ref: string; runtime: string }> })
        .availability
      assert.equal(rows.length, 4)
    } finally {
      await app.close()
      db.close()
    }
  })

  it('drops availability in private mode (opt-out)', async () => {
    await reset()
    const { app, db, token, userId } = await buildAvailabilityHarness(prisma)
    try {
      await prisma.users.update({
        where: { id: userId },
        data: { activity_private: 1 },
      })

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/sync/availability',
        payload: { skill_refs: ['@a/x'], runtimes: ['claude'] },
        headers: { authorization: `Bearer ${token}` },
      })
      assert.equal(res.statusCode, 200)
      const body = res.json() as { stored: number; reason?: string }
      assert.equal(body.reason, 'private')
      assert.equal(body.stored, 0)

      const count = await prisma.skill_runtime_availability.count({
        where: { user_id: userId },
      })
      assert.equal(count, 0)
    } finally {
      await app.close()
      db.close()
    }
  })

  it('DELETE /me/availability purges rows via deleteMany', async () => {
    await reset()
    const { app, db, token, userId } = await buildAvailabilityHarness(prisma)
    try {
      await seedSkill(prisma, 'a', 'x', 'public')
      await app.inject({
        method: 'POST',
        url: '/api/v1/sync/availability',
        payload: { skill_refs: ['@a/x'], runtimes: ['claude', 'codex'] },
        headers: { authorization: `Bearer ${token}` },
      })

      const del = await app.inject({
        method: 'DELETE',
        url: '/api/v1/me/availability',
        headers: { authorization: `Bearer ${token}` },
      })
      assert.equal(del.statusCode, 200)
      assert.equal((del.json() as { deleted: number }).deleted, 2)

      const me = await app.inject({
        method: 'GET',
        url: '/api/v1/me/availability',
        headers: { authorization: `Bearer ${token}` },
      })
      assert.deepEqual((me.json() as { availability: unknown[] }).availability, [])

      const count = await prisma.skill_runtime_availability.count({
        where: { user_id: userId },
      })
      assert.equal(count, 0)
    } finally {
      await app.close()
      db.close()
    }
  })

  it('#463: stores only public skill refs; drops private and never-published names', async () => {
    await reset()
    const { app, db, token, userId } = await buildAvailabilityHarness(prisma)
    try {
      await seedSkill(prisma, 'a', 'pub', 'public')
      await seedSkill(prisma, 'a', 'sec', 'private')
      // '@a/ghost' is deliberately never seeded — a never-published local skill.

      const post = await app.inject({
        method: 'POST',
        url: '/api/v1/sync/availability',
        payload: { skill_refs: ['@a/pub', '@a/sec', '@a/ghost'], runtimes: ['claude'] },
        headers: { authorization: `Bearer ${token}` },
      })
      assert.equal(post.statusCode, 200)
      // Only the public skill × one runtime is stored; private + ghost dropped.
      assert.equal((post.json() as { stored: number }).stored, 1)

      const rows = await prisma.skill_runtime_availability.findMany({
        where: { user_id: userId },
        select: { skill_ref: true },
      })
      assert.deepEqual(
        rows.map((r) => r.skill_ref),
        ['@a/pub'],
      )
    } finally {
      await app.close()
      db.close()
    }
  })
})
