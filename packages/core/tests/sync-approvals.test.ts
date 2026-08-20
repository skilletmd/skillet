/**
 * U7 — account-scoped decisions drive the sync gate, safety stays intact.
 *
 * Proves end-to-end through sync():
 *   - account update_mode='auto' flips an external skill to auto-apply (no prompt)
 *   - a server `approved` decision short-circuits the external gate
 *   - a server `rejected` decision skips (no materialize, no throw)
 *   - SECURITY: account auto-mode does NOT bypass the integrity gate — a tampered
 *     update is still hard-blocked (AE4 / KTD5).
 *
 * A routing fetchImpl serves /me/decisions and /approvals; every other endpoint
 * (union manifest, device registration) returns non-2xx so the pull no-ops and
 * never prunes. Mirrors the isolation + seed helpers in policy-sync.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'

const TEST_ROOT = vi.hoisted(() => {
  const { redirectHome } = require('./helpers/redirect-home.cjs')
  return redirectHome('skillet-sync-approvals')
})

import { sync } from '../src/commands/sync.js'
import type { Adapter } from '../src/adapter.js'
import { atomicWrite } from '../src/util/atomic.js'
import { canonicalContentHash } from '@skillet/protocol'
import { generateAuthorKey } from '../src/signing/index.js'
import { signEnvelope } from '../src/signing/envelope.js'
import { pinAuthorKey } from '../src/signing/pin.js'

const CLAUDE_DIR = join(TEST_ROOT, '.claude', 'skills')
const SLUG = 'alice/test-skill'
const SKILL_ID = 'alice:test-skill'
const CONTENT = '---\nname: test\n---\n\nHello approvals.\n'
const HASH = canonicalContentHash(new Map([['SKILL.md', Buffer.from(CONTENT)]]))

function makeStubAdapter(targetDir: string): Adapter {
  return {
    name: 'claude-code',
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
  }
}

function pubFromKey(k: ReturnType<typeof generateAuthorKey>): string {
  const jwk = k.publicKey.export({ format: 'jwk' }) as { x: string }
  return Buffer.from(jwk.x, 'base64url').toString('base64')
}

let pinDir: string
let cwd: string

async function seed(opts: { signOverHash?: string } = {}): Promise<void> {
  const authorKey = generateAuthorKey()
  const pub = pubFromKey(authorKey)
  const skilletDir = process.env['SKILLET_DIR'] as string
  const skillsDir = join(skilletDir, 'skills', SLUG)
  await mkdir(skillsDir, { recursive: true })
  await writeFile(join(skillsDir, 'SKILL.md'), CONTENT, 'utf8')

  const sig = signEnvelope(opts.signOverHash ?? HASH, authorKey)
  const now = new Date().toISOString()
  const state = {
    version: 1,
    skills: {
      [SLUG]: {
        slug: SLUG,
        name: 'test-skill',
        description: '',
        version: 1,
        hash: HASH,
        source: 'registry' as const,
        sourceClass: 'external',
        sourceKit: '@test/sync-kit',
        owner: 'alice',
        authorKeyId: authorKey.keyId,
        authorPubBase64: pub,
        signature: sig,
        importedAt: now,
        updatedAt: now,
      },
    },
  }
  await atomicWrite(join(skilletDir, 'state.json'), JSON.stringify(state), { backup: false })
  await pinAuthorKey('alice', { key_id: authorKey.keyId, pub, first_seen_version: 1 }, pinDir)
}

/** Routes /me/decisions + /approvals; everything else 401 so the union pull
 *  no-ops (no prune) and device registration is a best-effort miss. */
function routingFetch(decisions: {
  update_mode: 'auto' | 'manual'
  decisions: Array<{
    skill_id: string
    version_hash: string
    state: string
    source: string
    decided_at: number
  }>
}): typeof fetch {
  return (async (url: string | URL) => {
    const u = String(url)
    if (u.includes('/me/decisions')) {
      return new Response(JSON.stringify(decisions), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (u.includes('/approvals')) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
  }) as unknown as typeof fetch
}

class CaptureWritable extends Writable {
  data = ''
  isTTY = false
  override _write(chunk: Buffer, _enc: string, cb: () => void) {
    this.data += chunk.toString('utf8')
    cb()
  }
}

function syncOpts(out: Writable, decisions: Parameters<typeof routingFetch>[0]) {
  return {
    output: out,
    input: Readable.from([]),
    approvalLockPath: join(TEST_ROOT, 'approval.lock'),
    configDir: join(TEST_ROOT, '.config'),
    pinDir,
    token: 'sk_test_token',
    fetchImpl: routingFetch(decisions),
  }
}

describe('U7 — account decisions drive the sync gate', () => {
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

  it('account auto-mode auto-applies an external update (no prompt)', async () => {
    await seed()
    const out = new CaptureWritable()
    const result = await sync(
      cwd,
      [makeStubAdapter(CLAUDE_DIR)],
      syncOpts(out, {
        update_mode: 'auto',
        decisions: [],
      }),
    )
    expect(result.failed).toEqual([])
    expect(result.materialized).toHaveLength(1)
    expect(out.data).not.toContain('requires approval')
    expect(await readFile(join(CLAUDE_DIR, SLUG, 'SKILL.md'), 'utf8')).toBe(CONTENT)
  })

  it('a server approval short-circuits the external gate (manual mode)', async () => {
    await seed()
    const out = new CaptureWritable()
    const result = await sync(
      cwd,
      [makeStubAdapter(CLAUDE_DIR)],
      syncOpts(out, {
        update_mode: 'manual',
        decisions: [
          {
            skill_id: SKILL_ID,
            version_hash: HASH,
            state: 'approved',
            source: 'web',
            decided_at: 1,
          },
        ],
      }),
    )
    expect(result.failed).toEqual([])
    expect(result.materialized).toHaveLength(1)
    expect(out.data).not.toContain('requires approval')
  })

  it('a server rejection skips without materializing or throwing', async () => {
    await seed()
    const out = new CaptureWritable()
    const result = await sync(
      cwd,
      [makeStubAdapter(CLAUDE_DIR)],
      syncOpts(out, {
        update_mode: 'manual',
        decisions: [
          {
            skill_id: SKILL_ID,
            version_hash: HASH,
            state: 'rejected',
            source: 'web',
            decided_at: 1,
          },
        ],
      }),
    )
    expect(result.materialized).toHaveLength(0)
    expect(out.data.toLowerCase()).toContain('rejected')
  })

  it('interactive manual-mode holds an unapproved update: no prompt, no diff wall, summarized in pendingReview', async () => {
    await seed()
    // A previous version on disk makes this an update, not a first install.
    await mkdir(join(CLAUDE_DIR, SLUG), { recursive: true })
    await writeFile(join(CLAUDE_DIR, SLUG, 'SKILL.md'), 'old content\n', 'utf8')
    const out = new CaptureWritable()
    out.isTTY = true
    const result = await sync(
      cwd,
      [makeStubAdapter(CLAUDE_DIR)],
      syncOpts(out, { update_mode: 'manual', decisions: [] }),
    )
    expect(result.pendingReview).toEqual([{ slug: SLUG, range: 'v1' }])
    expect(result.materialized).toHaveLength(0)
    // The old version is untouched and the terminal saw neither prompt nor diff.
    expect(await readFile(join(CLAUDE_DIR, SLUG, 'SKILL.md'), 'utf8')).toBe('old content\n')
    expect(out.data).not.toContain('Approve this skill update?')
    expect(out.data).not.toContain('+++')
  })

  it('interactive manual-mode holds a NEW skill too — nothing installs or prompts mid-sync', async () => {
    await seed()
    const out = new CaptureWritable()
    out.isTTY = true
    const result = await sync(
      cwd,
      [makeStubAdapter(CLAUDE_DIR)],
      syncOpts(out, { update_mode: 'manual', decisions: [] }),
    )
    expect(result.pendingReview).toEqual([{ slug: SLUG, range: 'new' }])
    expect(result.materialized).toHaveLength(0)
    expect(out.data).not.toContain('Install this skill?')
    await expect(readFile(join(CLAUDE_DIR, SLUG, 'SKILL.md'))).rejects.toThrow()
  })

  it('headless manual-mode still hard-fails on an unapproved update (unchanged contract)', async () => {
    await seed()
    await mkdir(join(CLAUDE_DIR, SLUG), { recursive: true })
    await writeFile(join(CLAUDE_DIR, SLUG, 'SKILL.md'), 'old content\n', 'utf8')
    const out = new CaptureWritable() // isTTY=false
    await expect(
      sync(cwd, [makeStubAdapter(CLAUDE_DIR)], syncOpts(out, { update_mode: 'manual', decisions: [] })),
    ).rejects.toThrow(/requires approval/)
  })

  it('SECURITY: account auto-mode still hard-blocks a tampered update (AE4)', async () => {
    await seed({ signOverHash: 'sha256:' + '0'.repeat(64) })
    const out = new CaptureWritable()
    const result = await sync(
      cwd,
      [makeStubAdapter(CLAUDE_DIR)],
      syncOpts(out, {
        update_mode: 'auto',
        decisions: [],
      }),
    )
    expect(result.materialized).toHaveLength(0)
    expect(result.failed).toHaveLength(1)
    await expect(readFile(join(CLAUDE_DIR, SLUG, 'SKILL.md'))).rejects.toThrow()
  })
})
