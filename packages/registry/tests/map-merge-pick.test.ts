// The blind pick, the replace it asks for, and publishing a merged skill (kit
// map plan U15, KTD13 KTD14; R22 R23 R25, AE1 AE5).
//
// The person picks on skillet.md. "Use merged" is taken only when the merged
// skill won more than half its rounds, and it leaves a replace change for the
// computer that holds the originals, waking it like every other change. "Keep
// originals" deletes the merged backup and leaves the originals alone. The
// computer's acknowledgment of the replace moves the merge on. Publishing the
// merged bundle copies the sources its backup credits into the new version,
// and the public page lists them, a private one only as a count.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { after, before, beforeEach, describe, it } from 'node:test'
import type { PrismaClient } from '@prisma/client'
import { canonicalContentHash, decodeBundle, type BundleFiles } from '@skillet/protocol'
import { parseKitMapMerge, parseKitMapPendingChange, type KitMapMerge } from '@skillet/protocol/kit-map'
import { addSkillVersionPrisma, authOf, claim, freshMysqlServer, mint, type DevSession, type Handle } from './helpers.js'
import { createTestPrismaClient, mysqlTestsEnabled, resetMysqlRegistry } from './mysql-test-env.js'

const hasDatabaseUrl = mysqlTestsEnabled()

const K = (n: number) => `sha256:${createHash('sha256').update(`pick-key-${n}`).digest('hex')}`
const bearer = (token: string) => ({ authorization: `Bearer ${token}` })

function bundleOf(files: Record<string, string>): { files: BundleFiles; hash: string } {
  const wire: BundleFiles = {}
  for (const [path, data] of Object.entries(files)) wire[path] = { enc: 'utf8', data }
  return { files: wire, hash: canonicalContentHash(decodeBundle(wire)) }
}

const MERGED = bundleOf({
  'SKILL.md': '---\nname: Editing\ndescription: One editing skill, merged from four.\n---\n\n# Editing\n\nEdit prose so a stranger reads it once.\n',
})
const BRIEF = 'Tighten this note for a stranger: the meeting moved to Friday.'
const rounds = (keys: string[]) =>
  keys.map((key, i) => ({ key, merged: `Merged take ${i}, written fresh.`, original: `Original take ${i}.` }))

describe('the blind pick, the replace and publish (U15)', { skip: !hasDatabaseUrl }, () => {
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

  /** A merge the computer wrote and stored, ready for the person to pick. */
  async function readyMerge(
    token: string,
    keys: string[],
    sources: unknown[] = keys.map((key) => ({ key, private: true })),
  ): Promise<string> {
    const recorded = await h.app.inject({
      method: 'POST',
      url: '/api/v1/kit-map/changes',
      headers: bearer(token),
      payload: { changes: [{ kind: 'merge', job: 'writing.editing', keys }] },
    })
    assert.equal(recorded.statusCode, 201, recorded.body)
    const id = (recorded.json() as { changes: Array<{ id: string }> }).changes[0]!.id
    const backup = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/backups/${MERGED.hash}`,
      headers: bearer(token),
      payload: { files: MERGED.files, name: 'Editing', description: 'One editing skill.', tools: ['claude-code', 'codex'], origin: 'merge', sources },
    })
    assert.ok(backup.statusCode === 201 || backup.statusCode === 200, backup.body)
    const ready = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/map-merges/${id}`,
      headers: bearer(token),
      payload: { status: 'ready', merged: MERGED.hash, brief: BRIEF, rounds: rounds(keys) },
    })
    assert.equal(ready.statusCode, 200, ready.body)
    const ack = await h.app.inject({
      method: 'POST',
      url: `/api/v1/kit-map/changes/${id}/ack`,
      headers: bearer(token),
      payload: { outcome: 'written' },
    })
    assert.equal(ack.statusCode, 200, ack.body)
    return id
  }

  const pick = (auth: Record<string, string>, id: string, body: unknown) =>
    h.app.inject({ method: 'POST', url: `/api/v1/map-merges/${id}/pick`, headers: auth, payload: body as Record<string, unknown> })

  async function one(auth: Record<string, string>, id: string): Promise<KitMapMerge> {
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/map-merges/${id}`, headers: auth })
    assert.equal(res.statusCode, 200, res.body)
    const parsed = parseKitMapMerge(res.json())
    assert.ok(parsed, `the merge reads back as the protocol's record: ${res.body}`)
    return parsed
  }

  async function listed(auth: Record<string, string>): Promise<KitMapMerge[]> {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/map-merges', headers: auth })
    assert.equal(res.statusCode, 200, res.body)
    return (res.json() as { merges: unknown[] }).merges.map((m) => {
      const parsed = parseKitMapMerge(m)
      assert.ok(parsed, JSON.stringify(m))
      return parsed
    })
  }

  async function changesFor(token: string) {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/kit-map/changes', headers: bearer(token) })
    assert.equal(res.statusCode, 200, res.body)
    return (res.json() as { changes: unknown[] }).changes.map((c) => parseKitMapPendingChange(c))
  }

  const seq = async (userId: string) =>
    (await prisma.users.findUnique({ where: { id: userId }, select: { device_sync_seq: true } }))?.device_sync_seq ?? 0

  it('AE1: a merge that won 3 of 4 rounds takes "Use merged", which leaves a replace for the computer holding the originals and wakes it', async () => {
    const owner = await signedIn('pick-owner', 121)
    const device = await pairDevice(owner, 'test-machine-pick')
    const keys = [K(1), K(2), K(3), K(4)]
    const id = await readyMerge(device.device_token, keys)
    const before = await seq(owner.user_id)

    const res = await pick(authOf(owner), id, { use: 'merged', won: [K(1), K(2), K(4)] })
    assert.equal(res.statusCode, 200, res.body)
    assert.equal(parseKitMapMerge((res.json() as { merge: unknown }).merge)?.status, 'picked')
    assert.equal(await seq(owner.user_id), before + 1, 'the computer is woken, like every other change')

    const waiting = await changesFor(device.device_token)
    assert.deepEqual(
      waiting.map((c) => c && c.kind === 'replace' ? [c.kind, c.device, c.merged, c.keys] : c?.kind),
      [['replace', device.device_id, MERGED.hash, keys]],
      'one replace, for the computer that wrote the merge from its originals',
    )
    assert.equal((await one(authOf(owner), id)).status, 'picked')

    const again = await pick(authOf(owner), id, { use: 'merged', won: [K(1), K(2), K(4)] })
    assert.equal(again.statusCode, 409, again.body)
    assert.equal((await changesFor(device.device_token)).length, 1, 'a second tap makes no second replace')

    // The computer puts it in place and says so.
    const replaceId = (waiting[0] as { id: string }).id
    const ack = await h.app.inject({
      method: 'POST',
      url: `/api/v1/kit-map/changes/${replaceId}/ack`,
      headers: bearer(device.device_token),
      payload: { outcome: 'applied' },
    })
    assert.equal(ack.statusCode, 200, ack.body)
    for (const auth of [authOf(owner), bearer(device.device_token)]) {
      assert.equal((await one(auth, id)).status, 'applied')
      assert.deepEqual((await listed(auth)).map((m) => [m.id, m.status]), [[id, 'applied']])
    }
  })

  it('AE1: a merge that won 2 of 4 offers only "Keep originals", which deletes the merged backup and leaves the originals alone', async () => {
    const owner = await signedIn('keep-owner', 122)
    const device = await pairDevice(owner, 'test-machine-keep')
    const keys = [K(11), K(12), K(13), K(14)]
    const id = await readyMerge(device.device_token, keys)

    const tie = await pick(authOf(owner), id, { use: 'merged', won: [K(11), K(12)] })
    assert.equal(tie.statusCode, 422, tie.body)
    assert.equal((tie.json() as { error: string }).error, 'merge_did_not_win')
    assert.equal((await one(authOf(owner), id)).status, 'ready', 'a tie changes nothing')

    const before = await seq(owner.user_id)
    const kept = await pick(authOf(owner), id, { use: 'originals', won: [K(11), K(12)] })
    assert.equal(kept.statusCode, 200, kept.body)
    assert.equal((kept.json() as { merge: unknown }).merge, null)

    const backup = await h.app.inject({ method: 'GET', url: `/api/v1/backups/${MERGED.hash}`, headers: authOf(owner) })
    assert.equal(backup.statusCode, 404, 'the merged backup is gone')
    assert.deepEqual(await listed(authOf(owner)), [], 'the merge is gone from the map')
    assert.deepEqual(await changesFor(device.device_token), [], 'no replace: the originals stay as they are')
    assert.equal(await seq(owner.user_id), before, 'nothing for the computer to do')
    assert.equal(
      (await prisma.kit_map_changes.findUnique({ where: { id }, select: { outcome: true } }))?.outcome,
      'written',
      'the merge change the computer already acknowledged is left as it was',
    )
  })

  it('keeping the originals of a merge whose change is still open closes the change, so the computer never writes it again', async () => {
    const owner = await signedIn('keep-open-owner', 123)
    const device = await pairDevice(owner, 'test-machine-open')
    const keys = [K(21), K(22)]
    const id = await readyMerge(device.device_token, keys)
    await prisma.kit_map_changes.update({ where: { id }, data: { acknowledged_at: null, outcome: null } })

    const kept = await pick(authOf(owner), id, { use: 'originals', won: [] })
    assert.equal(kept.statusCode, 200, kept.body)
    assert.deepEqual(await changesFor(device.device_token), [], 'nothing waits for the computer')
    assert.equal((await prisma.kit_map_changes.findUnique({ where: { id }, select: { outcome: true } }))?.outcome, 'kept-originals')
  })

  it('only the signed-in person picks, only a ready merge, and only in the shape the protocol reads', async () => {
    const owner = await signedIn('guard-owner', 124)
    const device = await pairDevice(owner, 'test-machine-guard')
    const keys = [K(31), K(32), K(33)]
    const id = await readyMerge(device.device_token, keys)

    const fromComputer = await pick(bearer(device.device_token), id, { use: 'merged', won: [K(31), K(32)] })
    assert.equal(fromComputer.statusCode, 403, 'a pick is the person’s, never a computer’s')
    const stranger = await signedIn('guard-stranger', 125)
    const fromStranger = await pick(authOf(stranger), id, { use: 'merged', won: [K(31), K(32)] })
    assert.equal(fromStranger.statusCode, 404, fromStranger.body)
    const anonymous = await h.app.inject({ method: 'POST', url: `/api/v1/map-merges/${id}/pick`, payload: { use: 'originals', won: [] } })
    assert.equal(anonymous.statusCode, 401, anonymous.body)
    for (const body of [{ use: 'merged' }, { use: 'merged', won: [K(31), K(99)] }, { use: 'both', won: [] }, { use: 'merged', won: [K(31), K(31)] }]) {
      const res = await pick(authOf(owner), id, body)
      assert.equal(res.statusCode, 422, `${JSON.stringify(body)}: ${res.body}`)
    }

    // A merge that isn't ready yet can't be picked.
    const other = await h.app.inject({
      method: 'POST',
      url: '/api/v1/kit-map/changes',
      headers: bearer(device.device_token),
      payload: { changes: [{ kind: 'merge', job: 'writing.short-posts', keys: [K(34), K(35)] }] },
    })
    const waitingId = (other.json() as { changes: Array<{ id: string }> }).changes[0]!.id
    const early = await pick(authOf(owner), waitingId, { use: 'originals', won: [] })
    assert.equal(early.statusCode, 404, 'nothing written yet, nothing to pick')
    assert.equal((await one(authOf(owner), id)).status, 'ready')
  })

  it('a replace the computer found out of date marks the merge out of date, with why', async () => {
    const owner = await signedIn('stale-owner', 126)
    const device = await pairDevice(owner, 'test-machine-stale')
    const keys = [K(41), K(42), K(43)]
    const id = await readyMerge(device.device_token, keys)
    assert.equal((await pick(authOf(owner), id, { use: 'merged', won: [K(41), K(42)] })).statusCode, 200)
    const [replace] = await changesFor(device.device_token)
    const ack = await h.app.inject({
      method: 'POST',
      url: `/api/v1/kit-map/changes/${(replace as { id: string }).id}/ack`,
      headers: bearer(device.device_token),
      payload: { outcome: 'sources-changed' },
    })
    assert.equal(ack.statusCode, 200, ack.body)
    const merge = await one(authOf(owner), id)
    assert.equal(merge.status, 'out-of-date')
    assert.equal(merge.reason, 'sources-changed')
    assert.equal(merge.merged, MERGED.hash)
  })

  async function publish(session: DevSession, author: string, slug: string, files: BundleFiles, metadata?: Record<string, unknown>) {
    return h.app.inject({
      method: 'POST',
      url: '/api/v1/skills',
      headers: authOf(session),
      payload: { author, slug, files, publish_auth: 'session', visibility: 'public', ...(metadata ? { metadata } : {}) },
    })
  }

  it('AE5: publishing the merged skill copies its sources into the version, and the page lists two public makers and "1 private skill"', async () => {
    const owner = await signedIn('publish-owner', 127)
    const device = await pairDevice(owner, 'test-machine-publish')
    const [a, b, c] = [K(51), K(52), K(53)]
    await addSkillVersionPrisma(prisma, 'every', 'house-style', a, 1_700_000_000)
    await addSkillVersionPrisma(prisma, 'maker-one', 'tidy-notes', b, 1_700_000_100)
    const sources = [
      { key: a, ref: '@every/house-style', name: 'House Style' },
      { key: b, ref: '@maker-one/tidy-notes', name: 'tidy-notes' },
      { key: c, private: true },
    ]
    const id = await readyMerge(device.device_token, [a, b, c], sources)
    assert.equal((await pick(authOf(owner), id, { use: 'merged', won: [a, b] })).statusCode, 200)

    // One tap: no license field, no form, and no say over the sources it credits.
    const res = await publish(owner, 'publish-owner', 'editing', MERGED.files, {
      merged_from: { sources: [{ ref: '@someone/famous', name: 'Famous' }], private: 0 },
    })
    assert.equal(res.statusCode, 201, res.body)
    const version = await prisma.skill_versions.findFirst({
      where: { skill_id: 'publish-owner:editing', hash: MERGED.hash },
      select: { metadata_json: true },
    })
    const meta = JSON.parse(version!.metadata_json) as { merged_from?: unknown }
    assert.deepEqual(meta.merged_from, {
      sources: [
        { ref: '@every/house-style', name: 'House Style' },
        { ref: '@maker-one/tidy-notes', name: 'tidy-notes' },
      ],
      private: 1,
    })
    assert.ok(!JSON.stringify(meta).includes(c), 'a private source leaves no trace, not even its hash')

    const detail = await h.app.inject({ method: 'GET', url: '/api/v1/skills/publish-owner/editing' })
    assert.equal(detail.statusCode, 200, detail.body)
    assert.deepEqual((detail.json() as { merged_from?: unknown }).merged_from, meta.merged_from)

    assert.equal((await one(authOf(owner), id)).published, '@publish-owner/editing', 'the map knows it is published')
    assert.equal((await one(bearer(device.device_token), id)).published, undefined, 'a computer is never told')

    // A source made private since is only counted.
    await prisma.skills.update({ where: { id: 'maker-one:tidy-notes' }, data: { visibility: 'private' } })
    const later = await h.app.inject({ method: 'GET', url: '/api/v1/skills/publish-owner/editing' })
    assert.deepEqual((later.json() as { merged_from?: unknown }).merged_from, {
      sources: [{ ref: '@every/house-style', name: 'House Style' }],
      private: 2,
    })
  })

  it('a publish that is not a merge carries no sources, whatever its metadata claims', async () => {
    const owner = await signedIn('plain-owner', 128)
    const plain = bundleOf({ 'SKILL.md': '---\nname: Plain\ndescription: A plain skill.\n---\n\nDo the thing.\n' })
    const res = await publish(owner, 'plain-owner', 'plain', plain.files, {
      merged_from: { sources: [{ ref: '@someone/famous', name: 'Famous' }], private: 0 },
    })
    assert.equal(res.statusCode, 201, res.body)
    const version = await prisma.skill_versions.findFirst({ where: { skill_id: 'plain-owner:plain' }, select: { metadata_json: true } })
    assert.equal((JSON.parse(version!.metadata_json) as { merged_from?: unknown }).merged_from, undefined)
    const detail = await h.app.inject({ method: 'GET', url: '/api/v1/skills/plain-owner/plain' })
    assert.equal((detail.json() as { merged_from?: unknown }).merged_from, undefined)
  })

  it('publishing onto a slug the person already uses never touches that skill', async () => {
    const owner = await signedIn('slug-owner', 129)
    const theirs = bundleOf({ 'SKILL.md': '---\nname: Editing\ndescription: Their own editing skill.\n---\n\nOld.\n' })
    assert.equal((await publish(owner, 'slug-owner', 'editing', theirs.files)).statusCode, 201)
    const clash = await publish(owner, 'slug-owner', 'editing', MERGED.files)
    assert.equal(clash.statusCode, 409, clash.body)
    const skill = await prisma.skills.findUnique({ where: { id: 'slug-owner:editing' }, select: { latest_hash: true } })
    assert.equal(skill?.latest_hash, theirs.hash, 'the old skill is left alone')
    assert.equal((await publish(owner, 'slug-owner', 'editing-2', MERGED.files)).statusCode, 201, 'the next number is free')
  })
})
