// Private backups by content hash (kit map plan U9, KTD7): never a `skills`
// row, never in the sync manifest, every read and delete scoped to the owner,
// and nothing stored when the bundle carries a secret.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { after, afterEach, before, beforeEach, describe, it } from 'node:test'
import type { PrismaClient } from '@prisma/client'
import { canonicalContentHash, decodeBundle, type BundleFiles } from '@skillet/protocol'
import { addSkillVersionPrisma, authOf, claim, freshMysqlServer, mint, type DevSession, type Handle } from './helpers.js'
import { createTestPrismaClient, mysqlTestsEnabled, resetMysqlRegistry } from './mysql-test-env.js'
import { blobHash } from '../src/db/index.js'

const hasDatabaseUrl = mysqlTestsEnabled()

const QUOTA_ENV = ['SKILLET_BACKUP_MAX_COUNT', 'SKILLET_BACKUP_MAX_BYTES', 'SKILLET_BACKUP_MAX_BUNDLE_BYTES'] as const

function bundleOf(files: Record<string, string>): { files: BundleFiles; hash: string } {
  const wire: BundleFiles = {}
  for (const [path, data] of Object.entries(files)) wire[path] = { enc: 'utf8', data }
  return { files: wire, hash: canonicalContentHash(decodeBundle(wire)) }
}

const skillMd = (name: string, body = 'Do the thing.') =>
  `---\nname: ${name}\ndescription: ${name} for tests\n---\n\n${body}\n`

const hashOf = (seed: string) => `sha256:${createHash('sha256').update(seed).digest('hex')}`

describe('backups (U9)', { skip: !hasDatabaseUrl }, () => {
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

  afterEach(() => {
    for (const key of QUOTA_ENV) delete process.env[key]
  })

  async function signedIn(handle: string, seed: number): Promise<DevSession> {
    const session = await mint(h)
    await claim(h, session, handle, seed)
    return session
  }

  const put = (auth: Record<string, string>, hash: string, body: Record<string, unknown>) =>
    h.app.inject({ method: 'PUT', url: `/api/v1/backups/${hash}`, headers: auth, payload: body })

  const backupBody = (files: BundleFiles, name = 'alpha') => ({
    files,
    name,
    description: `${name} for tests`,
    tools: ['claude-code'],
    origin: 'scan',
  })

  it('stores one private backup per hash, idempotently, and refuses bytes that do not match', async () => {
    const owner = await signedIn('backup-owner', 91)
    const alpha = bundleOf({ 'SKILL.md': skillMd('alpha'), 'notes.md': 'extra\n' })

    const first = await put(authOf(owner), alpha.hash, backupBody(alpha.files))
    assert.equal(first.statusCode, 201, first.body)
    assert.deepEqual(first.json(), { hash: alpha.hash, size: Buffer.byteLength(skillMd('alpha')) + 6, created: true })

    const again = await put(authOf(owner), alpha.hash, backupBody(alpha.files))
    assert.equal(again.statusCode, 200, again.body)
    assert.equal((again.json() as { created: boolean }).created, false)
    assert.equal(await prisma.skill_backups.count(), 1, 'the same backup twice stores one')

    const other = bundleOf({ 'SKILL.md': skillMd('beta') })
    const mismatch = await put(authOf(owner), alpha.hash, backupBody(other.files, 'beta'))
    assert.equal(mismatch.statusCode, 422, mismatch.body)
    assert.equal((mismatch.json() as { error: string }).error, 'hash_mismatch')
    assert.equal(await prisma.skill_backups.count(), 1)

    const listed = await h.app.inject({ method: 'GET', url: '/api/v1/backups', headers: authOf(owner) })
    assert.equal(listed.statusCode, 200, listed.body)
    const list = listed.json() as {
      backups: Array<{ hash: string; name: string; tools: string[]; origin: string }>
      usage: { count: number; bytes: number }
    }
    assert.deepEqual(
      list.backups.map((b) => [b.hash, b.name, b.tools, b.origin]),
      [[alpha.hash, 'alpha', ['claude-code'], 'scan']],
    )
    assert.equal(list.usage.count, 1)

    const got = await h.app.inject({ method: 'GET', url: `/api/v1/backups/${alpha.hash}`, headers: authOf(owner) })
    assert.equal(got.statusCode, 200, got.body)
    const files = (got.json() as { files: BundleFiles }).files
    assert.equal(canonicalContentHash(decodeBundle(files)), alpha.hash, 'the stored bundle round-trips to its hash')

    const malformed = await put(authOf(owner), 'sha256:nothex', backupBody(alpha.files))
    assert.equal(malformed.statusCode, 400, malformed.body)
    const noOrigin = await put(authOf(owner), alpha.hash, { files: alpha.files, name: 'alpha' })
    assert.equal(noOrigin.statusCode, 422, noOrigin.body)
    const anonymous = await h.app.inject({ method: 'PUT', url: `/api/v1/backups/${alpha.hash}`, payload: backupBody(alpha.files) })
    assert.equal(anonymous.statusCode, 401, anonymous.body)
  })

  it('scopes every read and delete to the owner', async () => {
    const owner = await signedIn('first-owner', 92)
    const stranger = await signedIn('second-owner', 93)
    const alpha = bundleOf({ 'SKILL.md': skillMd('alpha') })
    assert.equal((await put(authOf(owner), alpha.hash, backupBody(alpha.files))).statusCode, 201)

    const peek = await h.app.inject({ method: 'GET', url: `/api/v1/backups/${alpha.hash}`, headers: authOf(stranger) })
    assert.equal(peek.statusCode, 404, peek.body)
    const wipe = await h.app.inject({ method: 'DELETE', url: `/api/v1/backups/${alpha.hash}`, headers: authOf(stranger) })
    assert.equal(wipe.statusCode, 404, wipe.body)
    const theirs = await h.app.inject({ method: 'GET', url: '/api/v1/backups', headers: authOf(stranger) })
    assert.deepEqual((theirs.json() as { backups: unknown[] }).backups, [])

    // The owner's copy survived the stranger's delete.
    const mine = await h.app.inject({ method: 'GET', url: `/api/v1/backups/${alpha.hash}`, headers: authOf(owner) })
    assert.equal(mine.statusCode, 200, mine.body)

    // The same skill backs up separately under the second account.
    assert.equal((await put(authOf(stranger), alpha.hash, backupBody(alpha.files))).statusCode, 201)
    const removed = await h.app.inject({ method: 'DELETE', url: `/api/v1/backups/${alpha.hash}`, headers: authOf(owner) })
    assert.equal(removed.statusCode, 204, removed.body)
    const gone = await h.app.inject({ method: 'GET', url: `/api/v1/backups/${alpha.hash}`, headers: authOf(owner) })
    assert.equal(gone.statusCode, 404, gone.body)
    const stillTheirs = await h.app.inject({ method: 'GET', url: `/api/v1/backups/${alpha.hash}`, headers: authOf(stranger) })
    assert.equal(stillTheirs.statusCode, 200, stillTheirs.body)
  })

  it('refuses an upload past the owner quota or the bundle size cap', async () => {
    const owner = await signedIn('quota-owner', 94)
    const big = bundleOf({ 'SKILL.md': skillMd('big', 'x'.repeat(400)) })
    process.env.SKILLET_BACKUP_MAX_BUNDLE_BYTES = '256'
    const tooBig = await put(authOf(owner), big.hash, backupBody(big.files, 'big'))
    assert.equal(tooBig.statusCode, 413, tooBig.body)
    assert.equal((tooBig.json() as { error: string }).error, 'backup_too_large')
    delete process.env.SKILLET_BACKUP_MAX_BUNDLE_BYTES

    process.env.SKILLET_BACKUP_MAX_COUNT = '1'
    const one = bundleOf({ 'SKILL.md': skillMd('one') })
    const two = bundleOf({ 'SKILL.md': skillMd('two') })
    assert.equal((await put(authOf(owner), one.hash, backupBody(one.files, 'one'))).statusCode, 201)
    const overCount = await put(authOf(owner), two.hash, backupBody(two.files, 'two'))
    assert.equal(overCount.statusCode, 413, overCount.body)
    assert.equal((overCount.json() as { error: string }).error, 'backup_quota_exceeded')
    // Re-sending one already stored is not a new backup, so the quota lets it through.
    assert.equal((await put(authOf(owner), one.hash, backupBody(one.files, 'one'))).statusCode, 200)
    delete process.env.SKILLET_BACKUP_MAX_COUNT

    process.env.SKILLET_BACKUP_MAX_BYTES = String(Buffer.byteLength(skillMd('one')) + 10)
    const overBytes = await put(authOf(owner), two.hash, backupBody(two.files, 'two'))
    assert.equal(overBytes.statusCode, 413, overBytes.body)
    assert.equal((overBytes.json() as { error: string }).error, 'backup_quota_exceeded')
    assert.equal(await prisma.skill_backups.count(), 1)
  })

  it('refuses a backup holding a high-confidence key with scan_blocked, and stores no row or blob', async () => {
    const owner = await signedIn('secret-owner', 95)
    // Built at runtime so the fixture is never a key-shaped literal in source.
    const key = 'AKIA' + '2E0A8F3B244C9986'
    const skill = skillMd('leaky', 'Run setup.sh first.')
    const setup = `#!/bin/sh\nAWS_ACCESS_KEY_ID=${key}\n`
    const leaky = bundleOf({ 'SKILL.md': skill, 'setup.sh': setup })

    const res = await put(authOf(owner), leaky.hash, backupBody(leaky.files, 'leaky'))
    assert.equal(res.statusCode, 422, res.body)
    const body = res.json() as {
      error: string
      reason: string
      findings: Array<{ file: string; lineStart: number }>
    }
    assert.equal(body.error, 'scan_blocked')
    assert.equal(body.reason, 'secret')
    assert.equal(body.findings[0]?.file, 'setup.sh')
    assert.equal(body.findings[0]?.lineStart, 2)
    assert.ok(!res.body.includes(key), 'the refusal never echoes the secret')

    assert.equal(await prisma.skill_backups.count(), 0)
    assert.equal(await prisma.skill_backup_files.count(), 0)
    for (const bytes of [skill, setup]) {
      const row = await prisma.blobs.findUnique({ where: { hash: blobHash(bytes) } })
      assert.equal(row, null, 'no blob lands for a refused backup')
    }
  })

  it('never appears in the owner sync manifest or on their profile', async () => {
    const owner = await signedIn('quiet-owner', 96)
    const codes = await h.app.inject({ method: 'POST', url: '/api/v1/connect/codes', headers: authOf(owner) })
    const claimed = await h.app.inject({
      method: 'POST',
      url: '/api/v1/connect/claim',
      payload: { code: (codes.json() as { code: string }).code, label: 'test-machine', client_kind: 'cli' },
    })
    assert.equal(claimed.statusCode, 201, claimed.body)
    const device = { authorization: `Bearer ${(claimed.json() as { device_token: string }).device_token}` }

    const hidden = bundleOf({ 'SKILL.md': skillMd('hidden-notes') })
    // Device auth works as well as a session.
    const res = await put(device, hidden.hash, backupBody(hidden.files, 'hidden-notes'))
    assert.equal(res.statusCode, 201, res.body)

    const manifest = await h.app.inject({ method: 'GET', url: '/api/v1/sync/manifest', headers: device })
    assert.equal(manifest.statusCode, 200, manifest.body)
    assert.deepEqual((manifest.json() as { items: unknown[] }).items, [])
    assert.ok(!manifest.body.includes(hidden.hash))

    for (const url of ['/api/v1/authors/quiet-owner', '/api/v1/profiles/quiet-owner']) {
      const page = await h.app.inject({ method: 'GET', url, headers: authOf(owner) })
      assert.equal(page.statusCode, 200, `${url}: ${page.body}`)
      assert.ok(!page.body.includes(hidden.hash), `${url} carries no backup`)
      assert.ok(!page.body.includes('hidden-notes'), `${url} names no backup`)
    }
    assert.equal(await prisma.skills.count(), 0, 'a backup is never a skills row')
    assert.equal(await prisma.skill_versions.count(), 0)
  })

  it('keeps sources only on a merge', async () => {
    const owner = await signedIn('merge-owner', 97)
    const merged = bundleOf({ 'SKILL.md': skillMd('merged-notes') })
    const sources = [
      { key: hashOf('public-source'), ref: '@maker-one/tidy-notes', name: 'tidy-notes' },
      { key: hashOf('private-source'), private: true },
    ]
    const notMerge = await put(authOf(owner), merged.hash, { ...backupBody(merged.files, 'merged-notes'), sources })
    assert.equal(notMerge.statusCode, 422, notMerge.body)

    const res = await put(authOf(owner), merged.hash, {
      ...backupBody(merged.files, 'merged-notes'),
      origin: 'merge',
      sources,
    })
    assert.equal(res.statusCode, 201, res.body)
    const got = await h.app.inject({ method: 'GET', url: `/api/v1/backups/${merged.hash}`, headers: authOf(owner) })
    const body = got.json() as { origin: string; sources: unknown }
    assert.equal(body.origin, 'merge')
    assert.deepEqual(body.sources, sources)
  })

  it('looks up source makers by hash: public versions name their maker, the rest come back private', async () => {
    const owner = await signedIn('lookup-owner', 98)
    const t0 = 1_700_000_000
    const publicHash = hashOf('public-version')
    const privateHash = hashOf('private-version')
    const unknownHash = hashOf('never-published')
    await addSkillVersionPrisma(prisma, 'maker-one', 'tidy-notes', publicHash, t0)
    await addSkillVersionPrisma(prisma, 'maker-two', 'own-notes', privateHash, t0)
    await prisma.skills.update({ where: { id: 'maker-two:own-notes' }, data: { visibility: 'private' } })

    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/backups/sources',
      headers: authOf(owner),
      payload: { keys: [publicHash, privateHash, unknownHash] },
    })
    assert.equal(res.statusCode, 200, res.body)
    assert.deepEqual((res.json() as { sources: unknown[] }).sources, [
      {
        key: publicHash,
        ref: '@maker-one/tidy-notes',
        maker: 'maker-one',
        name: 'tidy-notes',
        page: 'https://skillet.md/maker-one/tidy-notes',
      },
      { key: privateHash, private: true },
      { key: unknownHash, private: true },
    ])

    const anonymous = await h.app.inject({
      method: 'POST',
      url: '/api/v1/backups/sources',
      payload: { keys: [publicHash] },
    })
    assert.equal(anonymous.statusCode, 401, anonymous.body)
    const bad = await h.app.inject({
      method: 'POST',
      url: '/api/v1/backups/sources',
      headers: authOf(owner),
      payload: { keys: ['not-a-hash'] },
    })
    assert.equal(bad.statusCode, 422, bad.body)
  })
})
