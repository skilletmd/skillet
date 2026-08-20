/**
 * U2 — the skill store itself parked: SKILLET_DIR resolves into a decoy
 * Documents under a hermetic HOME. Skill-content reads (store drift, bundle
 * bytes, pending diffs) must not run; launch-path commands report ok with no
 * failures instead of tripping the macOS consent prompt.
 *
 * Known boundary (deliberate): state.json itself lives in SKILLET_DIR and is
 * core app data — reading it is not gated here; parking the whole app dir is
 * U3's unlock-marker territory.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { installOfflineRegistry } from './helpers/offline-registry.js'
import fsSync from 'node:fs'
import fsPromises from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const TEST_ROOT = vi.hoisted(() => {
  const { join: joinPath } = require('node:path')
  const { redirectHome } = require('./helpers/redirect-home.cjs')
  const root = redirectHome('skillet-tcc-store')
  // The decoy: the whole Skillet dir sits inside ~/Documents.
  process.env.SKILLET_DIR = joinPath(root, 'Documents', 'skillet')
  return root
})

import { sync } from '../src/commands/sync.js'
import { listPending } from '../src/commands/pending.js'
import { detectStoreDrift } from '../src/commands/edits-store.js'
import { atomicWrite } from '../src/util/atomic.js'
import { canonicalContentHash } from '@skillet/protocol'
import type { Adapter } from '../src/adapter.js'

const CLAUDE_DIR = join(TEST_ROOT, '.claude', 'skills')

function makeStubAdapter(): Adapter {
  return {
    name: 'claude-code',
    targetDir: CLAUDE_DIR,
    async detect() {
      return true
    },
    targetPath(slug: string) {
      return join(CLAUDE_DIR, slug, 'SKILL.md')
    },
    targetSkillDir(slug: string) {
      return join(CLAUDE_DIR, slug)
    },
    async materialize(slug, bundle) {
      const dir = join(CLAUDE_DIR, slug)
      await mkdir(dir, { recursive: true })
      const written: string[] = []
      for (const [path, bytes] of bundle.entries()) {
        await writeFile(join(dir, path), Buffer.from(bytes))
        written.push(join(dir, path))
      }
      return written
    },
  }
}

async function seedParkedStoreSkill(slug: string, content: string): Promise<void> {
  const skilletDir = process.env['SKILLET_DIR'] as string
  const skillsDir = join(skilletDir, 'skills', slug)
  await mkdir(skillsDir, { recursive: true })
  await writeFile(join(skillsDir, 'SKILL.md'), content, 'utf8')
  const hash = canonicalContentHash(new Map([['SKILL.md', Buffer.from(content, 'utf8')]]))
  const now = new Date().toISOString()
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
        sourceKit: '@test/kit',
        importedAt: now,
        updatedAt: now,
      },
    },
  }
  await atomicWrite(join(skilletDir, 'state.json'), JSON.stringify(state), { backup: false })
}

installOfflineRegistry()

describe('parked skill store (SKILLET_DIR inside Documents)', () => {
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

  it('detectStoreDrift reports parked, not drift and not uncapturable', async () => {
    await seedParkedStoreSkill('demo', '# v1\n')
    const res = await detectStoreDrift('demo', 'sha256:some-other-baseline')
    expect(res.parked).toBe(true)
    expect(res.drifted).toBe(false)
    expect(res.uncapturable).toBe(false)
    expect(res.tree).toBeNull()
  })

  it('sync parks skill-content reads: ok locally, nothing failed, nothing materialized', async () => {
    await seedParkedStoreSkill('demo', '# v1\n')
    const result = await sync(cwd, [makeStubAdapter()])

    expect(result.failed).toEqual([])
    expect(result.materialized).toEqual([])
    expect(result.customized).toEqual([])
    expect(result.adapters[0]?.status).not.toBe('failed')
    expect(result.notices.some((n) => n.includes('parked'))).toBe(true)
    // Nothing was written into the runtime dir from the unreadable store.
    await expect(readFile(join(CLAUDE_DIR, 'demo', 'SKILL.md'))).rejects.toThrow()
  })

  it('listPending reports none rather than content-reading a parked store', async () => {
    await seedParkedStoreSkill('demo', '# v1\n')
    const result = await listPending([makeStubAdapter()])
    expect(result.pending).toEqual([])
  })

  it('a CONNECTED sync with manifest items skips both pull phases: no content read ever touches the parked store', async () => {
    // The pull phases content-read (and write) the store — store-hash
    // alignment, bundle writes — so a parked store must skip them OUTRIGHT,
    // before Phase 0a, not only the per-skill materialize loop. This run is
    // connected: the registry serves a manifest item matching local state,
    // which pre-fix drove skillStoreMatchesExpectedHash into the parked store.
    const slug = '@test/demo'
    const content = '# v1\n'
    const skilletDir = process.env['SKILLET_DIR'] as string
    const storeRoot = join(skilletDir, 'skills')
    const skillDir = join(storeRoot, slug)
    await mkdir(skillDir, { recursive: true })
    await writeFile(join(skillDir, 'SKILL.md'), content, 'utf8')
    const hash = canonicalContentHash(new Map([['SKILL.md', Buffer.from(content, 'utf8')]]))
    const now = new Date().toISOString()
    await atomicWrite(
      join(skilletDir, 'state.json'),
      JSON.stringify({
        version: 1,
        skills: {
          [slug]: {
            slug,
            owner: 'test',
            name: 'demo',
            description: '',
            version: 1,
            hash,
            source: 'registry',
            sourceKit: '@test/kit',
            importedAt: now,
            updatedAt: now,
          },
        },
      }),
      { backup: false },
    )

    const manifest = {
      etag: `sha256:${'0'.repeat(64)}`,
      sync_interval_seconds: null,
      account_scope: 'user',
      items: [
        {
          ref: slug,
          version: 1,
          content_hash: hash,
          signature: null,
          author_key_id: null,
          policy: 'manual',
          source_kit: '@test/kit',
          external_author: false,
        },
      ],
    }
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input)
      if (url.includes('/sync/manifest')) {
        return new Response(JSON.stringify(manifest), {
          status: 200,
          headers: { etag: manifest.etag },
        })
      }
      return new Response(JSON.stringify({ error: 'offline-test' }), { status: 503 })
    }) as typeof fetch

    // Record every fs CONTENT read (metadata probes are TCC-exempt) so the
    // assertion catches reads that succeed silently — on a real machine each
    // one is a macOS consent prompt. Same patch+syncBuiltinESMExports
    // technique as the cli tcc-probe-contract test.
    type AnyFn = (...args: unknown[]) => unknown
    const recorded: string[] = []
    const record = (p: unknown): void => {
      if (typeof p === 'string') recorded.push(p)
    }
    const SYNC_READS = ['readdirSync', 'readFileSync', 'openSync', 'opendirSync', 'createReadStream'] as const
    const PROMISE_READS = ['readdir', 'readFile', 'open', 'opendir'] as const
    const fsAny = fsSync as unknown as Record<string, AnyFn>
    const fspAny = fsPromises as unknown as Record<string, AnyFn>
    const restores: Array<() => void> = []
    for (const name of SYNC_READS) {
      const orig = fsAny[name] as AnyFn
      fsAny[name] = function (this: unknown, p: unknown, ...rest: unknown[]) {
        record(p)
        return orig.call(this, p, ...rest)
      }
      restores.push(() => {
        fsAny[name] = orig
      })
    }
    for (const name of PROMISE_READS) {
      const orig = fspAny[name] as AnyFn
      fspAny[name] = function (this: unknown, p: unknown, ...rest: unknown[]) {
        record(p)
        return orig.call(this, p, ...rest)
      }
      restores.push(() => {
        fspAny[name] = orig
      })
    }
    syncBuiltinESMExports()

    let result
    try {
      result = await sync(cwd, [makeStubAdapter()], {
        token: 'skillet_s_test-session',
        registryUrl: 'http://registry.invalid',
        fetchImpl,
      })
    } finally {
      for (const restore of restores) restore()
      syncBuiltinESMExports()
    }

    // The load-bearing invariant: nothing content-read the parked store.
    const storeReads = recorded.filter(
      (p) => p === storeRoot || p.startsWith(storeRoot + '/'),
    )
    expect(storeReads).toEqual([])
    // Parked store on a connected run: still ok, never failed, pulls skipped.
    expect(result.failed).toEqual([])
    expect(result.unionPull).toEqual([])
    expect(result.pull).toEqual([])
    expect(result.notices.some((n) => n.includes('parked'))).toBe(true)
  })
})
