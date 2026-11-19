// Save on a computer that isn't connected yet (kit map plan U9, KTD6): the
// CLI creates a map session, the save tab binds to it with the one-time proof,
// the signed-in person approves, and only the CLI picks up the fresh connect
// code, by polling with a secret the browser never sees.
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { after, before, beforeEach, describe, it } from 'node:test'
import type { PrismaClient } from '@prisma/client'
import { authOf, claim, freshMysqlServer, mint, type DevSession, type Handle } from './helpers.js'
import { createTestPrismaClient, mysqlTestsEnabled, resetMysqlRegistry } from './mysql-test-env.js'

const hasDatabaseUrl = mysqlTestsEnabled()

const BINDING_HEADER = 'x-skillet-map-binding'

function newProof(): { proof: string; proof_hash: string } {
  const proof = randomBytes(32).toString('base64url')
  return { proof, proof_hash: createHash('sha256').update(proof, 'utf8').digest('hex') }
}

const nowSec = (): number => Math.floor(Date.now() / 1000)

interface Created {
  id: string
  poll_secret: string
  expires_at: number
  proof: string
}

describe('map sessions (U9)', { skip: !hasDatabaseUrl }, () => {
  let h: Handle
  let prisma: PrismaClient

  before(async () => {
    h = await freshMysqlServer()
    prisma = createTestPrismaClient()
  })

  after(async () => {
    await prisma?.$disconnect()
    await h?.app.close()
  })

  beforeEach(async () => {
    await resetMysqlRegistry(prisma)
  })

  async function signedIn(handle: string, seed: number): Promise<DevSession> {
    const session = await mint(h)
    await claim(h, session, handle, seed)
    return session
  }

  async function create(remoteAddress?: string): Promise<Created> {
    const { proof, proof_hash } = newProof()
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/map-sessions',
      payload: { label: 'test-machine', proof_hash },
      ...(remoteAddress ? { remoteAddress } : {}),
    })
    assert.equal(res.statusCode, 201, res.body)
    return { ...(res.json() as Omit<Created, 'proof'>), proof }
  }

  const bind = (id: string, proof: unknown) =>
    h.app.inject({ method: 'POST', url: `/api/v1/map-sessions/${id}/bind`, payload: { proof } })

  const approve = (id: string, session: DevSession, binding?: string) =>
    h.app.inject({
      method: 'POST',
      url: `/api/v1/map-sessions/${id}/approve`,
      headers: authOf(session),
      payload: binding === undefined ? {} : { binding },
    })

  const poll = (id: string, secret: string) =>
    h.app.inject({ method: 'POST', url: `/api/v1/map-sessions/${id}/poll`, payload: { secret } })

  const status = (id: string, auth: { session?: DevSession; binding?: string; token?: string }) =>
    h.app.inject({
      method: 'GET',
      url: `/api/v1/map-sessions/${id}`,
      headers: {
        ...(auth.session ? authOf(auth.session) : {}),
        ...(auth.token ? { authorization: `Bearer ${auth.token}` } : {}),
        ...(auth.binding ? { [BINDING_HEADER]: auth.binding } : {}),
      },
    })

  async function bound(): Promise<Created & { binding: string }> {
    const created = await create()
    const res = await bind(created.id, created.proof)
    assert.equal(res.statusCode, 200, res.body)
    return { ...created, binding: (res.json() as { binding: string }).binding }
  }

  /** A session approved by `owner`, with its code polled once. */
  async function approvedWithCode(owner: DevSession): Promise<Created & { code: string }> {
    const session = await bound()
    const approved = await approve(session.id, owner, session.binding)
    assert.equal(approved.statusCode, 200, approved.body)
    const got = await poll(session.id, session.poll_secret)
    assert.equal(got.statusCode, 200, got.body)
    return { ...session, code: (got.json() as { code: string }).code }
  }

  const claimCode = (payload: Record<string, unknown>) =>
    h.app.inject({ method: 'POST', url: '/api/v1/connect/claim', payload })

  async function pairDevice(session: DevSession, machineId: string): Promise<{ device_id: string; device_token: string }> {
    const codes = await h.app.inject({ method: 'POST', url: '/api/v1/connect/codes', headers: authOf(session) })
    assert.equal(codes.statusCode, 201, codes.body)
    const claimed = await claimCode({
      code: (codes.json() as { code: string }).code,
      label: 'test-machine',
      client_kind: 'cli',
      machine_id: machineId,
    })
    assert.equal(claimed.statusCode, 201, claimed.body)
    return claimed.json() as { device_id: string; device_token: string }
  }

  it('create, bind, approve and poll hand the CLI one fresh code, which connects a new device', async () => {
    const owner = await signedIn('save-owner', 81)
    // A live Settings code first, so a reuse of it would show.
    const settings = await h.app.inject({ method: 'POST', url: '/api/v1/connect/codes', headers: authOf(owner) })
    assert.equal(settings.statusCode, 201, settings.body)
    const settingsCode = (settings.json() as { code: string }).code

    const created = await create()
    // The id rides the kit-map `session` message, so it has to fit its id shape.
    assert.match(created.id, /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/)
    assert.ok(created.poll_secret.length >= 32)
    assert.ok(created.expires_at > nowSec() + 500 && created.expires_at <= nowSec() + 601)

    const pending = await poll(created.id, created.poll_secret)
    assert.equal(pending.statusCode, 202, pending.body)
    assert.equal((pending.json() as { bound: boolean }).bound, false)

    const bindRes = await bind(created.id, created.proof)
    assert.equal(bindRes.statusCode, 200, bindRes.body)
    const { binding, expires_at } = bindRes.json() as { binding: string; expires_at: number }
    assert.ok(binding.length >= 32)
    assert.equal(expires_at, created.expires_at, 'the binding lives no longer than the session')
    // The CLI can tell the person is signing in.
    const signingIn = await poll(created.id, created.poll_secret)
    assert.equal(signingIn.statusCode, 202, signingIn.body)
    assert.equal((signingIn.json() as { bound: boolean }).bound, true)

    // The binding holder learns the computer's name for the confirm.
    const before = await status(created.id, { binding })
    assert.equal(before.statusCode, 200, before.body)
    assert.equal((before.json() as { state: string }).state, 'pending')
    assert.equal((before.json() as { label: string }).label, 'test-machine')

    const approved = await approve(created.id, owner, binding)
    assert.equal(approved.statusCode, 200, approved.body)
    // Success only: the code reaches nobody but the poller.
    assert.deepEqual(approved.json(), { ok: true })
    assert.doesNotMatch(approved.body, /[A-Z2-9]{8}/)

    const got = await poll(created.id, created.poll_secret)
    assert.equal(got.statusCode, 200, got.body)
    const { code } = got.json() as { code: string }
    assert.match(code, /^[A-Z2-9]{8}$/)
    assert.notEqual(code, settingsCode, 'a fresh code, never the reused Settings one')

    const again = await poll(created.id, created.poll_secret)
    assert.equal(again.statusCode, 409, again.body)
    assert.equal((again.json() as { error: string }).error, 'code_already_delivered')

    // Settings keeps handing out its own code, never the map-session one.
    const settingsAgain = await h.app.inject({ method: 'POST', url: '/api/v1/connect/codes', headers: authOf(owner) })
    assert.equal(settingsAgain.statusCode, 201, settingsAgain.body)
    assert.notEqual((settingsAgain.json() as { code: string }).code, code)

    const claimed = await claimCode({ code, label: 'test-machine', client_kind: 'cli', machine_id: 'test-machine-id' })
    assert.equal(claimed.statusCode, 201, claimed.body)
    const device = claimed.json() as { device_id: string; device_token: string; handle: string }
    assert.ok(device.device_token.startsWith('skillet_d_'))
    assert.equal(device.handle, 'save-owner')

    const connected = await status(created.id, { session: owner })
    assert.equal(connected.statusCode, 200, connected.body)
    assert.equal((connected.json() as { state: string }).state, 'connected')

    // Only the computer that redeemed the code reports, with its own token.
    const otherDevice = await pairDevice(owner, 'test-machine-other')
    const notMine = await h.app.inject({
      method: 'POST',
      url: `/api/v1/map-sessions/${created.id}/result`,
      headers: { authorization: `Bearer ${otherDevice.device_token}` },
      payload: { result: 'applied' },
    })
    assert.equal(notMine.statusCode, 403, notMine.body)
    const bySession = await h.app.inject({
      method: 'POST',
      url: `/api/v1/map-sessions/${created.id}/result`,
      headers: authOf(owner),
      payload: { result: 'applied' },
    })
    assert.equal(bySession.statusCode, 403, bySession.body)

    const reported = await h.app.inject({
      method: 'POST',
      url: `/api/v1/map-sessions/${created.id}/result`,
      headers: { authorization: `Bearer ${device.device_token}` },
      payload: {
        result: 'partial',
        reason: 'backup-refused',
        counts: { backups: 3, removals: 1, fills: 2, merges: 0 },
        left: { backups: 1, removals: 0, fills: 0, merges: 0 },
        not_backed_up: [{ name: 'notes', reason: 'secret', file: 'setup.sh' }],
      },
    })
    assert.equal(reported.statusCode, 200, reported.body)

    const done = await status(created.id, { session: owner })
    assert.equal(done.statusCode, 200, done.body)
    const body = done.json() as {
      state: string
      result: { counts: Record<string, number>; not_backed_up: Array<{ name: string }> }
    }
    assert.equal(body.state, 'partial')
    assert.equal(body.result.counts.backups, 3)
    assert.equal(body.result.not_backed_up[0]?.name, 'notes')

    const bad = await h.app.inject({
      method: 'POST',
      url: `/api/v1/map-sessions/${created.id}/result`,
      headers: { authorization: `Bearer ${device.device_token}` },
      payload: { result: 'applied', path: '/home/test-machine/.claude/skills/notes' },
    })
    assert.equal(bad.statusCode, 422, bad.body)

    // Another signed-in account sees nothing.
    const stranger = await signedIn('save-stranger', 82)
    const peek = await status(created.id, { session: stranger })
    assert.equal(peek.statusCode, 403, peek.body)
  })

  it('refuses a wrong proof, a spent proof, and an approve without a binding', async () => {
    const owner = await signedIn('proof-owner', 83)
    const created = await create()

    const wrong = await bind(created.id, newProof().proof)
    assert.equal(wrong.statusCode, 403, wrong.body)
    assert.equal((wrong.json() as { error: string }).error, 'proof_invalid')

    const first = await bind(created.id, created.proof)
    assert.equal(first.statusCode, 200, first.body)

    const twice = await bind(created.id, created.proof)
    assert.equal(twice.statusCode, 403, twice.body)
    assert.equal((twice.json() as { error: string }).error, 'proof_invalid')

    const missing = await approve(created.id, owner)
    assert.equal(missing.statusCode, 403, missing.body)
    assert.equal((missing.json() as { error: string }).error, 'binding_required')

    const forged = await approve(created.id, owner, randomBytes(32).toString('base64url'))
    assert.equal(forged.statusCode, 403, forged.body)
    assert.equal((forged.json() as { error: string }).error, 'binding_invalid')

    assert.equal((await status(created.id, {})).statusCode, 403)
    assert.equal((await bind('0'.repeat(32), created.proof)).statusCode, 404)
    assert.equal((await approve('0'.repeat(32), owner, 'x'.repeat(43))).statusCode, 404)
    const signedOut = await h.app.inject({
      method: 'POST',
      url: `/api/v1/map-sessions/${created.id}/approve`,
      payload: { binding: (first.json() as { binding: string }).binding },
    })
    assert.equal(signedOut.statusCode, 401, signedOut.body)
  })

  it('refuses a map-session code presented with a device token, and that device keeps its owner', async () => {
    const alice = await signedIn('alice-owner', 84)
    const aliceDevice = await pairDevice(alice, 'test-machine-alice')
    const bob = await signedIn('bob-owner', 85)
    const session = await approvedWithCode(bob)

    const refused = await claimCode({
      code: session.code,
      label: 'test-machine',
      client_kind: 'cli',
      device_token: aliceDevice.device_token,
    })
    assert.equal(refused.statusCode, 403, refused.body)
    assert.equal((refused.json() as { error: string }).error, 'device_token_not_allowed')

    const row = await prisma.devices.findUnique({ where: { id: aliceDevice.device_id }, select: { user_id: true } })
    assert.equal(row?.user_id, alice.user_id, 'the presented device stays on its own account')
    const whoami = await h.app.inject({
      method: 'GET',
      url: '/api/v1/whoami',
      headers: { authorization: `Bearer ${aliceDevice.device_token}` },
    })
    assert.equal(whoami.statusCode, 200, whoami.body)

    // The refusal doesn't spend the code: the CLI's own claim still connects.
    const claimed = await claimCode({ code: session.code, label: 'test-machine', client_kind: 'cli' })
    assert.equal(claimed.statusCode, 201, claimed.body)
    const fresh = claimed.json() as { device_id: string; handle: string }
    assert.equal(fresh.handle, 'bob-owner')
    assert.notEqual(fresh.device_id, aliceDevice.device_id)
  })

  it('polls 202 before approval, 403 on a wrong secret, and 410 once expired', async () => {
    const created = await create()
    const pending = await poll(created.id, created.poll_secret)
    assert.equal(pending.statusCode, 202, pending.body)
    assert.equal((pending.json() as { state: string }).state, 'pending')

    const wrong = await poll(created.id, randomBytes(32).toString('base64url'))
    assert.equal(wrong.statusCode, 403, wrong.body)
    assert.equal((wrong.json() as { error: string }).error, 'poll_secret_invalid')

    await prisma.map_sessions.update({ where: { id: created.id }, data: { expires_at: nowSec() - 1 } })
    const expired = await poll(created.id, created.poll_secret)
    assert.equal(expired.statusCode, 410, expired.body)
    // A wrong secret learns nothing, expired or not.
    assert.equal((await poll(created.id, randomBytes(32).toString('base64url'))).statusCode, 403)
    assert.equal((await bind(created.id, created.proof)).statusCode, 410)
  })

  it('approves once: a second approve is 409, and an expired session is 410', async () => {
    const owner = await signedIn('twice-owner', 86)
    const session = await bound()
    const first = await approve(session.id, owner, session.binding)
    assert.equal(first.statusCode, 200, first.body)
    const second = await approve(session.id, owner, session.binding)
    assert.equal(second.statusCode, 409, second.body)
    assert.equal((second.json() as { error: string }).error, 'map_session_already_approved')

    const late = await bound()
    await prisma.map_sessions.update({ where: { id: late.id }, data: { expires_at: nowSec() - 1 } })
    const expired = await approve(late.id, owner, late.binding)
    assert.equal(expired.statusCode, 410, expired.body)
    assert.equal((expired.json() as { error: string }).error, 'map_session_expired')
    const lateStatus = await status(late.id, { binding: late.binding })
    assert.equal(lateStatus.statusCode, 200, lateStatus.body)
    assert.deepEqual(
      [(lateStatus.json() as { state: string }).state, (lateStatus.json() as { reason?: string }).reason],
      ['expired', 'not-approved'],
    )
  })

  it('a no-username approve is 409 with its own code, and the same binding approves once the username exists', async () => {
    const newcomer = await mint(h)
    const session = await bound()
    const refused = await approve(session.id, newcomer, session.binding)
    assert.equal(refused.statusCode, 409, refused.body)
    assert.equal((refused.json() as { error: string }).error, 'username_required')

    await claim(h, newcomer, 'late-name', 87)
    const approved = await approve(session.id, newcomer, session.binding)
    assert.equal(approved.statusCode, 200, approved.body)
    const got = await poll(session.id, session.poll_secret)
    assert.equal(got.statusCode, 200, got.body)
    const claimed = await claimCode({ code: (got.json() as { code: string }).code, label: 'test-machine', client_kind: 'cli' })
    assert.equal(claimed.statusCode, 201, claimed.body)
    assert.equal((claimed.json() as { handle: string }).handle, 'late-name')
  })

  it('a code unused for 5 minutes expires, and the session says so', async () => {
    const owner = await signedIn('slow-owner', 88)
    const session = await approvedWithCode(owner)
    const row = await prisma.map_sessions.findUnique({ where: { id: session.id } })
    assert.ok(row?.code_expires_at && row.approved_at)
    assert.equal(row.code_expires_at - row.approved_at, 300, 'the code is bound for 5 minutes')

    const past = nowSec() - 1
    await prisma.map_sessions.update({ where: { id: session.id }, data: { code_expires_at: past } })
    await prisma.machine_pair_codes.update({ where: { code: session.code }, data: { expires_at: past } })

    const after = await status(session.id, { session: owner })
    assert.equal(after.statusCode, 200, after.body)
    assert.deepEqual(
      [(after.json() as { state: string }).state, (after.json() as { reason?: string }).reason],
      ['expired', 'code-unused'],
    )
    assert.equal((await poll(session.id, session.poll_secret)).statusCode, 410)
    const claimed = await claimCode({ code: session.code, label: 'test-machine', client_kind: 'cli' })
    assert.equal(claimed.statusCode, 410, claimed.body)

    // Approved but never polled: the code expires the same way.
    const unpolled = await bound()
    assert.equal((await approve(unpolled.id, owner, unpolled.binding)).statusCode, 200)
    await prisma.map_sessions.update({ where: { id: unpolled.id }, data: { code_expires_at: past } })
    assert.equal((await poll(unpolled.id, unpolled.poll_secret)).statusCode, 410)
  })

  it('a burst of creates from one address hits 429', async () => {
    for (let i = 0; i < 10; i++) await create('203.0.113.7')
    const { proof_hash } = newProof()
    const limited = await h.app.inject({
      method: 'POST',
      url: '/api/v1/map-sessions',
      payload: { label: 'test-machine', proof_hash },
      remoteAddress: '203.0.113.7',
    })
    assert.equal(limited.statusCode, 429, limited.body)
    assert.ok(limited.headers['retry-after'], 'a 429 says when to come back')
    // Another address is unaffected.
    await create('203.0.113.8')
  })

  it('refuses a create without a label or a well-formed proof hash', async () => {
    const { proof_hash } = newProof()
    const noLabel = await h.app.inject({ method: 'POST', url: '/api/v1/map-sessions', payload: { proof_hash } })
    assert.equal(noLabel.statusCode, 400, noLabel.body)
    const badHash = await h.app.inject({
      method: 'POST',
      url: '/api/v1/map-sessions',
      payload: { label: 'test-machine', proof_hash: 'not-a-hash' },
    })
    assert.equal(badHash.statusCode, 400, badHash.body)
    const control = await h.app.inject({
      method: 'POST',
      url: '/api/v1/map-sessions',
      payload: { label: 'test\u0007machine', proof_hash },
    })
    assert.equal(control.statusCode, 400, control.body)
  })
})
