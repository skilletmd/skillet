// U4 wave 1: Fastify auth decorator + guards when skilletPrisma is set.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import Fastify, { type FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import {
  registerAuthDecorator,
  requireAdmin,
  requireScope,
} from '../src/auth/middleware.js'
import { mintToken } from '../src/auth/tokens.js'
import { newId } from '../src/db/index.js'
import {
  ensureMysqlMigrated,
  freshMysqlPrisma,
  resetMysqlRegistry,
  mysqlTestsEnabled
} from './mysql-test-env.js'

const hasDatabaseUrl = mysqlTestsEnabled()

async function buildPrismaAuthHarness(
  prisma: PrismaClient,
  registerRoutes: (app: FastifyInstance) => void,
): Promise<{
  app: FastifyInstance
  db: DatabaseSync
}> {
  const db = new DatabaseSync(':memory:')
  const app = Fastify({ logger: false })
  app.decorate('skilletDb', db)
  app.decorate('skilletPrisma', prisma)
  registerAuthDecorator(app, db, { prisma })
  registerRoutes(app)
  await app.ready()
  return { app, db }
}

describe('auth decorator mysql (U4 wave 1)', { skip: !hasDatabaseUrl }, () => {
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

  it('registerAuthDecorator resolves session tokens from Prisma, not sqlite', async () => {
    await reset()
    const userId = newId()
    await prisma.users.create({
      data: { id: userId, handle: 'decorator-user', two_factor: 0 },
    })
    const { secret, hash } = mintToken('session')
    const sessionId = newId()
    await prisma.sessions.create({
      data: {
        id: sessionId,
        user_id: userId,
        token_hash: hash,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      },
    })

    const { app, db } = await buildPrismaAuthHarness(prisma, (app) => {
      app.get('/whoami', async (req) => ({
        class: req.principal?.class ?? null,
        session_id:
          req.principal?.class === 'session' ? req.principal.session_id : null,
      }))
    })
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/whoami',
        headers: { authorization: `Bearer ${secret}` },
      })
      assert.equal(res.statusCode, 200)
      const body = res.json() as { class: string | null; session_id: string | null }
      assert.equal(body.class, 'session')
      assert.equal(body.session_id, sessionId)
    } finally {
      await app.close()
      db.close()
    }
  })

  it('requireAdmin uses isAdminUserPrisma when skilletPrisma is set', async () => {
    await reset()
    const adminId = newId()
    const plainId = newId()
    await prisma.users.createMany({
      data: [
        { id: adminId, handle: 'admin-decorator', is_admin: 1 },
        { id: plainId, handle: 'plain-decorator', is_admin: 0 },
      ],
    })

    const adminToken = mintToken('session')
    const plainToken = mintToken('session')
    await prisma.sessions.createMany({
      data: [
        {
          id: newId(),
          user_id: adminId,
          token_hash: adminToken.hash,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        },
        {
          id: newId(),
          user_id: plainId,
          token_hash: plainToken.hash,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        },
      ],
    })

    const { app, db } = await buildPrismaAuthHarness(prisma, (app) => {
      app.get('/admin-only', { preHandler: [requireAdmin()] }, async () => ({ ok: true }))
    })
    try {
      const ok = await app.inject({
        method: 'GET',
        url: '/admin-only',
        headers: { authorization: `Bearer ${adminToken.secret}` },
      })
      assert.equal(ok.statusCode, 200)

      const denied = await app.inject({
        method: 'GET',
        url: '/admin-only',
        headers: { authorization: `Bearer ${plainToken.secret}` },
      })
      assert.equal(denied.statusCode, 403)
      assert.equal((denied.json() as { error: string }).error, 'admin_required')
    } finally {
      await app.close()
      db.close()
    }
  })

  it('requireScope uses userHasVerifiedEmailPrisma when skilletPrisma is set', async () => {
    await reset()
    const verifiedId = newId()
    const unverifiedId = newId()
    await prisma.users.createMany({
      data: [
        { id: verifiedId, handle: 'verified-user', two_factor: 0 },
        { id: unverifiedId, handle: 'unverified-user', two_factor: 0 },
      ],
    })
    await prisma.user_identities.create({
      data: {
        user_id: verifiedId,
        provider: 'email',
        provider_subject_id: 'verified@example.com',
        email: 'verified@example.com',
        email_verified: 1,
      },
    })

    const verifiedToken = mintToken('session')
    const unverifiedToken = mintToken('session')
    await prisma.sessions.createMany({
      data: [
        {
          id: newId(),
          user_id: verifiedId,
          token_hash: verifiedToken.hash,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        },
        {
          id: newId(),
          user_id: unverifiedId,
          token_hash: unverifiedToken.hash,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        },
      ],
    })

    const { app, db } = await buildPrismaAuthHarness(prisma, (app) => {
      app.post(
        '/publish-gate',
        { preHandler: [requireScope('publish')] },
        async () => ({ ok: true }),
      )
    })
    try {
      const ok = await app.inject({
        method: 'POST',
        url: '/publish-gate',
        headers: { authorization: `Bearer ${verifiedToken.secret}` },
      })
      assert.equal(ok.statusCode, 200)

      const denied = await app.inject({
        method: 'POST',
        url: '/publish-gate',
        headers: { authorization: `Bearer ${unverifiedToken.secret}` },
      })
      assert.equal(denied.statusCode, 403)
      assert.equal(
        (denied.json() as { error: string }).error,
        'account_verification_required',
      )
    } finally {
      await app.close()
      db.close()
    }
  })
})
