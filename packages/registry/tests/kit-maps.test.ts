// The saved kit map and the changes waiting for a computer (kit map plan U9,
// KTD9): one versioned document per account with no paths or usage in it, and
// pending changes a computer claims, applies and acknowledges once.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { after, before, beforeEach, describe, it } from 'node:test'
import type { PrismaClient } from '@prisma/client'
import type { DeviceSyncStreamEvent } from '@skillet/protocol'
import { parseKitMapDocument, parseKitMapPendingChange } from '@skillet/protocol/kit-map'
import { authOf, claim, freshMysqlServer, mint, type DevSession, type Handle } from './helpers.js'
import { createTestPrismaClient, mysqlTestsEnabled, resetMysqlRegistry } from './mysql-test-env.js'
import { subscribeDeviceSyncStream } from '../src/lib/device-sync-stream.js'

const hasDatabaseUrl = mysqlTestsEnabled()

const K = (n: number) => `sha256:${createHash('sha256').update(`kit-map-key-${n}`).digest('hex')}`
const entry = (n: number, name: string) => ({ key: K(n), name, description: `${name} for tests`, source: 'local' })
const bearer = (token: string) => ({ authorization: `Bearer ${token}` })

describe('kit maps and pending changes (U9)', { skip: !hasDatabaseUrl }, () => {
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

  async function pairDevice(session: DevSession, machineId: string): Promise<{ device_id: string; device_token: string }> {
    const codes = await h.app.inject({ method: 'POST', url: '/api/v1/connect/codes', headers: authOf(session) })
    assert.equal(codes.statusCode, 201, codes.body)
    const claimed = await h.app.inject({
      method: 'POST',
      url: '/api/v1/connect/claim',
      payload: { code: (codes.json() as { code: string }).code, label: 'test-machine', client_kind: 'cli', machine_id: machineId },
    })
    assert.equal(claimed.statusCode, 201, claimed.body)
    return claimed.json() as { device_id: string; device_token: string }
  }

  const putMap = (auth: Record<string, string>, body: unknown) =>
    h.app.inject({ method: 'PUT', url: '/api/v1/kit-map', headers: auth, payload: body as Record<string, unknown> })

  const addChanges = (auth: Record<string, string>, changes: unknown[]) =>
    h.app.inject({ method: 'POST', url: '/api/v1/kit-map/changes', headers: auth, payload: { changes } })

  const claimChanges = (token: string, keys: string[]) =>
    h.app.inject({ method: 'POST', url: '/api/v1/kit-map/changes/claim', headers: bearer(token), payload: { keys } })

  it('saves one map per account: a stale version is 409, and a path or a usage mark is refused', async () => {
    const owner = await signedIn('map-owner', 101)
    const none = await h.app.inject({ method: 'GET', url: '/api/v1/kit-map', headers: authOf(owner) })
    assert.equal(none.statusCode, 404, none.body)

    const first = await putMap(authOf(owner), {
      version: 0,
      entries: [entry(1, 'alpha')],
      assignments: { [K(1)]: 'writing.emails' },
    })
    assert.equal(first.statusCode, 200, first.body)
    assert.deepEqual(first.json(), { version: 1 })

    const stale = await putMap(authOf(owner), { version: 0, entries: [], assignments: {} })
    assert.equal(stale.statusCode, 409, stale.body)
    assert.equal((stale.json() as { error: string }).error, 'version_conflict')
    assert.equal((stale.json() as { version: number }).version, 1)

    // A device writes the same account's map.
    const device = await pairDevice(owner, 'test-machine-map')
    const second = await putMap(bearer(device.device_token), {
      version: 1,
      entries: [entry(1, 'alpha'), entry(2, 'beta')],
      assignments: { [K(1)]: 'writing.emails', [K(2)]: null },
    })
    assert.equal(second.statusCode, 200, second.body)
    assert.deepEqual(second.json(), { version: 2 })

    const read = await h.app.inject({ method: 'GET', url: '/api/v1/kit-map', headers: authOf(owner) })
    assert.equal(read.statusCode, 200, read.body)
    const doc = parseKitMapDocument(read.json())
    assert.ok(doc, `the saved map reads back as a kit-map document: ${read.body}`)
    assert.equal(doc.version, 2)
    assert.deepEqual(doc.entries.map((e) => e.name), ['alpha', 'beta'])
    assert.deepEqual(doc.assignments, { [K(1)]: 'writing.emails', [K(2)]: null })

    const withPath = await putMap(authOf(owner), {
      version: 2,
      entries: [{ ...entry(1, 'alpha'), path: '/home/test-machine/.claude/skills/alpha' }],
      assignments: {},
    })
    assert.equal(withPath.statusCode, 422, withPath.body)
    const withUsage = await putMap(authOf(owner), {
      version: 2,
      entries: [{ ...entry(1, 'alpha'), usage: { state: 'unused', reason: 'no-recent-run' } }],
      assignments: {},
    })
    assert.equal(withUsage.statusCode, 422, withUsage.body)

    const after = await h.app.inject({ method: 'GET', url: '/api/v1/kit-map', headers: authOf(owner) })
    assert.equal((after.json() as { version: number }).version, 2, 'a refused write changes nothing')

    // Another account has its own map, or none.
    const other = await signedIn('map-other', 102)
    const theirs = await h.app.inject({ method: 'GET', url: '/api/v1/kit-map', headers: authOf(other) })
    assert.equal(theirs.statusCode, 404, theirs.body)
  })

  it('a computer acknowledges a pending change once', async () => {
    const owner = await signedIn('ack-owner', 103)
    const device = await pairDevice(owner, 'test-machine-ack')

    const created = await addChanges(bearer(device.device_token), [{ kind: 'remove', key: K(1) }])
    assert.equal(created.statusCode, 201, created.body)
    const [change] = (created.json() as { changes: unknown[] }).changes
    const parsed = parseKitMapPendingChange(change)
    assert.ok(parsed && parsed.kind === 'remove', `the wire change parses as a remove: ${created.body}`)
    assert.equal(parsed.device, device.device_id, "a computer's own change targets it")
    assert.equal(parsed.key, K(1))

    const listed = await h.app.inject({ method: 'GET', url: '/api/v1/kit-map/changes', headers: bearer(device.device_token) })
    assert.equal(listed.statusCode, 200, listed.body)
    assert.deepEqual((listed.json() as { changes: unknown[] }).changes, [change])

    const ack = (token: string) =>
      h.app.inject({
        method: 'POST',
        url: `/api/v1/kit-map/changes/${parsed.id}/ack`,
        headers: bearer(token),
        payload: { outcome: 'applied' },
      })
    const other = await pairDevice(owner, 'test-machine-ack-other')
    assert.equal((await ack(other.device_token)).statusCode, 404, 'only the target computer acknowledges')
    const first = await ack(device.device_token)
    assert.equal(first.statusCode, 200, first.body)
    const second = await ack(device.device_token)
    assert.equal(second.statusCode, 409, second.body)
    assert.equal((second.json() as { error: string }).error, 'already_acknowledged')

    const empty = await h.app.inject({ method: 'GET', url: '/api/v1/kit-map/changes', headers: bearer(device.device_token) })
    assert.deepEqual((empty.json() as { changes: unknown[] }).changes, [])
  })

  it('a device-less change goes to the first computer that connects after it and holds its hashes', async () => {
    const owner = await signedIn('drop-owner', 104)
    // Connected long before the dropped-folder Save.
    const early = await pairDevice(owner, 'test-machine-early')
    await prisma.devices.update({
      where: { id: early.device_id },
      data: { connected_at: Math.floor(Date.now() / 1000) - 3600 },
    })

    const created = await addChanges(authOf(owner), [{ kind: 'merge', job: 'writing.emails', keys: [K(1), K(2)] }])
    assert.equal(created.statusCode, 201, created.body)
    const [change] = (created.json() as { changes: unknown[] }).changes
    const parsed = parseKitMapPendingChange(change)
    assert.ok(parsed && parsed.kind === 'merge', created.body)
    assert.equal(parsed.device, null, 'a dropped-folder change has no computer yet')

    const tooEarly = await claimChanges(early.device_token, [K(1), K(2)])
    assert.equal(tooEarly.statusCode, 200, tooEarly.body)
    assert.deepEqual((tooEarly.json() as { claimed: unknown[] }).claimed, [], 'a computer connected before the change never claims it')

    const later = await pairDevice(owner, 'test-machine-later')
    const missing = await claimChanges(later.device_token, [K(1), K(9)])
    assert.deepEqual((missing.json() as { claimed: unknown[] }).claimed, [], 'a scan without every hash leaves it')

    const won = await claimChanges(later.device_token, [K(1), K(2), K(9)])
    assert.equal(won.statusCode, 200, won.body)
    const claimed = (won.json() as { claimed: unknown[] }).claimed.map((c) => parseKitMapPendingChange(c))
    assert.equal(claimed.length, 1)
    assert.equal(claimed[0]?.id, parsed.id)
    assert.equal(claimed[0]?.device, later.device_id)

    const third = await pairDevice(owner, 'test-machine-third')
    const late = await claimChanges(third.device_token, [K(1), K(2)])
    assert.deepEqual((late.json() as { claimed: unknown[] }).claimed, [], 'a second computer cannot claim it too')

    const mine = await h.app.inject({ method: 'GET', url: '/api/v1/kit-map/changes', headers: bearer(later.device_token) })
    assert.deepEqual(
      (mine.json() as { changes: unknown[] }).changes.map((c) => parseKitMapPendingChange(c)?.id),
      [parsed.id],
    )
    const theirs = await h.app.inject({ method: 'GET', url: '/api/v1/kit-map/changes', headers: bearer(third.device_token) })
    assert.deepEqual((theirs.json() as { changes: unknown[] }).changes, [])
  })

  it('writing a pending change wakes the owner device-sync stream', async () => {
    const owner = await signedIn('wake-owner', 105)
    const before = await prisma.users.findUnique({ where: { id: owner.user_id }, select: { device_sync_seq: true } })
    const seen: DeviceSyncStreamEvent[] = []
    const stop = subscribeDeviceSyncStream(owner.user_id, (events) => seen.push(...events))
    try {
      const created = await addChanges(authOf(owner), [{ kind: 'remove', key: K(3) }])
      assert.equal(created.statusCode, 201, created.body)
    } finally {
      stop()
    }
    const after = await prisma.users.findUnique({ where: { id: owner.user_id }, select: { device_sync_seq: true } })
    assert.equal(after?.device_sync_seq, (before?.device_sync_seq ?? 0) + 1)
    assert.deepEqual(seen, [{ type: 'sync_required', seq: after?.device_sync_seq }])
  })

  it('refuses a change it cannot read, and a target that is not the account computer', async () => {
    const owner = await signedIn('guard-owner', 106)
    const device = await pairDevice(owner, 'test-machine-guard')
    const stranger = await signedIn('guard-stranger', 107)
    const theirDevice = await pairDevice(stranger, 'test-machine-stranger')

    const unknownKind = await addChanges(authOf(owner), [{ kind: 'teleport', key: K(1) }])
    assert.equal(unknownKind.statusCode, 422, unknownKind.body)
    const extraField = await addChanges(authOf(owner), [{ kind: 'remove', key: K(1), path: '/home/test-machine/x' }])
    assert.equal(extraField.statusCode, 422, extraField.body)
    const selfReplace = await addChanges(authOf(owner), [{ kind: 'replace', merged: K(1), keys: [K(1)] }])
    assert.equal(selfReplace.statusCode, 422, selfReplace.body)
    const named = await addChanges(authOf(owner), [{ kind: 'remove', key: K(1), id: 'mine' }])
    assert.equal(named.statusCode, 422, named.body)
    const hugeVersion = await addChanges(authOf(owner), [{ kind: 'remove', key: K(1), version: 2 ** 40 }])
    assert.equal(hugeVersion.statusCode, 422, hugeVersion.body)
    assert.equal(await prisma.kit_map_changes.count(), 0, 'a refused write records nothing')

    const foreign = await addChanges(authOf(owner), [{ kind: 'remove', key: K(1), device: theirDevice.device_id }])
    assert.equal(foreign.statusCode, 422, foreign.body)
    const targeted = await addChanges(authOf(owner), [{ kind: 'replace', merged: K(5), keys: [K(1), K(2)], device: device.device_id }])
    assert.equal(targeted.statusCode, 201, targeted.body)
    const deviceElsewhere = await addChanges(bearer(device.device_token), [{ kind: 'remove', key: K(1), device: theirDevice.device_id }])
    assert.equal(deviceElsewhere.statusCode, 422, deviceElsewhere.body)

    const sessionClaim = await h.app.inject({
      method: 'POST',
      url: '/api/v1/kit-map/changes/claim',
      headers: authOf(owner),
      payload: { keys: [K(1)] },
    })
    assert.equal(sessionClaim.statusCode, 403, sessionClaim.body)

    // The web sees every waiting change on the account, and only its own.
    const all = await h.app.inject({ method: 'GET', url: '/api/v1/kit-map/changes', headers: authOf(owner) })
    assert.equal((all.json() as { changes: unknown[] }).changes.length, 1)
    const none = await h.app.inject({ method: 'GET', url: '/api/v1/kit-map/changes', headers: authOf(stranger) })
    assert.deepEqual((none.json() as { changes: unknown[] }).changes, [])
  })
})
