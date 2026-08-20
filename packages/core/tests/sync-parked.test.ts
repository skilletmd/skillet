/**
 * U2 — parked roots in a full sync run.
 *
 * A global adapter whose root RESOLVES into a macOS TCC-protected folder
 * (~/Documents, ~/Desktop, ~/Downloads) is "parked": it stays detected and
 * reported, but takes no content reads or writes. The parked adapter stays in
 * the expected-adapter accounting, so `materialized_hash` never advances past
 * it — a later sync that can read the root re-materializes and converges
 * instead of misreading stale bytes as a hand edit.
 *
 * Isolation: HOME and SKILLET_DIR are overridden via vi.hoisted before
 * @skillet/core loads (same harness as sync.test.ts). No security checks are
 * mocked — the parked root is an allowlisted dir SYMLINKED into a decoy
 * Documents under the hermetic HOME.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { vi } from 'vitest'
import { installOfflineRegistry } from './helpers/offline-registry.js'
import { cp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { symlinksAvailable } from './symlink-support.js'

const TEST_ROOT = vi.hoisted(() => {
  const { redirectHome } = require('./helpers/redirect-home.cjs')
  return redirectHome('skillet-sync-parked')
})

import { sync } from '../src/commands/sync.js'
import { deriveMaterializations } from '../src/commands/report-device-agents.js'
import type { Adapter, MaterializeOptions, TargetPathOptions } from '../src/adapter.js'
import { atomicWrite } from '../src/util/atomic.js'
import { canonicalContentHash } from '@skillet/protocol'
import { SIG_ALG_SESSION } from '../src/signing/session-attest.js'

const CLAUDE_DIR = join(TEST_ROOT, '.claude', 'skills')
const CODEX_DIR = join(TEST_ROOT, '.agents', 'skills')
const DECOY_DIR = join(TEST_ROOT, 'Documents', 'claude-skills')

function makeStubAdapter(opts: { name: string; targetDir: string }): Adapter {
  return {
    name: opts.name,
    targetDir: opts.targetDir,
    async detect() {
      return true
    },
    targetPath(slug: string, _pathOpts: TargetPathOptions = {}) {
      return join(opts.targetDir, slug, 'SKILL.md')
    },
    targetSkillDir(slug: string, _pathOpts: TargetPathOptions = {}) {
      return join(opts.targetDir, slug)
    },
    async materialize(slug, bundle, _matOpts: MaterializeOptions = {}) {
      const dir = join(opts.targetDir, slug)
      await mkdir(dir, { recursive: true })
      const written: string[] = []
      for (const [path, bytes] of bundle.entries()) {
        const dest = join(dir, path)
        await writeFile(dest, Buffer.from(bytes))
        written.push(dest)
      }
      return written
    },
  }
}

function hashOf(content: string): string {
  return canonicalContentHash(new Map([['SKILL.md', Buffer.from(content, 'utf8')]]))
}

/** Seed/refresh a kit-synced skill, PRESERVING any prior state fields
 *  (materialized_hash) so a content update mimics what a registry pull does. */
async function seedKitMerge(
  slug: string,
  content: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const skilletDir = process.env['SKILLET_DIR'] as string
  const skillsDir = join(skilletDir, 'skills', slug)
  await mkdir(skillsDir, { recursive: true })
  await writeFile(join(skillsDir, 'SKILL.md'), content, 'utf8')
  const hash = hashOf(content)
  const now = new Date().toISOString()
  const statePath = join(skilletDir, 'state.json')
  let skills: Record<string, Record<string, unknown>> = {}
  try {
    const existing = JSON.parse(await readFile(statePath, 'utf8')) as {
      skills?: Record<string, Record<string, unknown>>
    }
    skills = existing.skills ?? {}
  } catch {
    // fresh state
  }
  skills[slug] = {
    slug,
    name: slug,
    description: '',
    version: 1,
    source: 'local' as const,
    sourceKit: '@test/sync-kit',
    importedAt: now,
    ...(skills[slug] ?? {}),
    hash,
    updatedAt: now,
    ...extra,
  }
  await atomicWrite(statePath, JSON.stringify({ version: 1, skills }), { backup: false })
  return hash
}

async function readEntry(slug: string): Promise<Record<string, unknown>> {
  const skilletDir = process.env['SKILLET_DIR'] as string
  const state = JSON.parse(await readFile(join(skilletDir, 'state.json'), 'utf8')) as {
    skills: Record<string, Record<string, unknown>>
  }
  return state.skills[slug]!
}

function ttyOutput(): NodeJS.WritableStream {
  const out = new Writable({
    write(_chunk, _enc, cb) {
      cb()
    },
  }) as NodeJS.WritableStream & { isTTY: boolean }
  out.isTTY = true
  return out
}

installOfflineRegistry()

// The parked-root fixture is built out of symlinks; see symlink-support.
describe.skipIf(!symlinksAvailable)('sync() with a parked root (U2)', () => {
  let cwd: string

  beforeEach(async () => {
    delete process.env['SKILLET_TOKEN']
    // The policy is macOS-only; force it on so the decoy Documents parks anywhere.
    process.env['SKILLET_TCC_POLICY'] = 'force'
    await rm(TEST_ROOT, { recursive: true, force: true })
    cwd = join(TEST_ROOT, 'project')
    await mkdir(cwd, { recursive: true })
  })

  afterEach(async () => {
    delete process.env['SKILLET_TCC_POLICY']
    await rm(TEST_ROOT, { recursive: true, force: true })
  })

  it('update while parked: readable runtimes materialize, materialized_hash holds, later sync converges without a phantom hand edit', async () => {
    const v1 = '---\nname: demo\n---\n\nversion one\n'
    const v2 = '---\nname: demo\n---\n\nversion two\n'
    const adapters = [
      makeStubAdapter({ name: 'claude-code', targetDir: CLAUDE_DIR }),
      makeStubAdapter({ name: 'codex', targetDir: CODEX_DIR }),
    ]

    // Sync 1 — both roots readable; the skill lands everywhere.
    const v1Hash = await seedKitMerge('demo', v1)
    const first = await sync(cwd, adapters)
    expect(first.failed).toEqual([])
    expect((await readEntry('demo'))['materialized_hash']).toBe(v1Hash)
    expect(first.adapters.every((a) => a.parked !== true)).toBe(true)

    // Park the claude root: move it into a decoy Documents and symlink back.
    await mkdir(join(TEST_ROOT, 'Documents'), { recursive: true })
    await cp(CLAUDE_DIR, DECOY_DIR, { recursive: true })
    await rm(CLAUDE_DIR, { recursive: true, force: true })
    await symlink(DECOY_DIR, CLAUDE_DIR)

    // Sync 2 — an update arrived (store + entry.hash advanced).
    const v2Hash = await seedKitMerge('demo', v2)
    const second = await sync(cwd, adapters)

    // Locally ok, root marked parked — never failed.
    expect(second.failed).toEqual([])
    const claudeResult = second.adapters.find((a) => a.name === 'claude-code')!
    expect(claudeResult.parked).toBe(true)
    expect(claudeResult.status).toBe('materialized')
    expect(claudeResult.count).toBe(0)
    expect(claudeResult.warnings.length).toBeGreaterThan(0)

    // The readable runtime took the update; the parked one was not touched.
    expect(await readFile(join(CODEX_DIR, 'demo', 'SKILL.md'), 'utf8')).toBe(v2)
    expect(await readFile(join(DECOY_DIR, 'demo', 'SKILL.md'), 'utf8')).toBe(v1)

    // materialized_hash must NOT advance past the parked adapter.
    const afterSecond = await readEntry('demo')
    expect(afterSecond['hash']).toBe(v2Hash)
    expect(afterSecond['materialized_hash']).toBe(v1Hash)
    expect(second.customized).toEqual([])

    // Wire report keeps the deployed registries' status vocabulary.
    const wire = deriveMaterializations({
      materialized: second.materialized,
      adapters: second.adapters,
      failed: second.failed,
    })
    for (const row of wire) {
      expect(['materialized', 'skipped-not-detected', 'failed']).toContain(row.status)
    }
    // The parked runtime stays in the reported agent set (rows exist for it).
    expect(wire.some((r) => r.runtime === 'claude-code')).toBe(true)

    // Unpark: the root becomes readable again, still holding STALE v1 bytes.
    await rm(CLAUDE_DIR, { recursive: true, force: true })
    await cp(DECOY_DIR, CLAUDE_DIR, { recursive: true })

    // Sync 3 — re-materializes rather than classifying stale bytes as an edit.
    const third = await sync(cwd, adapters)
    expect(third.failed).toEqual([])
    expect(third.customized).toEqual([])
    expect(await readFile(join(CLAUDE_DIR, 'demo', 'SKILL.md'), 'utf8')).toBe(v2)
    const afterThird = await readEntry('demo')
    expect(afterThird['materialized_hash']).toBe(v2Hash)
  })

  it('graded update review with a parked root is not mislabeled first-install', async () => {
    // A session-attested registry skill needing approval, with the ONLY active
    // adapter parked: the walk sees nothing, but the contents are UNKNOWN, not
    // absent — so the held review must not grade as "new".
    await mkdir(join(TEST_ROOT, 'Documents', 'claude-skills'), { recursive: true })
    await mkdir(join(TEST_ROOT, '.claude'), { recursive: true })
    await symlink(join(TEST_ROOT, 'Documents', 'claude-skills'), CLAUDE_DIR)

    const content = '---\nname: gated\n---\n\nneeds review\n'
    await seedKitMerge('@alice/gated', content, {
      source: 'registry',
      owner: 'alice',
      signature: {
        alg: SIG_ALG_SESSION,
        key_id: 'session',
        sig: 'unused',
        signed_at: new Date().toISOString(),
      },
    })

    const adapters = [makeStubAdapter({ name: 'claude-code', targetDir: CLAUDE_DIR })]
    const result = await sync(cwd, adapters, { output: ttyOutput(), skipPull: true })

    expect(result.failed).toEqual([])
    expect(result.pendingReview.map((p) => p.slug)).toEqual(['@alice/gated'])
    // 'new' is the first-install grade; a parked root must never produce it.
    expect(result.pendingReview[0]!.range).not.toBe('new')
  })
})
