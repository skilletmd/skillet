/**
 * U3 — context-scoped unlock markers for TCC-parked roots.
 *
 * U2 parks a protected-resolving root unconditionally. U3 lets a
 * USER-INITIATED run read it (the consent moment: macOS prompts once) and
 * records a per-root marker scoped to the granting context (desktop tray vs
 * terminal CLI). Background runs re-admit the root only under an ACTIVE
 * same-context marker; unattended runs (no TTY, no explicit signal — hooks,
 * MCP) never read a parked root and never write markers. A permission failure
 * under a marked root suspends the marker and re-parks the root with no
 * per-skill failure spam.
 *
 * Isolation: HOME and SKILLET_DIR are overridden via vi.hoisted before
 * @skillet/core loads (same harness as sync-parked.test.ts). No security
 * checks are mocked — the parked root is an allowlisted dir SYMLINKED into a
 * decoy Documents under the hermetic HOME, and denial is a chmod-000 dir.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { installOfflineRegistry } from './helpers/offline-registry.js'
import { chmod, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { symlinksAvailable } from './symlink-support.js'

const TEST_ROOT = vi.hoisted(() => {
  const { redirectHome } = require('./helpers/redirect-home.cjs')
  return redirectHome('skillet-tcc-unlock')
})

import { sync } from '../src/commands/sync.js'
import {
  assessTccRoot,
  isTccParkedPath,
  recordTccGrant,
  resetTccInvocation,
  setTccInvocation,
  tccGrantKey,
} from '../src/util/tcc-access.js'
import type { Adapter, MaterializeOptions, TargetPathOptions } from '../src/adapter.js'
import { atomicWrite } from '../src/util/atomic.js'
import { canonicalContentHash } from '@skillet/protocol'

const CLAUDE_DIR = join(TEST_ROOT, '.claude', 'skills')
const CODEX_DIR = join(TEST_ROOT, '.agents', 'skills')
const DECOY_DIR = join(TEST_ROOT, 'Documents', 'claude-skills')
const GRANTS_PATH = join(TEST_ROOT, '.skillet', 'tcc-access.json')

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

/** Seed/refresh a kit-synced skill, preserving prior state fields. */
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

interface GrantRow {
  root: string
  context: string
  suspended_at?: string
}

async function readGrants(): Promise<GrantRow[]> {
  try {
    const parsed = JSON.parse(await readFile(GRANTS_PATH, 'utf8')) as {
      grants?: GrantRow[]
    }
    return parsed.grants ?? []
  } catch {
    return []
  }
}

/** Build the parked-root fixture: CLAUDE_DIR symlinks into a decoy Documents. */
async function buildParkedClaudeRoot(): Promise<void> {
  await mkdir(DECOY_DIR, { recursive: true })
  await mkdir(join(TEST_ROOT, '.claude'), { recursive: true })
  await symlink(DECOY_DIR, CLAUDE_DIR)
}

function adaptersUnderTest(): Adapter[] {
  return [
    makeStubAdapter({ name: 'claude-code', targetDir: CLAUDE_DIR }),
    makeStubAdapter({ name: 'codex', targetDir: CODEX_DIR }),
  ]
}

installOfflineRegistry()

// The parked-root fixture is built out of symlinks; see symlink-support.
describe.skipIf(!symlinksAvailable)('TCC unlock markers (U3)', () => {
  let cwd: string

  beforeEach(async () => {
    delete process.env['SKILLET_TOKEN']
    delete process.env['SKILLET_TCC_CONTEXT']
    // The policy is macOS-only; force it on so the decoy Documents parks anywhere.
    process.env['SKILLET_TCC_POLICY'] = 'force'
    resetTccInvocation()
    await rm(TEST_ROOT, { recursive: true, force: true })
    cwd = join(TEST_ROOT, 'project')
    await mkdir(cwd, { recursive: true })
  })

  afterEach(async () => {
    delete process.env['SKILLET_TCC_POLICY']
    resetTccInvocation()
    // Restore a chmod-000 decoy so rm can clean it up.
    await chmod(DECOY_DIR, 0o755).catch(() => {})
    await rm(TEST_ROOT, { recursive: true, force: true })
  })

  it('background parks an unmarked root and writes no marker; a user-initiated sync reads it and records the granting context', async () => {
    await buildParkedClaudeRoot()
    const content = '---\nname: demo\n---\n\nversion one\n'
    const contentHash = await seedKitMerge('demo', content)

    // Background (SSE-style) sync: root parked, nothing read or written there,
    // and no marker appears.
    setTccInvocation({ initiation: 'background', context: 'desktop' })
    const bg = await sync(cwd, adaptersUnderTest())
    expect(bg.failed).toEqual([])
    const bgClaude = bg.adapters.find((a) => a.name === 'claude-code')!
    expect(bgClaude.parked).toBe(true)
    expect(bgClaude.parkedDenied).toBeUndefined()
    await expect(readFile(join(DECOY_DIR, 'demo', 'SKILL.md'), 'utf8')).rejects.toThrow()
    expect(await readGrants()).toEqual([])
    // The readable runtime is unaffected.
    expect(await readFile(join(CODEX_DIR, 'demo', 'SKILL.md'), 'utf8')).toBe(content)

    // User-initiated sync (the tray's Sync button): reads the root,
    // materializes into it, and records a desktop-context marker.
    setTccInvocation({ initiation: 'user', context: 'desktop' })
    const user = await sync(cwd, adaptersUnderTest())
    expect(user.failed).toEqual([])
    const userClaude = user.adapters.find((a) => a.name === 'claude-code')!
    expect(userClaude.parked).toBeUndefined()
    expect(await readFile(join(DECOY_DIR, 'demo', 'SKILL.md'), 'utf8')).toBe(content)
    const grants = await readGrants()
    expect(grants).toHaveLength(1)
    expect(grants[0]!.context).toBe('desktop')
    // Marker keys by the protected ANCHOR the root resolves under — macOS
    // scopes the grant to the whole folder, so the stored root is Documents
    // itself, and the symlinked alias resolves to the same anchor.
    expect(grants[0]!.root).toBe(tccGrantKey(join(TEST_ROOT, 'Documents')))
    expect(tccGrantKey(CLAUDE_DIR)).toBe(tccGrantKey(DECOY_DIR))

    // materialized_hash converged (every global adapter took the bytes).
    const state = JSON.parse(
      await readFile(join(TEST_ROOT, '.skillet', 'state.json'), 'utf8'),
    ) as { skills: Record<string, { materialized_hash?: string }> }
    expect(state.skills['demo']!.materialized_hash).toBe(contentHash)
  })

  it('a same-context marker admits the root at the next background sync', async () => {
    await buildParkedClaudeRoot()
    await seedKitMerge('demo', '---\nname: demo\n---\n\nversion one\n')

    setTccInvocation({ initiation: 'user', context: 'desktop' })
    await sync(cwd, adaptersUnderTest())

    // An update arrives; a background sync in the SAME context applies it.
    const v2 = '---\nname: demo\n---\n\nversion two\n'
    await seedKitMerge('demo', v2)
    setTccInvocation({ initiation: 'background', context: 'desktop' })
    const bg = await sync(cwd, adaptersUnderTest())
    expect(bg.failed).toEqual([])
    expect(bg.adapters.find((a) => a.name === 'claude-code')!.parked).toBeUndefined()
    expect(await readFile(join(DECOY_DIR, 'demo', 'SKILL.md'), 'utf8')).toBe(v2)
  })

  it('a cli-context marker leaves the root parked for a desktop background sync', async () => {
    await buildParkedClaudeRoot()
    await seedKitMerge('demo', '---\nname: demo\n---\n\nterminal grant\n')

    // Grant earned in a terminal (cli context).
    setTccInvocation({ initiation: 'user', context: 'cli' })
    await sync(cwd, adaptersUnderTest())
    expect((await readGrants())[0]!.context).toBe('cli')

    // The tray's background sync runs under a different TCC identity: parked.
    const v2 = '---\nname: demo\n---\n\nafter cli grant\n'
    await seedKitMerge('demo', v2)
    setTccInvocation({ initiation: 'background', context: 'desktop' })
    const bg = await sync(cwd, adaptersUnderTest())
    expect(bg.failed).toEqual([])
    expect(bg.adapters.find((a) => a.name === 'claude-code')!.parked).toBe(true)
    expect(await readFile(join(DECOY_DIR, 'demo', 'SKILL.md'), 'utf8')).toBe(
      '---\nname: demo\n---\n\nterminal grant\n',
    )

    // Same context (cli) background sync IS admitted.
    setTccInvocation({ initiation: 'background', context: 'cli' })
    const cliBg = await sync(cwd, adaptersUnderTest())
    expect(cliBg.adapters.find((a) => a.name === 'claude-code')!.parked).toBeUndefined()
    expect(await readFile(join(DECOY_DIR, 'demo', 'SKILL.md'), 'utf8')).toBe(v2)
  })

  it('an unattended (hook-style) invocation neither reads a marked root nor touches the marker', async () => {
    await buildParkedClaudeRoot()
    await seedKitMerge('demo', '---\nname: demo\n---\n\nversion one\n')

    setTccInvocation({ initiation: 'user', context: 'desktop' })
    await sync(cwd, adaptersUnderTest())
    const grantsBefore = await readGrants()
    expect(grantsBefore).toHaveLength(1)

    // No TTY, no explicit signal (vitest streams are pipes): unattended.
    resetTccInvocation()
    const v2 = '---\nname: demo\n---\n\nhook must not apply this\n'
    await seedKitMerge('demo', v2)
    const hook = await sync(cwd, adaptersUnderTest())
    expect(hook.failed).toEqual([])
    expect(hook.adapters.find((a) => a.name === 'claude-code')!.parked).toBe(true)
    // Root not read or written even though an ACTIVE marker exists.
    expect(await readFile(join(DECOY_DIR, 'demo', 'SKILL.md'), 'utf8')).toBe(
      '---\nname: demo\n---\n\nversion one\n',
    )
    // Marker store untouched: still the one active desktop grant.
    expect(await readGrants()).toEqual(grantsBefore)
  })

  it('a permission failure under a marked root suspends the marker and re-parks with no per-skill failures', async () => {
    await buildParkedClaudeRoot()
    await seedKitMerge('demo', '---\nname: demo\n---\n\nversion one\n')

    setTccInvocation({ initiation: 'user', context: 'desktop' })
    await sync(cwd, adaptersUnderTest())
    expect((await readGrants())[0]!.suspended_at).toBeUndefined()

    // The grant is revoked: reads now fail with a permission error.
    await chmod(DECOY_DIR, 0o000)
    const v2 = '---\nname: demo\n---\n\nrevoked\n'
    await seedKitMerge('demo', v2)
    setTccInvocation({ initiation: 'background', context: 'desktop' })
    const denied = await sync(cwd, adaptersUnderTest())
    // Re-parked before per-skill work: no edit_unreadable spam, no failures.
    expect(denied.failed).toEqual([])
    const claude = denied.adapters.find((a) => a.name === 'claude-code')!
    expect(claude.parked).toBe(true)
    expect(claude.parkedDenied).toBe(true)
    expect(claude.status).toBe('materialized')
    const suspended = await readGrants()
    expect(suspended).toHaveLength(1)
    expect(suspended[0]!.suspended_at).toBeTruthy()

    // A suspended marker does not re-admit the next background sync.
    const nextBg = await sync(cwd, adaptersUnderTest())
    expect(nextBg.adapters.find((a) => a.name === 'claude-code')!.parked).toBe(true)
    expect(nextBg.adapters.find((a) => a.name === 'claude-code')!.parkedDenied).toBe(true)

    // Access restored + a user-initiated sync: marker refreshed, root synced.
    await chmod(DECOY_DIR, 0o755)
    setTccInvocation({ initiation: 'user', context: 'desktop' })
    const healed = await sync(cwd, adaptersUnderTest())
    expect(healed.failed).toEqual([])
    expect(healed.adapters.find((a) => a.name === 'claude-code')!.parked).toBeUndefined()
    expect(await readFile(join(DECOY_DIR, 'demo', 'SKILL.md'), 'utf8')).toBe(v2)
    expect((await readGrants())[0]!.suspended_at).toBeUndefined()
  })

  it('gate matrix: markers admit only active same-context grants at background, and never unattended', async () => {
    await buildParkedClaudeRoot()

    // No marker: user reads, background/unattended park.
    setTccInvocation({ initiation: 'user', context: 'desktop' })
    expect(isTccParkedPath(CLAUDE_DIR)).toBe(false)
    setTccInvocation({ initiation: 'background', context: 'desktop' })
    expect(isTccParkedPath(CLAUDE_DIR)).toBe(true)
    resetTccInvocation() // unattended in a test runner
    expect(isTccParkedPath(CLAUDE_DIR)).toBe(true)

    recordTccGrant(CLAUDE_DIR, 'desktop')
    // Active same-context marker admits the root and everything below it.
    setTccInvocation({ initiation: 'background', context: 'desktop' })
    expect(isTccParkedPath(CLAUDE_DIR)).toBe(false)
    expect(isTccParkedPath(join(CLAUDE_DIR, 'demo'))).toBe(false)
    // The grant keys to the Documents ANCHOR (macOS scopes consent to the
    // whole folder), so a sibling under the same Documents IS covered.
    expect(isTccParkedPath(join(TEST_ROOT, 'Documents', 'other'))).toBe(false)
    // A different protected folder is NOT covered.
    expect(isTccParkedPath(join(TEST_ROOT, 'Desktop', 'other'))).toBe(true)
    // Cross-context: not admitted.
    setTccInvocation({ initiation: 'background', context: 'cli' })
    expect(isTccParkedPath(CLAUDE_DIR)).toBe(true)
    // Unattended: markers never re-admit.
    resetTccInvocation()
    expect(isTccParkedPath(CLAUDE_DIR)).toBe(true)
  })

  it('a grant earned on one root covers a SIBLING root resolving into the same protected folder', async () => {
    // macOS attributes TCC consent app-wide per protected folder: once the
    // user granted Documents for ~/.claude/skills, a ~/.cursor root that also
    // resolves into the same Documents needs no second prompt. The marker
    // keys to the anchor, so the sibling is admitted at background.
    await buildParkedClaudeRoot()
    const cursorDecoy = join(TEST_ROOT, 'Documents', 'cursor-skills')
    await mkdir(cursorDecoy, { recursive: true })
    const cursorRoot = join(TEST_ROOT, '.cursor')
    await symlink(cursorDecoy, cursorRoot)

    // Consent moment on the claude root only.
    setTccInvocation({ initiation: 'user', context: 'desktop' })
    expect(assessTccRoot(CLAUDE_DIR).parked).toBe(false)
    expect(await readGrants()).toHaveLength(1)

    // The sibling root under the same Documents is covered at background.
    setTccInvocation({ initiation: 'background', context: 'desktop' })
    expect(isTccParkedPath(cursorRoot)).toBe(false)
    expect(assessTccRoot(cursorRoot).parked).toBe(false)
    // Same folder, different context: still parked.
    setTccInvocation({ initiation: 'background', context: 'cli' })
    expect(isTccParkedPath(cursorRoot)).toBe(true)
  })

  it('a marker for a root that no longer resolves into a protected folder is ignored harmlessly', async () => {
    await buildParkedClaudeRoot()
    recordTccGrant(CLAUDE_DIR, 'desktop')

    // The root moves out of Documents: the symlink now points at a plain dir.
    await rm(CLAUDE_DIR, { force: true })
    await mkdir(join(TEST_ROOT, 'plain-skills'), { recursive: true })
    await symlink(join(TEST_ROOT, 'plain-skills'), CLAUDE_DIR)

    // Not protected → never parked, marker or not, in every classification.
    for (const initiation of ['user', 'background', 'unattended'] as const) {
      if (initiation === 'unattended') resetTccInvocation()
      else setTccInvocation({ initiation, context: 'desktop' })
      expect(isTccParkedPath(CLAUDE_DIR)).toBe(false)
      expect(assessTccRoot(CLAUDE_DIR)).toEqual({
        protected: false,
        parked: false,
        denied: false,
      })
    }

    // And a sync over it behaves like any unprotected root.
    resetTccInvocation()
    const content = '---\nname: demo\n---\n\nplain\n'
    await seedKitMerge('demo', content)
    const result = await sync(cwd, adaptersUnderTest())
    expect(result.failed).toEqual([])
    expect(result.adapters.find((a) => a.name === 'claude-code')!.parked).toBeUndefined()
    expect(
      await readFile(join(TEST_ROOT, 'plain-skills', 'demo', 'SKILL.md'), 'utf8'),
    ).toBe(content)
  })
})
