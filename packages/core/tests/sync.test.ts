/**
 * Smoke test for fan-out sync() behavior.
 *
 * Verifies:
 *   - sync() runs detect() on every adapter and materializes only into
 *     detected ones (skipped-not-detected for the rest).
 *   - Both detected runtimes receive the SKILL.md.
 *   - Undetected runtime is skipped cleanly (no write, status reported).
 *   - One adapter's materialize() failure does not abort the run
 *     (degrade-never-delete) — other adapters still receive the file.
 *
 * Isolation: HOME and SKILLET_DIR are overridden via vi.hoisted before
 * @skillet/core loads, so MATERIALIZATION_ROOT_ALLOWLIST and the kit state
 * both resolve under TEST_ROOT. No security checks are mocked.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { installOfflineRegistry } from './helpers/offline-registry.js'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'

// Hoisted: redirect HOME so the allowlist computes from a tmp dir, and SKILLET_DIR
// so kit state lives in a tmp dir. Must run BEFORE @skillet/core loads — its
// allowlist and SKILLET_DIR are evaluated at module-init time.
const TEST_ROOT = vi.hoisted(() => {
  const { redirectHome } = require('./helpers/redirect-home.cjs')
  return redirectHome('skillet-sync-test')
})

import { sync, requiresApproval, mergeAvailabilityRuntimes } from '../src/commands/sync.js'
import { saveDeviceToken } from '../src/device-token.js'
import type { Adapter, MaterializeOptions, TargetPathOptions } from '../src/adapter.js'
import { materializeSlugDir } from '../src/bundle/write.js'
import { BUNDLED_ROUTE_SLUG } from '../src/commands/route.js'
import { atomicWrite } from '../src/util/atomic.js'
import { canonicalContentHash } from '@skillet/protocol'
import { generateAuthorKey } from '../src/signing/index.js'
import { signEnvelope } from '../src/signing/envelope.js'
import { SIG_ALG_SESSION } from '../src/signing/session-attest.js'
import { pinAuthorKey } from '../src/signing/pin.js'

// Allowlist-aligned target directories. These match the entries in
// MATERIALIZATION_ROOT_ALLOWLIST after the HOME override above.
const CLAUDE_DIR = join(TEST_ROOT, '.claude', 'skills')
const CODEX_DIR = join(TEST_ROOT, '.agents', 'skills')
const HERMES_DIR = join(TEST_ROOT, '.hermes', 'skills')

function stubMaterializeDir(
  slug: string,
  pathOpts: { owner?: string | null; dirName?: string } = {},
): string {
  if (pathOpts.dirName) {
    return materializeSlugDir(slug, pathOpts.owner ?? null, { dirName: pathOpts.dirName })
  }
  return slug
}

function makeStubAdapter(opts: {
  name: string
  detected: boolean
  targetDir: string
  failOn?: string
}): Adapter {
  return {
    name: opts.name,
    targetDir: opts.targetDir,
    async detect() {
      return opts.detected
    },
    targetPath(slug: string, pathOpts: TargetPathOptions = {}) {
      const dir = stubMaterializeDir(slug, pathOpts)
      return join(opts.targetDir, dir, 'SKILL.md')
    },
    targetSkillDir(slug: string, pathOpts: TargetPathOptions = {}) {
      const dir = stubMaterializeDir(slug, pathOpts)
      return join(opts.targetDir, dir)
    },
    async materialize(slug, bundle, matOpts: MaterializeOptions = {}) {
      if (opts.failOn && opts.failOn === slug) {
        throw new Error(`stub failure in ${opts.name}/${slug}`)
      }
      const dir = stubMaterializeDir(slug, matOpts)
      const written: string[] = []
      await mkdir(join(opts.targetDir, dir), { recursive: true })
      for (const [path, bytes] of bundle.entries()) {
        const dest = join(opts.targetDir, dir, path)
        await mkdir(join(opts.targetDir, dir, ...path.split('/').slice(0, -1)), {
          recursive: true,
        })
        await writeFile(dest, Buffer.from(bytes))
        written.push(dest)
      }
      return written
    },
  }
}

async function seedLocalOnly(
  slug: string,
  content: string,
  opts: { owner?: string } = {},
): Promise<void> {
  const skilletDir = process.env['SKILLET_DIR'] as string
  const skillsDir = join(skilletDir, 'skills', slug)
  await mkdir(skillsDir, { recursive: true })
  await writeFile(join(skillsDir, 'SKILL.md'), content, 'utf8')
  const now = new Date().toISOString()
  const bundle = new Map<string, Uint8Array>([['SKILL.md', Buffer.from(content, 'utf8')]])
  const hash = canonicalContentHash(bundle)
  const state = {
    version: 1,
    skills: {
      [slug]: {
        slug,
        name: slug,
        description: '',
        version: 1,
        hash,
        source: 'local' as const,
        owner: opts.owner ?? null,
        importedAt: now,
        updatedAt: now,
      },
    },
  }
  await atomicWrite(join(skilletDir, 'state.json'), JSON.stringify(state), {
    backup: false,
  })
}

async function seedKit(slug: string, content: string, sourceKit = '@test/sync-kit'): Promise<void> {
  const skilletDir = process.env['SKILLET_DIR'] as string
  const skillsDir = join(skilletDir, 'skills', slug)
  await mkdir(skillsDir, { recursive: true })
  await writeFile(join(skillsDir, 'SKILL.md'), content, 'utf8')
  const now = new Date().toISOString()
  // entry.hash must be the canonical bundle hash now that verifyForMaterialize
  // gate-keeps the write — hash semantics, not a stub.
  const bundle = new Map<string, Uint8Array>([['SKILL.md', Buffer.from(content, 'utf8')]])
  const hash = canonicalContentHash(bundle)
  const statePath = join(skilletDir, 'state.json')
  let skills: Record<string, unknown> = {}
  try {
    const existing = JSON.parse(await readFile(statePath, 'utf8')) as { skills?: Record<string, unknown> }
    skills = existing.skills ?? {}
  } catch {
    // Fresh state for this test root.
  }
  skills[slug] = {
    slug,
    name: slug,
    description: '',
    version: 1,
    hash,
    source: 'local' as const,
    sourceKit,
    importedAt: now,
    updatedAt: now,
  }
  await atomicWrite(
    statePath,
    JSON.stringify({
      version: 1,
      skills,
    }),
    { backup: false },
  )
}

installOfflineRegistry()

describe('sync() — fan-out across detected adapters', () => {
  let cwd: string

  beforeEach(async () => {
    delete process.env['SKILLET_TOKEN']
    await rm(TEST_ROOT, { recursive: true, force: true })
    cwd = join(TEST_ROOT, 'project')
    await mkdir(cwd, { recursive: true })
  })

  afterEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true })
  })

  it('materializes into every detected runtime and skips undetected ones', async () => {
    const skillContent = '---\nname: demo\n---\n\nHello fan-out.\n'
    await seedKit('demo', skillContent)

    // Two detected, one undetected. Real adapter names + targetDirs so the
    // security gate (validateAdapterRoot) passes against the allowlist.
    const adapters = [
      makeStubAdapter({ name: 'claude-code', detected: true, targetDir: CLAUDE_DIR }),
      makeStubAdapter({ name: 'codex', detected: true, targetDir: CODEX_DIR }),
      makeStubAdapter({ name: 'hermes', detected: false, targetDir: HERMES_DIR }),
    ]

    const result = await sync(cwd, adapters)

    expect(result.adapters.map((a) => a.name)).toEqual(['claude-code', 'codex', 'hermes'])
    expect(result.adapters[0]?.status).toBe('materialized')
    expect(result.adapters[0]?.count).toBe(1)
    expect(result.adapters[1]?.status).toBe('materialized')
    expect(result.adapters[1]?.count).toBe(1)
    expect(result.adapters[2]?.status).toBe('skipped-not-detected')
    expect(result.adapters[2]?.count).toBe(0)
    expect(result.adapters[2]?.paths).toEqual([])

    // Both detected runtimes received the file on disk.
    expect(await readFile(join(CLAUDE_DIR, 'demo', 'SKILL.md'), 'utf8')).toBe(skillContent)
    expect(await readFile(join(CODEX_DIR, 'demo', 'SKILL.md'), 'utf8')).toBe(skillContent)

    // Undetected runtime got nothing.
    await expect(readFile(join(HERMES_DIR, 'demo', 'SKILL.md'))).rejects.toThrow()

    // skillet.lock written. Switched the lockfile from JSON to TOML
    // (PROTOCOL §11), so we assert content via substring rather than parse.
    expect(result.lockPath).toContain('skillet.lock')
    const lockText = await readFile(result.lockPath, 'utf8')
    expect(lockText).toContain('ref = "demo"')

    // materialized array covers only the detected adapters.
    expect(result.materialized).toHaveLength(2)
    expect(result.materialized.map((m) => m.dest).sort()).toEqual(
      [join(CLAUDE_DIR, 'demo', 'SKILL.md'), join(CODEX_DIR, 'demo', 'SKILL.md')].sort(),
    )
  })

  it('materializes baseline adapters even when detect() is false', async () => {
    const skillContent = '---\nname: baseline\n---\n\nUniversal path.\n'
    await seedKit('baseline', skillContent)

    const adapters = [
      makeStubAdapter({ name: 'codex', detected: false, targetDir: CODEX_DIR }),
      makeStubAdapter({ name: 'hermes', detected: false, targetDir: HERMES_DIR }),
    ]

    const result = await sync(cwd, adapters, {
      baselineAdapterNames: ['codex'],
    })

    expect(result.adapters[0]?.status).toBe('materialized')
    expect(result.adapters[0]?.count).toBe(1)
    expect(result.adapters[1]?.status).toBe('skipped-not-detected')
    expect(await readFile(join(CODEX_DIR, 'baseline', 'SKILL.md'), 'utf8')).toBe(skillContent)
    await expect(readFile(join(HERMES_DIR, 'baseline', 'SKILL.md'))).rejects.toThrow()
  })

  it("degrade-never-delete: one adapter's failure does not block the others", async () => {
    const skillContent = '---\nname: demo\n---\n\nFan-out under partial failure.\n'
    await seedKit('demo', skillContent)

    const adapters = [
      makeStubAdapter({ name: 'claude-code', detected: true, targetDir: CLAUDE_DIR }),
      // codex throws on materialize; the run should continue past it.
      makeStubAdapter({
        name: 'codex',
        detected: true,
        targetDir: CODEX_DIR,
        failOn: 'demo',
      }),
      // hermes is undetected and still reported as skipped.
      makeStubAdapter({ name: 'hermes', detected: false, targetDir: HERMES_DIR }),
    ]

    const result = await sync(cwd, adapters)

    expect(result.adapters[0]?.status).toBe('materialized')
    expect(result.adapters[1]?.status).toBe('failed')
    expect(result.adapters[1]?.error).toMatch(/stub failure/)
    expect(result.adapters[2]?.status).toBe('skipped-not-detected')

    // Healthy runtime still received the file.
    expect(await readFile(join(CLAUDE_DIR, 'demo', 'SKILL.md'), 'utf8')).toBe(skillContent)
    // Failed runtime did not.
    await expect(readFile(join(CODEX_DIR, 'demo', 'SKILL.md'))).rejects.toThrow()
  })

  it('continues materializing sibling skills on the same adapter after one failure', async () => {
    const skillContent = '---\nname: ok\n---\n\nSibling still lands.\n'
    await seedKit('skill-a', skillContent)
    await seedKit('skill-b', skillContent)

    const adapters = [
      makeStubAdapter({
        name: 'codex',
        detected: true,
        targetDir: CODEX_DIR,
        failOn: 'skill-a',
      }),
    ]

    const result = await sync(cwd, adapters)

    expect(result.adapters[0]?.status).toBe('materialized')
    expect(result.adapters[0]?.count).toBe(1)
    expect(result.failed.some((f) => f.slug === 'skill-a')).toBe(true)
    await expect(readFile(join(CODEX_DIR, 'skill-a', 'SKILL.md'))).rejects.toThrow()
    expect(await readFile(join(CODEX_DIR, 'skill-b', 'SKILL.md'), 'utf8')).toBe(skillContent)
  })

  it('skips local library skills without sourceKit (kit-exclusive sync)', async () => {
    const skillContent = '---\nname: local\n---\n\nLocal only.\n'
    await seedLocalOnly('local-skill', skillContent)

    const adapters = [
      makeStubAdapter({ name: 'claude-code', detected: true, targetDir: CLAUDE_DIR }),
    ]
    const result = await sync(cwd, adapters)
    expect(result.materialized).toHaveLength(0)
    await expect(readFile(join(CLAUDE_DIR, 'local-skill', 'SKILL.md'))).rejects.toThrow()
  })

  it('materializes always-on system skills without sourceKit', async () => {
    const skillContent =
      '---\nname: skillet\ndescription: route meta\nuser-invocable: true\n---\n\nRoute skill.\n'
    await seedLocalOnly(BUNDLED_ROUTE_SLUG, skillContent, { owner: 'skillet' })

    const adapters = [makeStubAdapter({ name: 'codex', detected: true, targetDir: CODEX_DIR })]
    const result = await sync(cwd, adapters)
    expect(result.materialized.length).toBeGreaterThan(0)
    await readFile(join(CODEX_DIR, 'skillet', 'SKILL.md'), 'utf8')
  })

  it('materializes a bundled route update on the FIRST sync after its content changes', async () => {
    // The pre-existing installed router (store + state consistent at the OLD hash).
    const oldContent =
      '---\nname: skillet\ndescription: route meta\nuser-invocable: true\n---\n\nOld router.\n'
    const newContent =
      '---\nname: skillet\ndescription: route meta\nuser-invocable: true\n---\n\nNew router with the library fall-through.\n'
    await seedLocalOnly(BUNDLED_ROUTE_SLUG, oldContent, { owner: 'skillet' })

    const adapters = [makeStubAdapter({ name: 'codex', detected: true, targetDir: CODEX_DIR })]
    // ensureBundledRouteSkill rewrites the store + state to newContent mid-sync.
    // The materialize loop must verify against the fresh hash, not the pre-ensure
    // snapshot — otherwise it reads "integrity_failed: local content hash drifted"
    // and skips, so a shipped router change wouldn't reach agents on this sync.
    // '/no/such/dir' forces the inline (bundledRouteSkillMd) fallback.
    const result = await sync(cwd, adapters, {
      bundledRouteSkillDir: '/no/such/dir',
      bundledRouteSkillMd: newContent,
    })

    const materialized = await readFile(join(CODEX_DIR, 'skillet', 'SKILL.md'), 'utf8')
    expect(materialized).toContain('New router with the library fall-through')
    expect(materialized).not.toContain('Old router.')
    expect(result.failed.some((f) => f.slug === BUNDLED_ROUTE_SLUG)).toBe(false)
  })
})

async function seedBrokenRegistrySkill(
  slug: string,
  content: string,
  sourceKit = '@test/sync-kit',
): Promise<void> {
  const skilletDir = process.env['SKILLET_DIR'] as string
  const skillsDir = join(skilletDir, 'skills', slug)
  await mkdir(skillsDir, { recursive: true })
  await writeFile(join(skillsDir, 'SKILL.md'), content, 'utf8')
  const bundle = new Map<string, Uint8Array>([['SKILL.md', Buffer.from(content, 'utf8')]])
  const hash = canonicalContentHash(bundle)
  const now = new Date().toISOString()
  const state = {
    version: 1,
    skills: {
      [slug]: {
        slug,
        name: slug.split('/').pop() ?? slug,
        description: '',
        version: 1,
        hash,
        source: 'registry' as const,
        sourceKit,
        importedAt: now,
        updatedAt: now,
      },
    },
  }
  await atomicWrite(join(skilletDir, 'state.json'), JSON.stringify(state), {
    backup: false,
  })
}

async function seedSessionRegistrySkill(
  slug: string,
  content: string,
  sourceKit = '@test/sync-kit',
): Promise<void> {
  const skilletDir = process.env['SKILLET_DIR'] as string
  const skillsDir = join(skilletDir, 'skills', slug)
  await mkdir(skillsDir, { recursive: true })
  await writeFile(join(skillsDir, 'SKILL.md'), content, 'utf8')
  const bundle = new Map<string, Uint8Array>([['SKILL.md', Buffer.from(content, 'utf8')]])
  const hash = canonicalContentHash(bundle)
  const now = new Date().toISOString()
  const state = {
    version: 1,
    skills: {
      [slug]: {
        slug,
        name: slug.split('/').pop() ?? slug,
        description: '',
        version: 1,
        hash,
        source: 'registry' as const,
        sourceKit,
        signature: { alg: SIG_ALG_SESSION, key_id: '0'.repeat(64), sig: '' },
        importedAt: now,
        updatedAt: now,
      },
    },
  }
  await atomicWrite(join(skilletDir, 'state.json'), JSON.stringify(state), {
    backup: false,
  })
}

// ── helpers for registry-sourced diff tests ───────────────────────────

class CaptureWritable extends Writable {
  data = ''
  override _write(chunk: Buffer, _enc: string, cb: () => void) {
    this.data += chunk.toString('utf8')
    cb()
  }
}

describe('sync() — quietSkipLines', () => {
  let cwd: string

  beforeEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true })
    cwd = join(TEST_ROOT, 'project')
    await mkdir(cwd, { recursive: true })
    await mkdir(CLAUDE_DIR, { recursive: true })
  })

  afterEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true })
  })

  it('writes Skipped lines by default when materialize is blocked', async () => {
    const skillContent = '---\nname: demo\n---\n\nDemo.\n'
    await seedBrokenRegistrySkill('@me/demo', skillContent)
    const capture = new CaptureWritable()
    const adapters = [
      makeStubAdapter({ name: 'claude-code', detected: true, targetDir: CLAUDE_DIR }),
    ]
    const result = await sync(cwd, adapters, { output: capture, approvePre: true })
    expect(capture.data).toContain('Skipped "@me/demo"')
    expect(result.failed).toHaveLength(1)
  })

  it('quietSkipLines suppresses skip stdout but keeps failed entries', async () => {
    const skillContent = '---\nname: demo\n---\n\nDemo.\n'
    await seedBrokenRegistrySkill('@me/demo', skillContent)
    const capture = new CaptureWritable()
    const adapters = [
      makeStubAdapter({ name: 'claude-code', detected: true, targetDir: CLAUDE_DIR }),
    ]
    const result = await sync(cwd, adapters, {
      output: capture,
      approvePre: true,
      quietSkipLines: true,
    })
    expect(capture.data).not.toContain('Skipped')
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]?.reason).toMatch(/integrity_failed/)
  })
})

describe('sync() — session-attested registry materialize', () => {
  let cwd: string

  beforeEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true })
    cwd = join(TEST_ROOT, 'project')
    await mkdir(cwd, { recursive: true })
    await mkdir(CLAUDE_DIR, { recursive: true })
  })

  afterEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true })
  })

  it('materializes session-upload skill after approval without author keys', async () => {
    const skillContent = '---\nname: demo\ndescription: Demo skill\n---\n\nDemo.\n'
    await seedSessionRegistrySkill('@me/demo', skillContent)
    const capture = new CaptureWritable()
    const adapters = [
      makeStubAdapter({ name: 'claude-code', detected: true, targetDir: CLAUDE_DIR }),
    ]
    const result = await sync(cwd, adapters, { output: capture, approvePre: true })
    expect(result.failed.filter((f) => f.reason?.includes('integrity_failed'))).toHaveLength(0)
    expect(result.materialized.some((m) => m.slug === '@me/demo')).toBe(true)
    const dest = result.materialized.find((m) => m.slug === '@me/demo')?.dest
    expect(dest).toBeTruthy()
    const written = await readFile(dest!, 'utf8')
    expect(written).toContain('Demo.')
  })
})

function pubFromKey(k: ReturnType<typeof generateAuthorKey>): string {
  const jwk = k.publicKey.export({ format: 'jwk' }) as { x: string }
  return Buffer.from(jwk.x, 'base64url').toString('base64')
}

async function seedMultiFileBundle(
  slug: string,
  bundle: Map<string, Uint8Array>,
  skilletDir: string,
): Promise<void> {
  const skillsDir = join(skilletDir, 'skills', slug)
  await mkdir(skillsDir, { recursive: true })
  for (const [bundlePath, bytes] of bundle) {
    const parts = bundlePath.split('/')
    if (parts.length > 1) {
      await mkdir(join(skillsDir, ...parts.slice(0, -1)), { recursive: true })
    }
    await writeFile(join(skillsDir, bundlePath), Buffer.from(bytes))
  }
}

async function writeRegistryState(
  slug: string,
  version: number,
  hash: string,
  authorKey: ReturnType<typeof generateAuthorKey>,
  pub: string,
  sig: ReturnType<typeof signEnvelope>,
  skilletDir: string,
): Promise<void> {
  const now = new Date().toISOString()
  const name = slug.split('/').pop() ?? slug
  const state = {
    version: 1,
    skills: {
      [slug]: {
        slug,
        name,
        description: '',
        version,
        hash,
        source: 'registry' as const,
        sourceKit: '@test/sync-kit',
        authorKeyId: authorKey.keyId,
        authorPubBase64: pub,
        signature: sig,
        importedAt: now,
        updatedAt: now,
      },
    },
  }
  await atomicWrite(join(skilletDir, 'state.json'), JSON.stringify(state), {
    backup: false,
  })
}

// ── graded diff must cover all bundle files ───────────────────────────

describe('sync() — graded diff covers all bundle files', () => {
  let cwd: string
  let pinDir: string

  beforeEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true })
    cwd = join(TEST_ROOT, 'project')
    pinDir = join(TEST_ROOT, '.config', 'skillet', 'pinned')
    await mkdir(cwd, { recursive: true })
    await mkdir(pinDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true })
  })

  it('shows a newly added scripts/run.sh in the approval diff', async () => {
    const authorKey = generateAuthorKey()
    const pub = pubFromKey(authorKey)
    const slug = 'alice/test-skill'

    const bundle = new Map<string, Uint8Array>([
      ['SKILL.md', Buffer.from('---\nname: test\n---\n\nHello.\n')],
      ['scripts/run.sh', Buffer.from('#!/bin/sh\nexfil\n')],
    ])
    const hash = canonicalContentHash(bundle)
    const sig = signEnvelope(hash, authorKey)
    // entry.hash tracks what sync last wrote to disk (SKILL.md only), so the
    // grown store bundle reads as an author UPDATE (approval-gated), not an edit.
    const baselineHash = canonicalContentHash(
      new Map([['SKILL.md', Buffer.from('---\nname: test\n---\n\nHello.\n')]]),
    )

    const skilletDir = process.env['SKILLET_DIR'] as string
    await seedMultiFileBundle(slug, bundle, skilletDir)
    await writeRegistryState(slug, 1, baselineHash, authorKey, pub, sig, skilletDir)
    await pinAuthorKey('alice', { key_id: authorKey.keyId, pub, first_seen_version: 1 }, pinDir)

    // Pre-materialize only SKILL.md — scripts/run.sh does not exist yet on disk.
    const skillOnDisk = join(CLAUDE_DIR, 'alice', 'test-skill')
    await mkdir(skillOnDisk, { recursive: true })
    await writeFile(join(skillOnDisk, 'SKILL.md'), '---\nname: test\n---\n\nHello.\n', 'utf8')

    const adapters = [
      makeStubAdapter({ name: 'claude-code', detected: true, targetDir: CLAUDE_DIR }),
    ]

    // Non-TTY output captures the diff, then sync() throws because non-TTY → auto-deny.
    const out = new CaptureWritable()
    await expect(
      sync(cwd, adapters, {
        output: out,
        input: Readable.from([]),
        approvalLockPath: join(TEST_ROOT, 'approval.lock'),
        configDir: join(TEST_ROOT, '.config'),
        pinDir,
      }),
    ).rejects.toThrow('requires approval')

    expect(out.data).toContain('scripts/run.sh')
    expect(out.data).toContain('+#!/bin/sh')
  })

  it('shows a modified scripts/run.sh in the approval diff', async () => {
    const authorKey = generateAuthorKey()
    const pub = pubFromKey(authorKey)
    const slug = 'alice/test-skill'

    // Incoming bundle has updated scripts/run.sh.
    const bundle = new Map<string, Uint8Array>([
      ['SKILL.md', Buffer.from('---\nname: test\n---\n\nHello.\n')],
      ['scripts/run.sh', Buffer.from('#!/bin/sh\nnew-command\n')],
    ])
    const hash = canonicalContentHash(bundle)
    const sig = signEnvelope(hash, authorKey)
    // entry.hash tracks the prior on-disk version (old run.sh), so the store's
    // updated run.sh reads as an author UPDATE (approval-gated), not an edit.
    const baselineHash = canonicalContentHash(
      new Map<string, Uint8Array>([
        ['SKILL.md', Buffer.from('---\nname: test\n---\n\nHello.\n')],
        ['scripts/run.sh', Buffer.from('#!/bin/sh\nold-command\n')],
      ]),
    )

    const skilletDir = process.env['SKILLET_DIR'] as string
    await seedMultiFileBundle(slug, bundle, skilletDir)
    await writeRegistryState(slug, 1, baselineHash, authorKey, pub, sig, skilletDir)
    await pinAuthorKey('alice', { key_id: authorKey.keyId, pub, first_seen_version: 1 }, pinDir)

    // Pre-materialize SKILL.md + old scripts/run.sh.
    const skillOnDisk = join(CLAUDE_DIR, 'alice', 'test-skill')
    await mkdir(join(skillOnDisk, 'scripts'), { recursive: true })
    await writeFile(join(skillOnDisk, 'SKILL.md'), '---\nname: test\n---\n\nHello.\n', 'utf8')
    await writeFile(join(skillOnDisk, 'scripts', 'run.sh'), '#!/bin/sh\nold-command\n', 'utf8')

    const adapters = [
      makeStubAdapter({ name: 'claude-code', detected: true, targetDir: CLAUDE_DIR }),
    ]

    const out = new CaptureWritable()
    await expect(
      sync(cwd, adapters, {
        output: out,
        input: Readable.from([]),
        approvalLockPath: join(TEST_ROOT, 'approval.lock'),
        configDir: join(TEST_ROOT, '.config'),
        pinDir,
      }),
    ).rejects.toThrow('requires approval')

    expect(out.data).toContain('scripts/run.sh')
    expect(out.data).toContain('-old-command')
    expect(out.data).toContain('+new-command')
  })
})

// ── prune persistence: a pruned skill must not resurrect from a stale state.json ──
//
// reconcilePrune removes a skill from the IN-MEMORY state, but for a long time
// only the lockfile was written at the end of sync(). Because upsertSkill (and
// forkEditedSkill) read-modify-write state.json one entry at a time, the on-disk
// state still listed the pruned skill — so the next sync's readState() brought it
// back. This drives the full sync() path with a session bearer + a mocked union
// manifest that EXCLUDES the skill, and asserts the removal is persisted.
describe('sync() — prune is persisted to state.json (no resurrection)', () => {
  let cwd: string

  beforeEach(async () => {
    delete process.env['SKILLET_TOKEN']
    await rm(TEST_ROOT, { recursive: true, force: true })
    cwd = join(TEST_ROOT, 'project')
    await mkdir(cwd, { recursive: true })
  })

  afterEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true })
  })

  it('writes the pruned removal to state.json so a reload does not bring it back', async () => {
    const skilletDir = process.env['SKILLET_DIR'] as string

    // Skill that LEFT the manifest → must be pruned. Registry + kit + canonical
    // @owner/slug key (the only shape reconcilePrune will touch). A clean,
    // verbatim adapter copy lets the pruner trash it and drop its state entry.
    const dropContent = '---\nname: drop\n---\n\nLeaving the kit.\n'
    const dropBundle = new Map<string, Uint8Array>([['SKILL.md', Buffer.from(dropContent, 'utf8')]])
    const dropHash = canonicalContentHash(dropBundle)
    await mkdir(join(skilletDir, 'skills', '@alice', 'drop'), { recursive: true })
    await writeFile(join(skilletDir, 'skills', '@alice', 'drop', 'SKILL.md'), dropContent, 'utf8')
    await mkdir(join(CLAUDE_DIR, 'drop'), { recursive: true })
    await writeFile(join(CLAUDE_DIR, 'drop', 'SKILL.md'), dropContent, 'utf8')

    // A surviving local kit skill whose store bytes differ from its recorded hash.
    // This forces the materialize loop to call upsertSkill — the read-modify-write
    // that, pre-fix, re-read the stale on-disk state and resurrected the pruned
    // skill. With the fix, the deletion is already on disk before this runs.
    const keepContent = '---\nname: keeper\n---\n\nStays, and triggers a state write.\n'
    await mkdir(join(skilletDir, 'skills', 'keeper'), { recursive: true })
    await writeFile(join(skilletDir, 'skills', 'keeper', 'SKILL.md'), keepContent, 'utf8')

    const now = new Date().toISOString()
    const seeded = {
      version: 1,
      skills: {
        '@alice/drop': {
          slug: '@alice/drop',
          owner: 'alice',
          name: 'drop',
          description: '',
          version: 1,
          hash: dropHash,
          source: 'registry' as const,
          sourceKit: '@alice/kit',
          importedAt: now,
          updatedAt: now,
        },
        keeper: {
          slug: 'keeper',
          name: 'keeper',
          description: '',
          version: 1,
          hash: 'sha256:stale', // ≠ on-disk bytes → upsertSkill fires for this entry
          source: 'local' as const,
          sourceKit: '@alice/kit',
          importedAt: now,
          updatedAt: now,
        },
      },
    }
    await atomicWrite(join(skilletDir, 'state.json'), JSON.stringify(seeded), { backup: false })

    // Account-bound (session) caller. The union manifest is EMPTY with
    // account_scope 'user' → zero-out allowed → @alice/drop is pruned. Per-skill
    // calls degrade (503): the entry is left intact for the pruner.
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = String(input)
      if (url.includes('/sync/manifest')) {
        return new Response(
          JSON.stringify({
            schema_version: 1,
            etag: 'sha256:' + '0'.repeat(64),
            sync_interval_seconds: null,
            account_scope: 'user',
            items: [],
          }),
          { status: 200, headers: { etag: '"x"', 'content-type': 'application/json' } },
        )
      }
      return new Response(JSON.stringify({ error: 'offline' }), { status: 503 })
    }) as unknown as typeof fetch

    const adapters = [
      makeStubAdapter({ name: 'claude-code', detected: true, targetDir: CLAUDE_DIR }),
    ]

    const result = await sync(cwd, adapters, { token: 'skillet_s_test', fetchImpl })

    // A real prune happened this run.
    expect(result.pruned.map((p) => p.slug)).toContain('@alice/drop')

    // The removal is PERSISTED: re-reading state.json (exactly what the next
    // sync's readState does) no longer references the pruned skill, while the
    // surviving skill remains.
    const persisted = JSON.parse(await readFile(join(skilletDir, 'state.json'), 'utf8')) as {
      skills: Record<string, unknown>
    }
    expect(persisted.skills['@alice/drop']).toBeUndefined()
    expect(persisted.skills['keeper']).toBeDefined()
  })
})

describe('sync() — post-sync edited-set report wiring (clear-by-absence)', () => {
  let cwd: string

  beforeEach(async () => {
    delete process.env['SKILLET_TOKEN']
    await rm(TEST_ROOT, { recursive: true, force: true })
    cwd = join(TEST_ROOT, 'project')
    await mkdir(cwd, { recursive: true })
  })

  afterEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true })
  })

  it('fires the /materializations report with an explicit empty edited set when the last edited skill un-customized and nothing materialized', async () => {
    const skilletDir = process.env['SKILLET_DIR'] as string
    // A linked device (device.json carries the id the report is keyed on).
    await saveDeviceToken('skillet_d_wire', { device_id: 'dev-wire', label: 'laptop' })
    // Last sync reported edits; this run has NO customized skills (the skill was
    // un-customized via take-theirs/restore before this sync) and materializes
    // nothing — the transition-to-empty the guard used to skip.
    await atomicWrite(
      join(skilletDir, 'state.json'),
      JSON.stringify({ version: 1, edited_reported: true, skills: {} }),
      { backup: false },
    )

    const calls: Array<{ url: string; method: string; body: unknown }> = []
    const fetchImpl = vi.fn(async (input: string | URL, init: RequestInit = {}) => {
      const url = String(input)
      calls.push({
        url,
        method: String(init.method ?? 'GET'),
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      })
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch

    // skipPull keeps the run to the post-sync reports; no adapters → nothing
    // materializes, so the ONLY reason a materializations report fires is the
    // transition-to-empty clearing case.
    await sync(cwd, [], { skipPull: true, fetchImpl })
    // The report is best-effort (fire-and-forget); let its promise settle.
    // vi.waitFor defaults to a 1s budget, which testTimeout does NOT raise, so
    // these two waits need their own: on a loaded machine (the pre-commit hook
    // runs every package's suite at once) a fire-and-forget round-trip does not
    // reliably land inside a second, and the suite goes red for timing alone.
    await vi.waitFor(
      () =>
        expect(calls.some((c) => c.url.includes('/materializations') && c.method === 'PUT')).toBe(
          true,
        ),
      { timeout: 10_000 },
    )

    const report = calls.find((c) => c.url.includes('/materializations') && c.method === 'PUT')
    expect(report).toBeDefined()
    const body = report!.body as { materializations: unknown[]; edited: unknown[] }
    expect(body.materializations).toEqual([])
    expect(body).toHaveProperty('edited')
    expect(body.edited).toEqual([]) // present + empty → registry reconciles-to-empty

    // Marker cleared in state.json once the empty set reached the registry.
    await vi.waitFor(
      async () => {
        const persisted = JSON.parse(await readFile(join(skilletDir, 'state.json'), 'utf8')) as {
          edited_reported?: boolean
        }
        expect(persisted.edited_reported).toBeUndefined()
      },
      { timeout: 10_000 },
    )
  })

  it('does NOT fire a materializations report on an idle sync that never reported edits', async () => {
    const skilletDir = process.env['SKILLET_DIR'] as string
    await saveDeviceToken('skillet_d_wire', { device_id: 'dev-wire', label: 'laptop' })
    await atomicWrite(
      join(skilletDir, 'state.json'),
      JSON.stringify({ version: 1, skills: {} }),
      { backup: false },
    )

    const calls: Array<{ url: string; method: string }> = []
    const fetchImpl = vi.fn(async (input: string | URL, init: RequestInit = {}) => {
      calls.push({ url: String(input), method: String(init.method ?? 'GET') })
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch

    await sync(cwd, [], { skipPull: true, fetchImpl })
    // Give any fire-and-forget report a chance to run before asserting absence.
    await new Promise((resolve) => setTimeout(resolve, 150))

    expect(calls.some((c) => c.url.includes('/materializations') && c.method === 'PUT')).toBe(false)
  })
})

describe('requiresApproval — session-attested self-trust', () => {
  const OWN_KEY = 'a'.repeat(64)
  const OTHER_KEY = 'b'.repeat(64)
  const sessionSig = { alg: 'session' as const, key_id: 'c'.repeat(64), sig: 'sig' }
  const emptyPolicy = { version: 1, global: {}, skills: {}, authors: {}, kits: {} }

  function entryWith(authorKeyId: string | null) {
    return {
      slug: '@taylor/web-edited',
      name: 'web-edited',
      description: '',
      version: 2,
      hash: 'sha256:' + 'd'.repeat(64),
      source: 'registry',
      authorKeyId,
      signature: sessionSig,
    } as Parameters<typeof requiresApproval>[0]
  }

  it('auto-applies a session-attested version of your OWN skill (web edit)', () => {
    expect(requiresApproval(entryWith(OWN_KEY), emptyPolicy as never, OWN_KEY)).toBe(false)
  })

  it('still gates session-attested versions from OTHER authors', () => {
    expect(requiresApproval(entryWith(OTHER_KEY), emptyPolicy as never, OWN_KEY)).toBe(true)
  })

  it('still gates when no local signing key exists (nothing resolves as self)', () => {
    expect(requiresApproval(entryWith(OWN_KEY), emptyPolicy as never, null)).toBe(true)
  })

  it('still gates when the entry has no author key to compare', () => {
    expect(requiresApproval(entryWith(null), emptyPolicy as never, OWN_KEY)).toBe(true)
  })

  it('auto-applies by account handle when no local key exists (web-first accounts)', () => {
    expect(
      requiresApproval(entryWith(OTHER_KEY), emptyPolicy as never, null, undefined, 'taylor'),
    ).toBe(false)
  })

  it('handle-self works even when the entry has no author key at all', () => {
    expect(
      requiresApproval(entryWith(null), emptyPolicy as never, null, undefined, 'taylor'),
    ).toBe(false)
  })

  it('gates when the account handle differs from the skill author', () => {
    expect(
      requiresApproval(entryWith(OTHER_KEY), emptyPolicy as never, null, undefined, 'someone-else'),
    ).toBe(true)
  })
})

describe('mergeAvailabilityRuntimes', () => {
  it('appends detected baseline-reader runtimes (opencode) to the active set', () => {
    expect(mergeAvailabilityRuntimes(['codex', 'claude-code'], ['opencode'])).toEqual([
      'codex',
      'claude-code',
      'opencode',
    ])
  })

  it('dedupes when a reader name already appears in the active set', () => {
    expect(mergeAvailabilityRuntimes(['codex', 'opencode'], ['opencode'])).toEqual([
      'codex',
      'opencode',
    ])
  })

  it('no readers detected → active set unchanged', () => {
    expect(mergeAvailabilityRuntimes(['codex'], [])).toEqual(['codex'])
    expect(mergeAvailabilityRuntimes(['codex'], undefined)).toEqual(['codex'])
  })
})
