// The merges a computer writes for the kit map (kit map plan U14, KTD12 KTD13
// KTD14): one record per merge change, reported only by the computer that
// change targets, read back by it and by the web in the protocol's own shape,
// never overwritten once the person picked it, and crediting the sources its
// merged backup holds.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { after, before, beforeEach, describe, it } from 'node:test'
import type { PrismaClient } from '@prisma/client'
import { canonicalContentHash, decodeBundle, type BundleFiles } from '@skillet/protocol'
import { kitMapMergeCredits, parseKitMapMerge, type KitMapMerge } from '@skillet/protocol/kit-map'
import { addSkillVersionPrisma, authOf, claim, freshMysqlServer, mint, type DevSession, type Handle } from './helpers.js'
import { createTestPrismaClient, mysqlTestsEnabled, resetMysqlRegistry } from './mysql-test-env.js'

const hasDatabaseUrl = mysqlTestsEnabled()

const K = (n: number) => `sha256:${createHash('sha256').update(`merge-key-${n}`).digest('hex')}`
const bearer = (token: string) => ({ authorization: `Bearer ${token}` })

function bundleOf(files: Record<string, string>): { files: BundleFiles; hash: string } {
  const wire: BundleFiles = {}
  for (const [path, data] of Object.entries(files)) wire[path] = { enc: 'utf8', data }
  return { files: wire, hash: canonicalContentHash(decodeBundle(wire)) }
}

const MERGED = bundleOf({ 'SKILL.md': '---\nname: editing-merged\ndescription: One editing skill.\n---\n\n# Editing\n' })
const BRIEF = 'Tighten this note for a stranger: the meeting moved to Friday.'
const rounds = (keys: string[]) =>
  keys.map((key, i) => ({ key, merged: `Merged take ${i}, written fresh.`, original: `Original take ${i}.` }))

describe('map merges (U14)', { skip: !hasDatabaseUrl }, () => {
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

  /** A merge change, recorded by the computer the way Save records it. */
  async function recordMerge(token: string, keys: string[], job = 'writing.editing'): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/kit-map/changes',
      headers: bearer(token),
      payload: { changes: [{ kind: 'merge', job, keys }] },
    })
    assert.equal(res.statusCode, 201, res.body)
    return (res.json() as { changes: Array<{ id: string }> }).changes[0]!.id
  }

  const report = (auth: Record<string, string>, id: string, body: unknown) =>
    h.app.inject({ method: 'PUT', url: `/api/v1/map-merges/${id}`, headers: auth, payload: body as Record<string, unknown> })

  const backUp = (auth: Record<string, string>, sources: unknown[]) =>
    h.app.inject({
      method: 'PUT',
      url: `/api/v1/backups/${MERGED.hash}`,
      headers: auth,
      payload: { files: MERGED.files, name: 'editing-merged', description: 'One editing skill.', tools: ['claude-code'], origin: 'merge', sources },
    })

  async function list(auth: Record<string, string>): Promise<KitMapMerge[]> {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/map-merges', headers: auth })
    assert.equal(res.statusCode, 200, res.body)
    const merges = (res.json() as { merges: unknown[] }).merges
    return merges.map((merge) => {
      const parsed = parseKitMapMerge(merge)
      assert.ok(parsed, `each merge reads back as the protocol's record: ${JSON.stringify(merge)}`)
      return parsed
    })
  }

  async function one(auth: Record<string, string>, id: string): Promise<KitMapMerge> {
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/map-merges/${id}`, headers: auth })
    assert.equal(res.statusCode, 200, res.body)
    const parsed = parseKitMapMerge(res.json())
    assert.ok(parsed, `the merge reads back as the protocol's record: ${res.body}`)
    return parsed
  }

  it('AE1: a merge waits for its computer, which reports writing, then ready with one blind round per original', async () => {
    const owner = await signedIn('merge-owner', 111)
    const device = await pairDevice(owner, 'test-machine-merge')
    const keys = [K(1), K(2), K(3), K(4)]
    const id = await recordMerge(device.device_token, keys)

    const waiting = await list(bearer(device.device_token))
    assert.deepEqual(
      waiting.map((m) => [m.id, m.status, m.job, m.keys, m.device]),
      [[id, 'waiting', 'writing.editing', keys, device.device_id]],
      'saved, and waiting for the computer to write it',
    )

    const writing = await report(bearer(device.device_token), id, { status: 'writing' })
    assert.equal(writing.statusCode, 200, writing.body)
    assert.equal((await list(bearer(device.device_token)))[0]?.status, 'writing')

    const ready = { status: 'ready', merged: MERGED.hash, brief: BRIEF, rounds: rounds(keys) }
    const early = await report(bearer(device.device_token), id, ready)
    assert.equal(early.statusCode, 422, early.body)
    assert.equal((early.json() as { error: string }).error, 'merged_not_backed_up', 'a ready merge names a merged skill the account backs up')

    const backup = await backUp(bearer(device.device_token), keys.map((key) => ({ key, private: true })))
    assert.equal(backup.statusCode, 201, backup.body)
    const stored = await report(bearer(device.device_token), id, ready)
    assert.equal(stored.statusCode, 200, stored.body)

    for (const auth of [bearer(device.device_token), authOf(owner)]) {
      const merge = await one(auth, id)
      assert.equal(merge.status, 'ready')
      assert.equal(merge.merged, MERGED.hash)
      assert.equal(merge.brief, BRIEF)
      assert.deepEqual(merge.rounds, rounds(keys))
      assert.equal(merge.rounds?.flatMap((r) => [r.merged, r.original]).length, 8, 'eight samples, four merged and four original')
      assert.equal(kitMapMergeCredits(merge.sources ?? []).privateLabel, '4 private skills')
    }
    const listed = await list(authOf(owner))
    assert.deepEqual(listed.map((m) => [m.id, m.status, m.merged]), [[id, 'ready', MERGED.hash]], 'the web sees it too')
    assert.equal(listed[0]?.rounds, undefined, 'the list carries no samples')

    // The original change is still the computer's to acknowledge; the merge record outlives it.
    const ack = await h.app.inject({
      method: 'POST',
      url: `/api/v1/kit-map/changes/${id}/ack`,
      headers: bearer(device.device_token),
      payload: { outcome: 'written' },
    })
    assert.equal(ack.statusCode, 200, ack.body)
    assert.equal((await list(authOf(owner)))[0]?.status, 'ready')
  })

  it('AE5: the merged skill credits two public sources by maker and link, and counts one private one', async () => {
    const owner = await signedIn('credit-owner', 112)
    const device = await pairDevice(owner, 'test-machine-credit')
    const managed = K(11)
    const matched = K(12)
    const unmatched = K(13)
    await addSkillVersionPrisma(prisma, 'every', 'house-style', managed, 1_700_000_000)
    await addSkillVersionPrisma(prisma, 'maker-one', 'tidy-notes', matched, 1_700_000_100)
    const id = await recordMerge(device.device_token, [managed, matched, unmatched])

    const lookup = await h.app.inject({
      method: 'POST',
      url: '/api/v1/backups/sources',
      headers: bearer(device.device_token),
      payload: { keys: [managed, matched, unmatched] },
    })
    assert.equal(lookup.statusCode, 200, lookup.body)
    const found = (lookup.json() as { sources: Array<{ key: string; ref?: string; private?: boolean }> }).sources
    assert.deepEqual(
      found.map((s) => s.ref ?? 'private'),
      ['@every/house-style', '@maker-one/tidy-notes', 'private'],
    )

    const sources = [
      { key: managed, ref: '@every/house-style', name: 'House Style' },
      { key: matched, ref: '@maker-one/tidy-notes', name: 'tidy-notes' },
      { key: unmatched, private: true },
    ]
    assert.equal((await backUp(bearer(device.device_token), sources)).statusCode, 201)
    const stored = await report(bearer(device.device_token), id, {
      status: 'ready',
      merged: MERGED.hash,
      brief: BRIEF,
      rounds: rounds([managed, matched, unmatched]),
    })
    assert.equal(stored.statusCode, 200, stored.body)

    const merge = await one(authOf(owner), id)
    assert.deepEqual(merge.sources, sources)
    const credits = kitMapMergeCredits(merge.sources!)
    assert.deepEqual(credits.linked.map((s) => s.ref), ['@every/house-style', '@maker-one/tidy-notes'])
    assert.equal(credits.privateLabel, '1 private skill')
    // R24: the merged skill is a private backup, never a skills row.
    assert.equal(await prisma.skills.count({ where: { author_id: 'credit-owner' } }), 0)
  })

  it('takes reports only from the computer the merge change targets, only for merges, and only in the shape the protocol reads', async () => {
    const owner = await signedIn('report-owner', 113)
    const mine = await pairDevice(owner, 'test-machine-mine')
    const other = await pairDevice(owner, 'test-machine-other')
    const keys = [K(21), K(22)]
    const id = await recordMerge(mine.device_token, keys)

    const fromOther = await report(bearer(other.device_token), id, { status: 'writing' })
    assert.equal(fromOther.statusCode, 404, fromOther.body)
    const fromWeb = await report(authOf(owner), id, { status: 'writing' })
    assert.equal(fromWeb.statusCode, 403, fromWeb.body)
    const anonymous = await h.app.inject({ method: 'PUT', url: `/api/v1/map-merges/${id}`, payload: { status: 'writing' } })
    assert.equal(anonymous.statusCode, 401, anonymous.body)

    const remove = await h.app.inject({
      method: 'POST',
      url: '/api/v1/kit-map/changes',
      headers: bearer(mine.device_token),
      payload: { changes: [{ kind: 'remove', key: K(23) }] },
    })
    const removeId = (remove.json() as { changes: Array<{ id: string }> }).changes[0]!.id
    const notMerge = await report(bearer(mine.device_token), removeId, { status: 'writing' })
    assert.equal(notMerge.statusCode, 404, notMerge.body)

    assert.equal((await backUp(bearer(mine.device_token), keys.map((key) => ({ key, private: true })))).statusCode, 201)
    const bad: unknown[] = [
      { status: 'picked' },
      { status: 'applied' },
      { status: 'failed' },
      { status: 'ready', merged: MERGED.hash, brief: BRIEF, rounds: rounds(keys).slice(1) },
      { status: 'ready', merged: MERGED.hash, brief: BRIEF, rounds: rounds([K(21), K(99)]) },
      { status: 'ready', merged: K(21), brief: BRIEF, rounds: rounds(keys) },
      { status: 'ready', merged: MERGED.hash, brief: BRIEF, rounds: rounds(keys), keys: [K(98), K(99)] },
      { status: 'writing', path: '/Users/test-machine/.claude/skills/x' },
    ]
    for (const body of bad) {
      const res = await report(bearer(mine.device_token), id, body)
      assert.equal(res.statusCode, 422, `${JSON.stringify(body)}: ${res.body}`)
    }
    assert.equal(await prisma.map_merges.count(), 0, 'nothing refused is stored')

    const otherList = await list(bearer(other.device_token))
    assert.deepEqual(otherList, [], 'a computer sees only its own merges')
    const missing = await h.app.inject({ method: 'GET', url: `/api/v1/map-merges/${id}`, headers: bearer(other.device_token) })
    assert.equal(missing.statusCode, 404, missing.body)
    const stranger = await signedIn('report-stranger', 114)
    assert.deepEqual(await list(authOf(stranger)), [], 'another account sees none of them')
  })

  it('a failure says why and the merge waits; out of date keeps what was written; a picked merge is never overwritten', async () => {
    const owner = await signedIn('status-owner', 115)
    const device = await pairDevice(owner, 'test-machine-status')
    const keys = [K(31), K(32)]
    const id = await recordMerge(device.device_token, keys)

    const failed = await report(bearer(device.device_token), id, { status: 'failed', reason: 'no-ai-tool' })
    assert.equal(failed.statusCode, 200, failed.body)
    const seen = await one(authOf(owner), id)
    assert.equal(seen.status, 'failed')
    assert.equal(seen.reason, 'no-ai-tool')
    assert.equal(seen.merged, undefined)

    assert.equal((await backUp(bearer(device.device_token), keys.map((key) => ({ key, private: true })))).statusCode, 201)
    const ready = { status: 'ready', merged: MERGED.hash, brief: BRIEF, rounds: rounds(keys) }
    assert.equal((await report(bearer(device.device_token), id, ready)).statusCode, 200)
    const stale = await report(bearer(device.device_token), id, { status: 'out-of-date', reason: 'sources-changed' })
    assert.equal(stale.statusCode, 200, stale.body)
    const outOfDate = await one(authOf(owner), id)
    assert.equal(outOfDate.status, 'out-of-date')
    assert.equal(outOfDate.reason, 'sources-changed')
    assert.equal(outOfDate.merged, MERGED.hash, 'what was written stays on record')
    assert.deepEqual(outOfDate.rounds, rounds(keys))

    // The person picked the merge on skillet.md (U15): no report moves it back.
    await prisma.map_merges.update({ where: { id }, data: { status: 'picked', reason: null } })
    for (const body of [ready, { status: 'writing' }, { status: 'failed', reason: 'timeout' }]) {
      const res = await report(bearer(device.device_token), id, body)
      assert.equal(res.statusCode, 409, res.body)
      assert.equal((res.json() as { error: string }).error, 'merge_picked')
    }
    assert.equal((await one(authOf(owner), id)).status, 'picked')
  })
})
