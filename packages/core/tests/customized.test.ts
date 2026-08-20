/**
 * Customized skills — editing a synced skill keeps the edit LIVE in place
 * forever (never reverted), marks the skill `customized`, HOLDS author updates,
 * and reconciles on demand:
 *
 *   - U1/AE1/AE6/AE7: an edit + sync → the edited bytes stay on disk, the skill
 *     is marked customized, a backup exists, and the canonical bundle never
 *     overwrites the edit (dotfiles are not a detection kill-switch).
 *   - U2/AE2: an upstream update to a customized skill is HELD (recorded, not
 *     materialized) and flagged on SyncResult.customized.
 *   - U3/AE3/AE4: takeUpstream / restoreOriginal back up the user's version and
 *     materialize the (signature-verified) author bytes; keepMine acks a held
 *     update until a newer one arrives.
 *   - U4/AE5: customizing one kit skill leaves the kit's other skills updating.
 *   - EDIT-PRESERVATION PROPERTY: for every sync mode, an edited materialized
 *     skill's on-disk bytes equal the user's edit afterward (never reverted).
 *
 * Isolation mirrors sync.test.ts: HOME + SKILLET_DIR redirected via vi.hoisted
 * before @skillet/core loads. No security checks are mocked.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { installOfflineRegistry } from './helpers/offline-registry.js'
import { chmod, mkdir, readdir, readFile, rm, writeFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'

const TEST_ROOT = vi.hoisted(() => {
  const { redirectHome } = require('./helpers/redirect-home.cjs')
  return redirectHome('skillet-customized')
})

import { sync } from '../src/commands/sync.js'
import {
  editsRoot,
  listBackups,
  listCustomized,
  listLiveEdits,
  takeUpstream,
  restoreOriginal,
  keepMine,
  ReconcileError,
} from '../src/commands/edits.js'
import {
  stashBaselineVersion,
  readBaselineStash,
} from '../src/commands/edits-store.js'
import type { Adapter } from '../src/adapter.js'
import type { KitState, SkillEntry } from '../src/kit/types.js'
import { atomicWrite } from '../src/util/atomic.js'
import { canonicalContentHash } from '@skillet/protocol'
import { generateAuthorKey } from '../src/signing/index.js'
import { signEnvelope } from '../src/signing/envelope.js'
import { pinAuthorKey } from '../src/signing/pin.js'

const SKILLET = join(TEST_ROOT, '.skillet')
const CLAUDE_DIR = join(TEST_ROOT, '.claude', 'skills')
// A second GLOBAL runtime root. Must be in pathsafe's materialization allowlist
// (HOME-relative) since these adapters go through `sync`, which enforces it.
const CODEX_DIR = join(TEST_ROOT, '.openclaw', 'skills')

const CONTENT = '---\nname: foo\ndescription: canonical\n---\n\n# foo\n'
const EDITED = '---\nname: foo\ndescription: edited\n---\n\n# foo EDITED\n'
const UPDATED = '---\nname: foo\ndescription: author update\n---\n\n# foo v2\n'
const UPDATED_2 = '---\nname: foo\ndescription: author update 2\n---\n\n# foo v3\n'

function makeStubAdapter(name: string, targetDir: string): Adapter {
  return {
    name,
    targetDir,
    async detect() {
      return true
    },
    targetPath(slug: string) {
      return join(targetDir, slug, 'SKILL.md')
    },
    targetSkillDir(slug: string) {
      return join(targetDir, slug)
    },
    async materialize(slug, bundle) {
      const written: string[] = []
      for (const [path, bytes] of bundle.entries()) {
        await mkdir(join(targetDir, slug, ...path.split('/').slice(0, -1)), { recursive: true })
        const dest = join(targetDir, slug, path)
        await writeFile(dest, Buffer.from(bytes))
        written.push(dest)
      }
      return written
    },
  } as unknown as Adapter
}

/** A stub adapter whose materialize always throws (simulates disk-full/EACCES). */
function makeFailingAdapter(name: string, targetDir: string): Adapter {
  const base = makeStubAdapter(name, targetDir)
  return {
    ...base,
    async materialize() {
      throw new Error('materialize failed (disk full)')
    },
  } as unknown as Adapter
}

class CaptureWritable extends Writable {
  data = ''
  isTTY = false
  override _write(chunk: Buffer, _enc: string, cb: () => void) {
    this.data += chunk.toString('utf8')
    cb()
  }
}

let cwd: string
let pinDir: string

function syncOpts(out: Writable = new CaptureWritable(), extra: Record<string, unknown> = {}) {
  return {
    output: out,
    input: Readable.from([]),
    approvalLockPath: join(TEST_ROOT, 'approval.lock'),
    configDir: join(TEST_ROOT, '.config'),
    pinDir,
    ...extra,
  }
}

function bundleHash(content: string): string {
  return canonicalContentHash(new Map([['SKILL.md', Buffer.from(content, 'utf8')]]))
}

async function seedLocalKit(
  slug: string,
  content: string,
  over: Partial<SkillEntry> = {},
): Promise<string> {
  const store = join(SKILLET, 'skills', slug)
  await mkdir(store, { recursive: true })
  await writeFile(join(store, 'SKILL.md'), content, 'utf8')
  const hash = bundleHash(content)
  const now = new Date().toISOString()
  const state = await readStateOrEmpty()
  state.skills[slug] = {
    slug,
    name: slug,
    description: '',
    version: 1,
    hash,
    source: 'local',
    sourceKit: '@test/kit',
    importedAt: now,
    updatedAt: now,
    ...over,
  }
  await atomicWrite(join(SKILLET, 'state.json'), JSON.stringify(state), { backup: false })
  return hash
}

function pubFromKey(k: ReturnType<typeof generateAuthorKey>): string {
  const jwk = k.publicKey.export({ format: 'jwk' }) as { x: string }
  return Buffer.from(jwk.x, 'base64url').toString('base64')
}

async function seedSignedRegistry(opts: { subscriberTrust?: 'auto' } = {}): Promise<string> {
  const authorKey = generateAuthorKey()
  const pub = pubFromKey(authorKey)
  const store = join(SKILLET, 'skills', '@alice', 'foo')
  await mkdir(store, { recursive: true })
  await writeFile(join(store, 'SKILL.md'), CONTENT, 'utf8')
  const hash = bundleHash(CONTENT)
  const sig = signEnvelope(hash, authorKey)
  const now = new Date().toISOString()
  const state = await readStateOrEmpty()
  state.skills['@alice/foo'] = {
    slug: '@alice/foo',
    name: 'foo',
    description: '',
    version: 3,
    hash,
    source: 'registry',
    sourceKit: '@alice/kit',
    owner: 'alice',
    authorKeyId: authorKey.keyId,
    authorPubBase64: pub,
    signature: sig,
    ...(opts.subscriberTrust ? { subscriberTrust: opts.subscriberTrust } : {}),
    importedAt: now,
    updatedAt: now,
  } as SkillEntry
  await atomicWrite(join(SKILLET, 'state.json'), JSON.stringify(state), { backup: false })
  await pinAuthorKey('alice', { key_id: authorKey.keyId, pub, first_seen_version: 1 }, pinDir)
  return hash
}

async function readStateOrEmpty(): Promise<KitState> {
  try {
    return JSON.parse(await readFile(join(SKILLET, 'state.json'), 'utf8')) as KitState
  } catch {
    return { version: 1, skills: {} }
  }
}

async function readStateFile(): Promise<KitState> {
  return JSON.parse(await readFile(join(SKILLET, 'state.json'), 'utf8')) as KitState
}

async function writeStore(slug: string, content: string): Promise<void> {
  const parts = slug.startsWith('@') ? slug.slice(1).split('/') : [slug]
  const store = join(SKILLET, 'skills', ...parts)
  await mkdir(store, { recursive: true })
  await writeFile(join(store, 'SKILL.md'), content, 'utf8')
}

/**
 * Simulate a completed upstream pull for a CUSTOMIZED skill: the store holds the
 * new author bytes and `entry.hash` is bumped to them (exactly what sync's pull
 * phase leaves behind). The customized branch then holds the update.
 */
async function publishHeldUpdate(slug: string, content: string): Promise<string> {
  await writeStore(slug, content)
  const hash = bundleHash(content)
  const state = await readStateFile()
  state.skills[slug]!.hash = hash
  await atomicWrite(join(SKILLET, 'state.json'), JSON.stringify(state), { backup: false })
  return hash
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

async function walkFiles(dir: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out: string[] = []
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...(await walkFiles(p)))
    else out.push(p)
  }
  return out
}

/** True when some backup file (non-manifest) holds `content`. */
async function backupContains(content: string): Promise<boolean> {
  for (const file of await walkFiles(editsRoot())) {
    if (file.endsWith('manifest.json')) continue
    if ((await readFile(file, 'utf8').catch(() => '')) === content) return true
  }
  return false
}

installOfflineRegistry()

beforeEach(async () => {
  delete process.env['SKILLET_TOKEN']
  await rm(TEST_ROOT, { recursive: true, force: true })
  cwd = join(TEST_ROOT, 'project')
  pinDir = join(TEST_ROOT, '.config', 'skillet', 'pinned')
  await mkdir(cwd, { recursive: true })
  await mkdir(pinDir, { recursive: true })
})

afterEach(async () => {
  await rm(TEST_ROOT, { recursive: true, force: true })
})

describe('U1 — customize-in-place, delete the heal', () => {
  it('AE1: edit + headless sync → edited bytes stay live, customized_from set, backup exists, canonical never overwrote', async () => {
    const hash = await seedSignedRegistry({ subscriberTrust: 'auto' })
    const adapters = [makeStubAdapter('claude-code', CLAUDE_DIR)]
    await sync(cwd, adapters, syncOpts())
    expect(await readFile(join(CLAUDE_DIR, 'foo', 'SKILL.md'), 'utf8')).toBe(CONTENT)

    await writeFile(join(CLAUDE_DIR, 'foo', 'SKILL.md'), EDITED, 'utf8')
    const result = await sync(cwd, adapters, syncOpts())

    // The edit is LIVE — the canonical bundle did NOT overwrite it.
    expect(await readFile(join(CLAUDE_DIR, 'foo', 'SKILL.md'), 'utf8')).toBe(EDITED)
    // Marked customized, no held update.
    expect(result.customized).toEqual([{ slug: '@alice/foo', hasUpdate: false }])
    expect(result.materialized).toHaveLength(0)
    const entry = (await readStateFile()).skills['@alice/foo']!
    expect(entry.customized_from).toEqual({ author: 'alice', slug: '@alice/foo', version: 3, hash })
    expect(entry.held_update).toBeUndefined()
    // Backup holds the edited bytes.
    expect(await backupContains(EDITED)).toBe(true)
    const backups = await listBackups()
    expect(backups).toHaveLength(1)
    expect(backups[0]!.manifest!.reason).toBe('customize')
  })

  it('AE6: an agent (programmatic) edit is treated identically — customized, live, backed up', async () => {
    await seedLocalKit('demo', CONTENT)
    const adapters = [makeStubAdapter('claude-code', CLAUDE_DIR)]
    await sync(cwd, adapters, syncOpts())

    // Simulate an agent rewriting the file mid-task.
    await writeFile(join(CLAUDE_DIR, 'demo', 'SKILL.md'), EDITED, 'utf8')
    const result = await sync(cwd, adapters, syncOpts())

    expect(result.customized).toEqual([{ slug: 'demo', hasUpdate: false }])
    expect(await readFile(join(CLAUDE_DIR, 'demo', 'SKILL.md'), 'utf8')).toBe(EDITED)
    expect((await readStateFile()).skills['demo']!.customized_from).toBeTruthy()
    expect(await backupContains(EDITED)).toBe(true)
  })

  it('AE7: a .DS_Store still customizes; the dotfile is not in the backup', async () => {
    await seedLocalKit('demo', CONTENT)
    const adapters = [makeStubAdapter('claude-code', CLAUDE_DIR)]
    await sync(cwd, adapters, syncOpts())

    await writeFile(join(CLAUDE_DIR, 'demo', 'SKILL.md'), EDITED, 'utf8')
    await writeFile(join(CLAUDE_DIR, 'demo', '.DS_Store'), 'finder junk', 'utf8')
    const result = await sync(cwd, adapters, syncOpts())

    expect(result.customized).toEqual([{ slug: 'demo', hasUpdate: false }])
    expect(await readFile(join(CLAUDE_DIR, 'demo', 'SKILL.md'), 'utf8')).toBe(EDITED)
    expect(await backupContains(EDITED)).toBe(true)
    const dotfiles = (await walkFiles(editsRoot())).filter((f) => f.endsWith('.DS_Store'))
    expect(dotfiles).toEqual([])
  })

  it('a second sync after customization leaves the edit live with no re-backup churn', async () => {
    await seedLocalKit('demo', CONTENT)
    const adapters = [makeStubAdapter('claude-code', CLAUDE_DIR)]
    await sync(cwd, adapters, syncOpts())
    await writeFile(join(CLAUDE_DIR, 'demo', 'SKILL.md'), EDITED, 'utf8')
    await sync(cwd, adapters, syncOpts())
    expect(await listBackups()).toHaveLength(1)

    const again = await sync(cwd, adapters, syncOpts())
    expect(again.customized).toEqual([{ slug: 'demo', hasUpdate: false }])
    expect(await readFile(join(CLAUDE_DIR, 'demo', 'SKILL.md'), 'utf8')).toBe(EDITED)
    expect(await listBackups()).toHaveLength(1) // no churn — still one backup
  })

  it('a no-drift skill materializes normally and is never marked customized', async () => {
    await seedLocalKit('demo', CONTENT)
    const adapters = [makeStubAdapter('claude-code', CLAUDE_DIR)]
    const result = await sync(cwd, adapters, syncOpts())
    expect(result.customized).toEqual([])
    expect(result.materialized).toHaveLength(1)
    expect((await readStateFile()).skills['demo']!.customized_from).toBeUndefined()
  })
})

describe('U2 — held updates', () => {
  it('AE2: an upstream update to a customized skill is HELD, not materialized; SyncResult flags hasUpdate', async () => {
    await seedLocalKit('demo', CONTENT)
    const adapters = [makeStubAdapter('claude-code', CLAUDE_DIR)]
    await sync(cwd, adapters, syncOpts())
    await writeFile(join(CLAUDE_DIR, 'demo', 'SKILL.md'), EDITED, 'utf8')
    await sync(cwd, adapters, syncOpts()) // customized

    const upHash = await publishHeldUpdate('demo', UPDATED)
    const result = await sync(cwd, adapters, syncOpts())

    expect(result.customized).toEqual([{ slug: 'demo', hasUpdate: true }])
    // Held, not applied: the edit is still live.
    expect(await readFile(join(CLAUDE_DIR, 'demo', 'SKILL.md'), 'utf8')).toBe(EDITED)
    const entry = (await readStateFile()).skills['demo']!
    expect(entry.held_update).toEqual({ version: 1, hash: upHash })

    const customized = await listCustomized()
    expect(customized).toHaveLength(1)
    expect(customized[0]!.hasUpdate).toBe(true)
  })

  it('a customized skill with no upstream change records no held update', async () => {
    await seedLocalKit('demo', CONTENT)
    const adapters = [makeStubAdapter('claude-code', CLAUDE_DIR)]
    await sync(cwd, adapters, syncOpts())
    await writeFile(join(CLAUDE_DIR, 'demo', 'SKILL.md'), EDITED, 'utf8')
    const result = await sync(cwd, adapters, syncOpts())
    expect(result.customized).toEqual([{ slug: 'demo', hasUpdate: false }])
    expect((await readStateFile()).skills['demo']!.held_update).toBeUndefined()
  })

  it('upstream reverting to the customized baseline clears the held update', async () => {
    const base = await seedLocalKit('demo', CONTENT)
    const adapters = [makeStubAdapter('claude-code', CLAUDE_DIR)]
    await sync(cwd, adapters, syncOpts())
    await writeFile(join(CLAUDE_DIR, 'demo', 'SKILL.md'), EDITED, 'utf8')
    await sync(cwd, adapters, syncOpts())

    await publishHeldUpdate('demo', UPDATED)
    await sync(cwd, adapters, syncOpts())
    expect((await readStateFile()).skills['demo']!.held_update).toBeTruthy()

    // Author reverts to the baseline the edit was made against.
    await publishHeldUpdate('demo', CONTENT)
    expect(bundleHash(CONTENT)).toBe(base)
    const result = await sync(cwd, adapters, syncOpts())
    expect(result.customized).toEqual([{ slug: 'demo', hasUpdate: false }])
    expect((await readStateFile()).skills['demo']!.held_update).toBeUndefined()
  })
})

describe('U3 — reconcile actions (take / restore / keep)', () => {
  it('AE3: takeUpstream backs up the user version and materializes the (verified) upstream; no longer customized', async () => {
    await seedLocalKit('demo', CONTENT)
    const adapters = [makeStubAdapter('claude-code', CLAUDE_DIR)]
    await sync(cwd, adapters, syncOpts())
    await writeFile(join(CLAUDE_DIR, 'demo', 'SKILL.md'), EDITED, 'utf8')
    await sync(cwd, adapters, syncOpts())
    await publishHeldUpdate('demo', UPDATED)
    await sync(cwd, adapters, syncOpts()) // held update recorded

    const res = await takeUpstream('demo', adapters, { pinDir })

    // Upstream bytes are now on disk; the user's edit is in a backup.
    expect(res.materialized.length).toBeGreaterThan(0)
    expect(res.backupId).toBeTruthy()
    expect(await readFile(join(CLAUDE_DIR, 'demo', 'SKILL.md'), 'utf8')).toBe(UPDATED)
    expect(await backupContains(EDITED)).toBe(true)
    const entry = (await readStateFile()).skills['demo']!
    expect(entry.customized_from).toBeUndefined()
    expect(entry.held_update).toBeUndefined()
    expect(await listCustomized()).toEqual([])
  })

  it('AE4: restoreOriginal with no held update materializes the current signed version, backing up the edit', async () => {
    await seedSignedRegistry({ subscriberTrust: 'auto' })
    const adapters = [makeStubAdapter('claude-code', CLAUDE_DIR)]
    await sync(cwd, adapters, syncOpts())
    await writeFile(join(CLAUDE_DIR, 'foo', 'SKILL.md'), EDITED, 'utf8')
    await sync(cwd, adapters, syncOpts()) // customized, no held update

    const res = await restoreOriginal('@alice/foo', adapters, { pinDir })

    expect(res.backupId).toBeTruthy()
    expect(await readFile(join(CLAUDE_DIR, 'foo', 'SKILL.md'), 'utf8')).toBe(CONTENT)
    expect(await backupContains(EDITED)).toBe(true)
    expect((await readStateFile()).skills['@alice/foo']!.customized_from).toBeUndefined()
  })

  it('takeUpstream aborts when the upstream signature fails to verify — the edit is left live', async () => {
    await seedSignedRegistry({ subscriberTrust: 'auto' })
    const adapters = [makeStubAdapter('claude-code', CLAUDE_DIR)]
    await sync(cwd, adapters, syncOpts())
    await writeFile(join(CLAUDE_DIR, 'foo', 'SKILL.md'), EDITED, 'utf8')
    await sync(cwd, adapters, syncOpts()) // customized

    // Tamper the store: the bytes no longer match the signed hash.
    await writeFile(
      join(SKILLET, 'skills', '@alice', 'foo', 'SKILL.md'),
      '# tampered upstream\n',
      'utf8',
    )

    await expect(takeUpstream('@alice/foo', adapters, { pinDir })).rejects.toBeInstanceOf(
      ReconcileError,
    )
    // The edit is untouched and still customized.
    expect(await readFile(join(CLAUDE_DIR, 'foo', 'SKILL.md'), 'utf8')).toBe(EDITED)
    expect((await readStateFile()).skills['@alice/foo']!.customized_from).toBeTruthy()
  })

  it('keepMine acks a held update; the same hash does not re-nudge, a newer hash does', async () => {
    await seedLocalKit('demo', CONTENT)
    const adapters = [makeStubAdapter('claude-code', CLAUDE_DIR)]
    await sync(cwd, adapters, syncOpts())
    await writeFile(join(CLAUDE_DIR, 'demo', 'SKILL.md'), EDITED, 'utf8')
    await sync(cwd, adapters, syncOpts())

    await publishHeldUpdate('demo', UPDATED)
    let result = await sync(cwd, adapters, syncOpts())
    expect(result.customized).toEqual([{ slug: 'demo', hasUpdate: true }])

    await keepMine('demo')
    expect((await readStateFile()).skills['demo']!.held_update!.acknowledged).toBe(true)

    // Same upstream hash → no re-nudge.
    result = await sync(cwd, adapters, syncOpts())
    expect(result.customized).toEqual([{ slug: 'demo', hasUpdate: false }])

    // A NEWER upstream hash surfaces again.
    await publishHeldUpdate('demo', UPDATED_2)
    result = await sync(cwd, adapters, syncOpts())
    expect(result.customized).toEqual([{ slug: 'demo', hasUpdate: true }])
  })

  it('takeUpstream on an uncustomized skill throws not_customized', async () => {
    await seedLocalKit('demo', CONTENT)
    const adapters = [makeStubAdapter('claude-code', CLAUDE_DIR)]
    await sync(cwd, adapters, syncOpts())
    await expect(takeUpstream('demo', adapters, { pinDir })).rejects.toMatchObject({
      code: 'not_customized',
    })
  })
})

describe('U4 — kits are undamaged by customization', () => {
  it('AE5: customizing one kit skill leaves the kit materializing its other skills', async () => {
    await seedLocalKit('a', CONTENT, { sourceKit: '@alice/kit' })
    await seedLocalKit('b', CONTENT, { sourceKit: '@alice/kit' })
    const adapters = [makeStubAdapter('claude-code', CLAUDE_DIR)]
    await sync(cwd, adapters, syncOpts())

    // Customize skill "a"; the kit is otherwise untouched.
    await writeFile(join(CLAUDE_DIR, 'a', 'SKILL.md'), EDITED, 'utf8')
    const result = await sync(cwd, adapters, syncOpts())

    // "a" holds its edit and is not materialized over; "b" keeps flowing.
    expect(result.customized).toEqual([{ slug: 'a', hasUpdate: false }])
    expect(await readFile(join(CLAUDE_DIR, 'a', 'SKILL.md'), 'utf8')).toBe(EDITED)
    expect(result.materialized.map((m) => m.slug)).toContain('b')
    expect(await readFile(join(CLAUDE_DIR, 'b', 'SKILL.md'), 'utf8')).toBe(CONTENT)
  })
})

describe('F1 — a persisted-but-unmaterialized pull converges, never customizes', () => {
  it('re-materializes on the next sync instead of marking the skill customized', async () => {
    await seedLocalKit('demo', CONTENT)
    const good = [makeStubAdapter('claude-code', CLAUDE_DIR)]
    await sync(cwd, good, syncOpts()) // materialize CONTENT; materialized_hash = CONTENT
    expect(await readFile(join(CLAUDE_DIR, 'demo', 'SKILL.md'), 'utf8')).toBe(CONTENT)
    expect((await readStateFile()).skills['demo']!.materialized_hash).toBe(bundleHash(CONTENT))

    // A completed pull advances the store + entry.hash to UPDATED, but the
    // materialize that would have written it to disk FAILS (degrade-never-delete).
    const upHash = await publishHeldUpdate('demo', UPDATED)
    const r1 = await sync(cwd, [makeFailingAdapter('claude-code', CLAUDE_DIR)], syncOpts())

    // NOT customized: the baseline is materialized_hash (still CONTENT on disk),
    // not the advanced entry.hash, so the still-current bytes aren't a "drift".
    expect(r1.customized).toEqual([])
    expect(await readFile(join(CLAUDE_DIR, 'demo', 'SKILL.md'), 'utf8')).toBe(CONTENT)
    const mid = (await readStateFile()).skills['demo']!
    expect(mid.customized_from).toBeUndefined()
    expect(mid.materialized_hash).toBe(bundleHash(CONTENT)) // still not landed

    // The next sync with a working adapter CONVERGES to the pulled version.
    const r2 = await sync(cwd, good, syncOpts())
    expect(r2.customized).toEqual([])
    expect(r2.materialized.map((m) => m.slug)).toContain('demo')
    expect(await readFile(join(CLAUDE_DIR, 'demo', 'SKILL.md'), 'utf8')).toBe(UPDATED)
    const done = (await readStateFile()).skills['demo']!
    expect(done.customized_from).toBeUndefined()
    expect(done.hash).toBe(upHash)
    expect(done.materialized_hash).toBe(upHash)
  })
})

describe('F2 — a failed backup aborts take/restore (never destroys the edit)', () => {
  async function blockBackupStore(): Promise<void> {
    // Make the edits/backup store a FILE so any backup write throws (mkdir under
    // a non-dir → ENOTDIR), simulating disk-full/EACCES on the backup location.
    await rm(editsRoot(), { recursive: true, force: true })
    await writeFile(editsRoot(), 'blocker', 'utf8')
  }

  it('takeUpstream throws and leaves the edit live when the backup cannot be written', async () => {
    await seedLocalKit('demo', CONTENT)
    const adapters = [makeStubAdapter('claude-code', CLAUDE_DIR)]
    await sync(cwd, adapters, syncOpts())
    await writeFile(join(CLAUDE_DIR, 'demo', 'SKILL.md'), EDITED, 'utf8')
    await sync(cwd, adapters, syncOpts()) // customize
    await publishHeldUpdate('demo', UPDATED)
    await sync(cwd, adapters, syncOpts()) // held update recorded

    await blockBackupStore()
    await expect(takeUpstream('demo', adapters, { pinDir })).rejects.toMatchObject({
      code: 'backup_failed',
    })
    // The edit is untouched (never overwritten) and still customized.
    expect(await readFile(join(CLAUDE_DIR, 'demo', 'SKILL.md'), 'utf8')).toBe(EDITED)
    expect((await readStateFile()).skills['demo']!.customized_from).toBeTruthy()
  })

  it('restoreOriginal throws and leaves the edit live when the backup cannot be written', async () => {
    await seedLocalKit('demo', CONTENT)
    const adapters = [makeStubAdapter('claude-code', CLAUDE_DIR)]
    await sync(cwd, adapters, syncOpts())
    await writeFile(join(CLAUDE_DIR, 'demo', 'SKILL.md'), EDITED, 'utf8')
    await sync(cwd, adapters, syncOpts()) // customize

    await blockBackupStore()
    await expect(restoreOriginal('demo', adapters, { pinDir })).rejects.toMatchObject({
      code: 'backup_failed',
    })
    expect(await readFile(join(CLAUDE_DIR, 'demo', 'SKILL.md'), 'utf8')).toBe(EDITED)
    expect((await readStateFile()).skills['demo']!.customized_from).toBeTruthy()
  })
})

describe('F3 — no false "taken" when adapters fail to materialize', () => {
  it('all adapters fail → customized_from retained, materialize_failed thrown', async () => {
    await seedLocalKit('demo', CONTENT)
    await sync(cwd, [makeStubAdapter('claude-code', CLAUDE_DIR)], syncOpts())
    await writeFile(join(CLAUDE_DIR, 'demo', 'SKILL.md'), EDITED, 'utf8')
    await sync(cwd, [makeStubAdapter('claude-code', CLAUDE_DIR)], syncOpts()) // customize

    const failing = [makeFailingAdapter('claude-code', CLAUDE_DIR)]
    await expect(takeUpstream('demo', failing, { pinDir })).rejects.toMatchObject({
      code: 'materialize_failed',
    })
    // Still customized, edit still live — no clean success while nothing landed.
    const entry = (await readStateFile()).skills['demo']!
    expect(entry.customized_from).toBeTruthy()
    expect(await readFile(join(CLAUDE_DIR, 'demo', 'SKILL.md'), 'utf8')).toBe(EDITED)
  })

  it('RF3: partial (adapter A succeeds, B throws) → ROLLS BACK — both runtimes keep the edit, still customized', async () => {
    await seedLocalKit('demo', CONTENT)
    const A = makeStubAdapter('claude-code', CLAUDE_DIR)
    const B = makeStubAdapter('codex', CODEX_DIR)
    await sync(cwd, [A, B], syncOpts()) // materialize CONTENT to BOTH runtimes

    // Edit BOTH on-disk copies, then customize.
    await writeFile(join(CLAUDE_DIR, 'demo', 'SKILL.md'), EDITED, 'utf8')
    await writeFile(join(CODEX_DIR, 'demo', 'SKILL.md'), EDITED, 'utf8')
    await sync(cwd, [A, B], syncOpts()) // customize (drift on both)
    await publishHeldUpdate('demo', UPDATED)
    await sync(cwd, [A, B], syncOpts()) // held update recorded

    // Take theirs with B failing: A writes UPDATED, B throws → all-or-nothing
    // rollback restores the edit to A, leaving NO split disk.
    const Bfail = makeFailingAdapter('codex', CODEX_DIR)
    await expect(takeUpstream('demo', [A, Bfail], { pinDir })).rejects.toMatchObject({
      code: 'partial_failure',
    })

    // BOTH runtimes still hold the edit (A rolled back, B never overwritten).
    expect(await readFile(join(CLAUDE_DIR, 'demo', 'SKILL.md'), 'utf8')).toBe(EDITED)
    expect(await readFile(join(CODEX_DIR, 'demo', 'SKILL.md'), 'utf8')).toBe(EDITED)
    // State unchanged — still customized, held update intact.
    const entry = (await readStateFile()).skills['demo']!
    expect(entry.customized_from).toBeTruthy()
    expect(entry.held_update).toBeTruthy()
  })
})

describe('RF1 — multi-adapter partial materialize converges, never customizes', () => {
  it('one adapter lags after a partial materialize → next sync re-materializes it (both == vNew), not customized', async () => {
    await seedLocalKit('demo', CONTENT)
    const A = makeStubAdapter('claude-code', CLAUDE_DIR)
    const B = makeStubAdapter('codex', CODEX_DIR)
    // First sync materializes CONTENT to both; materialized_hash = CONTENT.
    await sync(cwd, [A, B], syncOpts())
    expect(await readFile(join(CLAUDE_DIR, 'demo', 'SKILL.md'), 'utf8')).toBe(CONTENT)
    expect(await readFile(join(CODEX_DIR, 'demo', 'SKILL.md'), 'utf8')).toBe(CONTENT)

    // A pull advances the store + entry.hash to UPDATED, but adapter B fails this
    // run: A gets UPDATED, B is left on CONTENT (a PARTIAL materialize).
    await publishHeldUpdate('demo', UPDATED)
    const Bfail = makeFailingAdapter('codex', CODEX_DIR)
    const r1 = await sync(cwd, [A, Bfail], syncOpts())

    // NOT customized — a lagging runtime after a partial materialize is our own
    // incomplete work, never a user edit.
    expect(r1.customized).toEqual([])
    expect(await readFile(join(CLAUDE_DIR, 'demo', 'SKILL.md'), 'utf8')).toBe(UPDATED)
    expect(await readFile(join(CODEX_DIR, 'demo', 'SKILL.md'), 'utf8')).toBe(CONTENT)
    const mid = (await readStateFile()).skills['demo']!
    expect(mid.customized_from).toBeUndefined()
    // RF2: materialized_hash did NOT advance (B never took the bytes).
    expect(mid.materialized_hash).toBe(bundleHash(CONTENT))

    // Next sync with both runtimes working CONVERGES: B re-materializes to vNew.
    const r2 = await sync(cwd, [A, B], syncOpts())
    expect(r2.customized).toEqual([])
    expect(await readFile(join(CLAUDE_DIR, 'demo', 'SKILL.md'), 'utf8')).toBe(UPDATED)
    expect(await readFile(join(CODEX_DIR, 'demo', 'SKILL.md'), 'utf8')).toBe(UPDATED)
    const done = (await readStateFile()).skills['demo']!
    expect(done.customized_from).toBeUndefined()
    expect(done.materialized_hash).toBe(bundleHash(UPDATED))
  })

  it('RF1-legacy: an entry with no materialized_hash + on-disk lag converges (re-materializes), not customized', async () => {
    await seedLocalKit('demo', CONTENT) // seed has NO materialized_hash (legacy)
    const A = makeStubAdapter('claude-code', CLAUDE_DIR)
    // A lagging on-disk copy (old author bytes) that we never recorded materializing.
    await mkdir(join(CLAUDE_DIR, 'demo'), { recursive: true })
    await writeFile(join(CLAUDE_DIR, 'demo', 'SKILL.md'), CONTENT, 'utf8')
    // A pull advances the store + entry.hash to UPDATED; still no materialized_hash.
    await publishHeldUpdate('demo', UPDATED)
    expect((await readStateFile()).skills['demo']!.materialized_hash).toBeUndefined()

    const r = await sync(cwd, [A], syncOpts())

    // Legacy pending state → converge (re-materialize UPDATED), never customize.
    expect(r.customized).toEqual([])
    expect(await readFile(join(CLAUDE_DIR, 'demo', 'SKILL.md'), 'utf8')).toBe(UPDATED)
    const after = (await readStateFile()).skills['demo']!
    expect(after.customized_from).toBeUndefined()
    expect(after.materialized_hash).toBe(bundleHash(UPDATED))
  })
})

describe('RF2 — materialized_hash advances only when every global adapter succeeds', () => {
  it('a partial materialize leaves materialized_hash un-advanced (so RF1 re-converges next run)', async () => {
    await seedLocalKit('demo', CONTENT)
    const A = makeStubAdapter('claude-code', CLAUDE_DIR)
    const B = makeStubAdapter('codex', CODEX_DIR)
    await sync(cwd, [A, B], syncOpts()) // materialized_hash = CONTENT
    expect((await readStateFile()).skills['demo']!.materialized_hash).toBe(bundleHash(CONTENT))

    await publishHeldUpdate('demo', UPDATED)
    // A succeeds writing UPDATED; B throws → NOT every adapter took the bytes.
    await sync(cwd, [A, makeFailingAdapter('codex', CODEX_DIR)], syncOpts())

    // materialized_hash must NOT have advanced to UPDATED (still CONTENT).
    expect((await readStateFile()).skills['demo']!.materialized_hash).toBe(bundleHash(CONTENT))
  })
})

describe('F5 — Restore original returns the baseline, distinct from Take theirs', () => {
  it('restoreOriginal yields the edited-from baseline while takeUpstream yields the held update', async () => {
    await seedLocalKit('demo', CONTENT)
    const adapters = [makeStubAdapter('claude-code', CLAUDE_DIR)]
    await sync(cwd, adapters, syncOpts()) // materialize CONTENT (baseline)
    await writeFile(join(CLAUDE_DIR, 'demo', 'SKILL.md'), EDITED, 'utf8')
    await sync(cwd, adapters, syncOpts()) // customize → baseline CONTENT stashed
    await publishHeldUpdate('demo', UPDATED)
    await sync(cwd, adapters, syncOpts()) // held update (store = UPDATED)

    // Restore original → the version the edit was made FROM (CONTENT), NOT UPDATED.
    const restore = await restoreOriginal('demo', adapters, { pinDir })
    expect(restore.note).toBeUndefined()
    expect(await readFile(join(CLAUDE_DIR, 'demo', 'SKILL.md'), 'utf8')).toBe(CONTENT)

    // Re-establish the same customized + held state, then Take theirs.
    await writeFile(join(CLAUDE_DIR, 'demo', 'SKILL.md'), EDITED, 'utf8')
    await sync(cwd, adapters, syncOpts()) // customize again
    await publishHeldUpdate('demo', UPDATED)
    await sync(cwd, adapters, syncOpts()) // held update

    await takeUpstream('demo', adapters, { pinDir })
    // Take theirs → the held UPDATE — different bytes than Restore produced.
    expect(await readFile(join(CLAUDE_DIR, 'demo', 'SKILL.md'), 'utf8')).toBe(UPDATED)
    expect(UPDATED).not.toBe(CONTENT)
  })
})

describe('F6 — a yanked held update does not silently install', () => {
  it('takeUpstream refuses a yanked held update; the edit stays live', async () => {
    await seedLocalKit('demo', CONTENT)
    const adapters = [makeStubAdapter('claude-code', CLAUDE_DIR)]
    await sync(cwd, adapters, syncOpts())
    await writeFile(join(CLAUDE_DIR, 'demo', 'SKILL.md'), EDITED, 'utf8')
    await sync(cwd, adapters, syncOpts()) // customize
    const upHash = await publishHeldUpdate('demo', UPDATED)
    await sync(cwd, adapters, syncOpts()) // held update recorded

    // The author yanks the held version (what sync's pull-yanked handler records).
    const st = await readStateFile()
    st.skills['demo']!.held_update = { version: 1, hash: upHash, yanked: true }
    await atomicWrite(join(SKILLET, 'state.json'), JSON.stringify(st), { backup: false })

    // Does not silently install — refuses, edit untouched, still customized.
    await expect(takeUpstream('demo', adapters, { pinDir })).rejects.toMatchObject({
      code: 'yanked',
    })
    expect(await readFile(join(CLAUDE_DIR, 'demo', 'SKILL.md'), 'utf8')).toBe(EDITED)
    expect((await readStateFile()).skills['demo']!.customized_from).toBeTruthy()

    // It also stops nudging.
    const customized = await listCustomized()
    expect(customized[0]!.hasUpdate).toBe(false)
  })

  it('a pull reporting the held version yanked flags it so it stops nudging', async () => {
    const REG = 'https://reg.test'
    const hash = await seedSignedRegistry({ subscriberTrust: 'auto' }) // entry.hash = CONTENT
    const contentHex = hash.slice('sha256:'.length)
    // Make @alice/foo a customized skill holding the current version as an update.
    const st = await readStateFile()
    const e = st.skills['@alice/foo']!
    e.registryUrl = REG
    e.customized_from = { author: 'alice', slug: '@alice/foo', version: 2, hash: 'sha256:baseline' }
    e.held_update = { version: 3, hash }
    await atomicWrite(join(SKILLET, 'state.json'), JSON.stringify(st), { backup: false })

    // A registry whose latest (== the held version) is now YANKED.
    const yankedFetch = (async (input: string | URL) => {
      const url = String(input)
      if (url.includes('/skills/alice/foo/manifest')) {
        return new Response(
          JSON.stringify({
            schema_version: 1,
            author: 'alice',
            slug: 'foo',
            skill_id: 'alice:foo',
            latest_hash: contentHex,
            install_count: 0,
            author_key_id: 'x',
            author_public_key: 'y',
            versions: [{ hash: contentHex, yanked: true, published_at: 1, url: '' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response(JSON.stringify({ error: 'offline' }), { status: 503 })
    }) as unknown as typeof fetch

    const adapters = [makeStubAdapter('claude-code', CLAUDE_DIR)]
    const result = await sync(
      cwd,
      adapters,
      syncOpts(new CaptureWritable(), {
        pullMode: 'interactive' as const,
        fetchImpl: yankedFetch,
        registryUrl: REG,
      }),
    )

    // The held update is flagged yanked and no longer nudges.
    expect(result.customized).toEqual([{ slug: '@alice/foo', hasUpdate: false }])
    expect((await readStateFile()).skills['@alice/foo']!.held_update).toMatchObject({
      hash,
      yanked: true,
    })
  })
})

describe('RF4 — restoreOriginal ABORTS when the baseline is unobtainable', () => {
  it('no stash + a store advanced past the baseline → baseline_unavailable, edit left live, no upstream install', async () => {
    await seedLocalKit('demo', CONTENT)
    const A = makeStubAdapter('claude-code', CLAUDE_DIR)
    await sync(cwd, [A], syncOpts())
    await writeFile(join(CLAUDE_DIR, 'demo', 'SKILL.md'), EDITED, 'utf8')

    // Advance the store to UPDATED (a held update), then mark the skill customized
    // against a baseline hash that was NEVER stashed and is NOT in the store — the
    // exact "baseline unobtainable" condition.
    await publishHeldUpdate('demo', UPDATED)
    const st = await readStateFile()
    st.skills['demo']!.customized_from = {
      author: null,
      slug: 'demo',
      version: 1,
      hash: 'sha256:baseline-that-no-longer-exists',
    }
    st.skills['demo']!.held_update = { version: 1, hash: bundleHash(UPDATED) }
    await atomicWrite(join(SKILLET, 'state.json'), JSON.stringify(st), { backup: false })

    // Restore original ABORTS — never substitutes the current upstream (UPDATED).
    await expect(restoreOriginal('demo', [A], { pinDir })).rejects.toMatchObject({
      code: 'baseline_unavailable',
    })
    // The edit is left live (NOT the store's current-upstream UPDATED), still customized.
    expect(await readFile(join(CLAUDE_DIR, 'demo', 'SKILL.md'), 'utf8')).toBe(EDITED)
    expect((await readStateFile()).skills['demo']!.customized_from).toBeTruthy()
  })
})

describe('RF6 — a present-but-unreadable copy aborts the reconcile (never overwrites an un-backed-up edit)', () => {
  // Windows ignores POSIX mode bits for this purpose: chmod(dir, 0o000) leaves
  // the directory fully readable, so the unreadable-copy precondition cannot be
  // set up and takeUpstream never reaches backup_failed.
  it.skipIf(process.platform === 'win32')('take theirs aborts (backup_failed) and never materializes when a copy cannot be read', async () => {
    if (process.getuid && process.getuid() === 0) return // root bypasses chmod perms
    await seedLocalKit('demo', CONTENT)
    const A = makeStubAdapter('claude-code', CLAUDE_DIR)
    const B = makeStubAdapter('codex', CODEX_DIR)
    await sync(cwd, [A, B], syncOpts())
    await writeFile(join(CLAUDE_DIR, 'demo', 'SKILL.md'), EDITED, 'utf8')
    await writeFile(join(CODEX_DIR, 'demo', 'SKILL.md'), EDITED, 'utf8')
    await sync(cwd, [A, B], syncOpts()) // customize

    // Make codex's present copy unreadable (a real dir that can't be read).
    await chmod(join(CODEX_DIR, 'demo'), 0o000)
    try {
      await expect(takeUpstream('demo', [A, B], { pinDir })).rejects.toMatchObject({
        code: 'backup_failed',
      })
      // Abort happens BEFORE any materialize — A's readable edit is untouched.
      expect(await readFile(join(CLAUDE_DIR, 'demo', 'SKILL.md'), 'utf8')).toBe(EDITED)
      expect((await readStateFile()).skills['demo']!.customized_from).toBeTruthy()
    } finally {
      await chmod(join(CODEX_DIR, 'demo'), 0o755)
    }
  })
})

describe('RF7 — a torn baseline stash is rejected on hash mismatch', () => {
  it('readBaselineStash returns null when the stored bytes do not hash to the key; a matching stash round-trips', async () => {
    // A torn/partial stash: bytes present under a key they do not hash to.
    const wrongKey = bundleHash(UPDATED)
    await stashBaselineVersion(wrongKey, new Map([['SKILL.md', Buffer.from(CONTENT, 'utf8')]]))
    expect(await readBaselineStash(wrongKey)).toBeNull()

    // An intact stash round-trips.
    const realHash = bundleHash(CONTENT)
    await stashBaselineVersion(realHash, new Map([['SKILL.md', Buffer.from(CONTENT, 'utf8')]]))
    const got = await readBaselineStash(realHash)
    expect(got).not.toBeNull()
    expect(got!.get('SKILL.md')!.toString('utf8')).toBe(CONTENT)
  })
})

describe('RF8 — the baseline stash is cleaned once the skill is un-customized', () => {
  it('restoreOriginal success removes the baseline stash', async () => {
    await seedLocalKit('demo', CONTENT)
    const A = makeStubAdapter('claude-code', CLAUDE_DIR)
    await sync(cwd, [A], syncOpts())
    await writeFile(join(CLAUDE_DIR, 'demo', 'SKILL.md'), EDITED, 'utf8')
    await sync(cwd, [A], syncOpts()) // customize → stashes the baseline

    const baseHash = (await readStateFile()).skills['demo']!.customized_from!.hash
    expect(await readBaselineStash(baseHash)).not.toBeNull() // stash present

    await restoreOriginal('demo', [A], { pinDir })

    // Un-customized → stash cleaned up (bounded store).
    expect(await readBaselineStash(baseHash)).toBeNull()
    expect((await readStateFile()).skills['demo']!.customized_from).toBeUndefined()
  })
})

// The gate for the whole unit: on EVERY sync mode, an edited materialized
// skill's on-disk bytes equal the user's edit afterward — never reverted.
describe('EDIT-PRESERVATION PROPERTY — an edited skill is never reverted', () => {
  type Mode = 'headless' | 'interactive' | 'pinned' | 'gated' | 'local'
  const modes: Mode[] = ['headless', 'interactive', 'pinned', 'gated', 'local']

  for (const mode of modes) {
    for (const withDotfile of [false, true]) {
      it(`${mode} sync${withDotfile ? ' (with .DS_Store)' : ''}`, async () => {
        const registryMode = mode === 'headless' || mode === 'interactive' || mode === 'gated'
        let adapterSlug: string
        let stateSlug: string
        if (registryMode) {
          await seedSignedRegistry(mode === 'gated' ? {} : { subscriberTrust: 'auto' })
          adapterSlug = 'foo'
          stateSlug = '@alice/foo'
        } else {
          await seedLocalKit('demo', CONTENT, mode === 'pinned' ? { pinned: true } : {})
          adapterSlug = 'demo'
          stateSlug = 'demo'
        }

        // The prior copy is a MATERIALIZED (settled) skill: record its
        // materialized_hash so the edit below reads as a genuine drift. RF1: only
        // a STABLE skill (materialized_hash === hash) customizes on drift; a
        // pending/legacy skill converges instead (covered by its own tests).
        const seeded = await readStateFile()
        seeded.skills[stateSlug]!.materialized_hash = bundleHash(CONTENT)
        await atomicWrite(join(SKILLET, 'state.json'), JSON.stringify(seeded), { backup: false })

        // A settled prior copy on disk, then something edits it.
        const dir = join(CLAUDE_DIR, adapterSlug)
        await mkdir(dir, { recursive: true })
        await writeFile(join(dir, 'SKILL.md'), CONTENT, 'utf8')
        await writeFile(join(dir, 'SKILL.md'), EDITED, 'utf8')
        if (withDotfile) await writeFile(join(dir, '.DS_Store'), 'junk', 'utf8')

        const adapters = [makeStubAdapter('claude-code', CLAUDE_DIR)]
        const opts = syncOpts(
          new CaptureWritable(),
          mode === 'interactive' ? { pullMode: 'interactive' as const } : {},
        )
        // No mode throws now: a drifted skill is customized BEFORE any gate.
        const result = await sync(cwd, adapters, opts)

        // The edit is live — never reverted, on any path.
        expect(await readFile(join(dir, 'SKILL.md'), 'utf8')).toBe(EDITED)
        expect(result.customized.map((c) => c.slug)).toContain(stateSlug)
      })
    }
  }
})

describe('U2 — store edit is a GLOBAL edit (propagates to every runtime)', () => {
  it('AE2: editing the STORE propagates to all adapters and advances the baseline', async () => {
    await seedLocalKit('demo', CONTENT)
    const adapters = [
      makeStubAdapter('claude-code', CLAUDE_DIR),
      makeStubAdapter('openclaw', CODEX_DIR),
    ]
    await sync(cwd, adapters, syncOpts())
    // Baseline: both runtimes hold CONTENT.
    expect(await readFile(join(CLAUDE_DIR, 'demo', 'SKILL.md'), 'utf8')).toBe(CONTENT)
    expect(await readFile(join(CODEX_DIR, 'demo', 'SKILL.md'), 'utf8')).toBe(CONTENT)

    // Edit the STORE (what the desktop viewer's Folder button reveals).
    await writeStore('demo', EDITED)
    const result = await sync(cwd, adapters, syncOpts())

    // The edit landed on EVERY runtime.
    expect(await readFile(join(CLAUDE_DIR, 'demo', 'SKILL.md'), 'utf8')).toBe(EDITED)
    expect(await readFile(join(CODEX_DIR, 'demo', 'SKILL.md'), 'utf8')).toBe(EDITED)
    // Marked customized, no held update, and (unlike a per-runtime edit) it materialized.
    expect(result.customized).toEqual([{ slug: 'demo', hasUpdate: false }])
    expect(result.materialized.length).toBeGreaterThan(0)
    const entry = (await readStateFile()).skills['demo']!
    expect(entry.customized_from).toBeTruthy()
    expect(entry.materialized_hash).toBe(bundleHash(EDITED))
    expect(entry.held_update).toBeUndefined()
  })

  it('AE3: editing only one ADAPTER stays local — store and other runtimes untouched', async () => {
    await seedLocalKit('demo', CONTENT)
    const adapters = [
      makeStubAdapter('claude-code', CLAUDE_DIR),
      makeStubAdapter('openclaw', CODEX_DIR),
    ]
    await sync(cwd, adapters, syncOpts())

    // Edit ONLY the claude adapter copy; the store stays clean.
    await writeFile(join(CLAUDE_DIR, 'demo', 'SKILL.md'), EDITED, 'utf8')
    const result = await sync(cwd, adapters, syncOpts())

    // Per-runtime: claude keeps its edit, the other runtime and the store do not.
    expect(await readFile(join(CLAUDE_DIR, 'demo', 'SKILL.md'), 'utf8')).toBe(EDITED)
    expect(await readFile(join(CODEX_DIR, 'demo', 'SKILL.md'), 'utf8')).toBe(CONTENT)
    expect(await readFile(join(SKILLET, 'skills', 'demo', 'SKILL.md'), 'utf8')).toBe(CONTENT)
    // No propagation — the existing per-runtime branch, no materialize.
    expect(result.customized).toEqual([{ slug: 'demo', hasUpdate: false }])
    expect(result.materialized).toHaveLength(0)
  })

  it('AE4: collision — store wins, the adapter edit is backed up', async () => {
    await seedLocalKit('demo', CONTENT)
    const adapters = [
      makeStubAdapter('claude-code', CLAUDE_DIR),
      makeStubAdapter('openclaw', CODEX_DIR),
    ]
    await sync(cwd, adapters, syncOpts())

    // Both diverge from baseline, to DIFFERENT content: an agent edit in claude
    // (UPDATED) and a human store edit (EDITED).
    await writeFile(join(CLAUDE_DIR, 'demo', 'SKILL.md'), UPDATED, 'utf8')
    await writeStore('demo', EDITED)
    await sync(cwd, adapters, syncOpts())

    // Store wins everywhere; the overwritten agent edit is recoverable.
    expect(await readFile(join(CLAUDE_DIR, 'demo', 'SKILL.md'), 'utf8')).toBe(EDITED)
    expect(await readFile(join(CODEX_DIR, 'demo', 'SKILL.md'), 'utf8')).toBe(EDITED)
    expect(await backupContains(UPDATED)).toBe(true)
  })

  it('AE5: a store edit with a pending author version holds the update and still propagates', async () => {
    await seedLocalKit('demo', CONTENT)
    const adapters = [makeStubAdapter('claude-code', CLAUDE_DIR)]
    await sync(cwd, adapters, syncOpts())

    // Store edited; entry.hash advanced to a pulled author version (what the
    // pre-pull guard leaves behind — the edit kept, the new version pending).
    await writeStore('demo', EDITED)
    const pending = bundleHash(UPDATED)
    const s = await readStateFile()
    s.skills['demo']!.hash = pending
    await atomicWrite(join(SKILLET, 'state.json'), JSON.stringify(s), { backup: false })

    const result = await sync(cwd, adapters, syncOpts())

    // Edit propagated; the author version is HELD, not applied.
    expect(await readFile(join(CLAUDE_DIR, 'demo', 'SKILL.md'), 'utf8')).toBe(EDITED)
    expect(await readFile(join(SKILLET, 'skills', 'demo', 'SKILL.md'), 'utf8')).toBe(EDITED)
    const entry = (await readStateFile()).skills['demo']!
    expect(entry.held_update?.hash).toBe(pending)
    expect(result.customized).toEqual([{ slug: 'demo', hasUpdate: true }])
  })
})

describe('U4 — read-only live-edit scan (listLiveEdits)', () => {
  it('AE1: detects a fresh store edit WITHOUT mutating state or disk', async () => {
    await seedLocalKit('demo', CONTENT)
    const adapters = [makeStubAdapter('claude-code', CLAUDE_DIR)]
    await sync(cwd, adapters, syncOpts())

    // Edit the store; do NOT sync.
    await writeStore('demo', EDITED)
    const stateBefore = await readFile(join(SKILLET, 'state.json'), 'utf8')

    const live = await listLiveEdits(adapters)
    expect(live).toEqual([{ slug: 'demo', where: 'store' }])

    // Read-only: state.json is byte-identical and the store still holds the edit
    // (not customized, not reverted).
    expect(await readFile(join(SKILLET, 'state.json'), 'utf8')).toBe(stateBefore)
    expect((await readStateFile()).skills['demo']!.customized_from).toBeUndefined()
    expect(await readFile(join(SKILLET, 'skills', 'demo', 'SKILL.md'), 'utf8')).toBe(EDITED)
  })

  it('detects an adapter-only edit as where=adapter', async () => {
    await seedLocalKit('demo', CONTENT)
    const adapters = [makeStubAdapter('claude-code', CLAUDE_DIR)]
    await sync(cwd, adapters, syncOpts())

    await writeFile(join(CLAUDE_DIR, 'demo', 'SKILL.md'), EDITED, 'utf8')
    const live = await listLiveEdits(adapters)
    expect(live).toEqual([{ slug: 'demo', where: 'adapter' }])
  })

  it('excludes already-customized skills (listCustomized owns those) and clean skills', async () => {
    await seedLocalKit('demo', CONTENT)
    const adapters = [makeStubAdapter('claude-code', CLAUDE_DIR)]
    await sync(cwd, adapters, syncOpts())
    // Clean skill → nothing to surface.
    expect(await listLiveEdits(adapters)).toEqual([])

    // Once an edit is reconciled (customized_from set), it drops out of the live scan.
    await writeStore('demo', EDITED)
    await sync(cwd, adapters, syncOpts())
    expect((await readStateFile()).skills['demo']!.customized_from).toBeTruthy()
    expect(await listLiveEdits(adapters)).toEqual([])
  })
})
