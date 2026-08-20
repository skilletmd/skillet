// U4 wave 1: auth-critical Prisma helpers against MySQL.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import type { PrismaClient } from '@prisma/client'
import { isAdminUserPrisma } from '../src/auth/admin.js'
import {
  hashLoginCode,
  storeEmailLoginCodePrisma,
  verifyEmailLoginCodePrisma,
} from '../src/auth/email-login-code.js'
import { upsertIdentityUserPrisma } from '../src/auth/identities.js'
import { resolvePrincipalPrisma } from '../src/auth/middleware.js'
import { mintToken } from '../src/auth/tokens.js'
import { getAuthorKeysPrisma, newId } from '../src/db/index.js'
import {
  ensureMysqlMigrated,
  freshMysqlPrisma,
  resetMysqlRegistry,
  mysqlTestsEnabled
} from './mysql-test-env.js'

const hasDatabaseUrl = mysqlTestsEnabled()

describe('auth mysql (U4 wave 1)', { skip: !hasDatabaseUrl }, () => {
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

  it('isAdminUserPrisma respects DB flag and env user-id allowlist', async () => {
    await reset()
    const adminId = newId()
    const plainId = newId()
    await prisma.users.create({
      data: { id: adminId, handle: 'admin-user', is_admin: 1 },
    })
    await prisma.users.create({
      data: { id: plainId, handle: 'plain-user', is_admin: 0 },
    })

    assert.equal(await isAdminUserPrisma(prisma, adminId), true)
    assert.equal(await isAdminUserPrisma(prisma, plainId), false)

    const prev = process.env.SKILLET_ADMIN_USER_IDS
    process.env.SKILLET_ADMIN_USER_IDS = plainId
    try {
      assert.equal(await isAdminUserPrisma(prisma, plainId), true)
    } finally {
      if (prev === undefined) delete process.env.SKILLET_ADMIN_USER_IDS
      else process.env.SKILLET_ADMIN_USER_IDS = prev
    }
  })

  it('getAuthorKeysPrisma returns non-revoked keys only', async () => {
    await reset()
    const userId = newId()
    await prisma.users.create({ data: { id: userId, handle: 'keys-user' } })
    await prisma.author_keys.createMany({
      data: [
        {
          id: newId(),
          user_id: userId,
          key_id: 'live-key',
          public_key: 'pk-live',
          revoked_at: null,
        },
        {
          id: newId(),
          user_id: userId,
          key_id: 'dead-key',
          public_key: 'pk-dead',
          revoked_at: Math.floor(Date.now() / 1000),
        },
      ],
    })

    const keys = await getAuthorKeysPrisma(prisma, userId)
    assert.deepEqual(keys, [{ key_id: 'live-key', public_key: 'pk-live' }])
  })

  it('resolvePrincipalPrisma resolves a live session token', async () => {
    await reset()
    const userId = newId()
    await prisma.users.create({
      data: { id: userId, handle: 'session-user', two_factor: 0 },
    })
    const { secret, hash } = mintToken('session')
    const sessionId = newId()
    const expiresAt = Math.floor(Date.now() / 1000) + 3600
    await prisma.sessions.create({
      data: {
        id: sessionId,
        user_id: userId,
        token_hash: hash,
        expires_at: expiresAt,
      },
    })

    const principal = await resolvePrincipalPrisma(prisma, `Bearer ${secret}`)
    assert.ok(principal)
    assert.equal(principal.class, 'session')
    if (principal.class !== 'session') return
    assert.equal(principal.session_id, sessionId)
    assert.equal(principal.user_id, userId)
    assert.equal(principal.handle, 'session-user')
    assert.equal(principal.two_factor, false)

    const revoked = await resolvePrincipalPrisma(prisma, `Bearer ${mintToken('session').secret}`)
    assert.equal(revoked, null)
  })

  it('email login code store + verify mints a session', async () => {
    await reset()
    const email = 'alice@example.com'
    const code = '042861'

    const stored = await storeEmailLoginCodePrisma(prisma, {
      email,
      code,
      requestIp: '127.0.0.1',
    })
    assert.ok(stored.expires_at > Math.floor(Date.now() / 1000))

    const row = await prisma.email_login_codes.findUnique({ where: { id: stored.id } })
    assert.ok(row)
    assert.equal(row.code_hash, hashLoginCode(email, code))
    assert.equal(row.consumed_at, null)

    const wrong = await verifyEmailLoginCodePrisma(prisma, { email, code: '000000' })
    assert.equal(wrong.ok, false)

    const ok = await verifyEmailLoginCodePrisma(prisma, { email, code })
    assert.equal(ok.ok, true)
    if (!ok.ok) return
    assert.equal(ok.user.email, email)
    assert.ok(ok.session_token.startsWith('skillet_s_'))

    const principal = await resolvePrincipalPrisma(prisma, `Bearer ${ok.session_token}`)
    assert.ok(principal)
    assert.equal(principal?.class, 'session')

    const replay = await verifyEmailLoginCodePrisma(prisma, { email, code })
    assert.equal(replay.ok, false)
  })

  it('upsertIdentityUserPrisma creates an email identity', async () => {
    await reset()
    const user = await upsertIdentityUserPrisma(prisma, {
      provider: 'email',
      provider_subject_id: 'bob@example.com',
      email: 'bob@example.com',
      email_verified: true,
    })
    assert.ok(user.user_id)
    assert.equal(user.email, 'bob@example.com')
    assert.deepEqual(user.linked_providers, ['email'])

    const again = await upsertIdentityUserPrisma(prisma, {
      provider: 'email',
      provider_subject_id: 'bob@example.com',
      email: 'bob@example.com',
      email_verified: true,
    })
    assert.equal(again.user_id, user.user_id)
  })
})
