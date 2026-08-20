/**
 * Tests for the GUI pending-updates surface.
 *
 * Covers AC 1–6:
 *   AC 1: listPending shape — slug, authorKeyId, approvedVersion, incomingVersion, diff
 *   AC 2: approveUpdate records in the approval lock; sync then materializes
 *   AC 2: rejectUpdate records in the approval lock; sync then skips
 *   AC 3: auto-trust OFF — approved version does not widen trust for other skills/authors
 *   AC 4: rejected version does not re-prompt on subsequent sync
 *   AC 5: adapter safety (atomic writes, path escape) unchanged — sync still applies them
 *   AC 6: regression — no blanket auto-approve path
 *
 * Isolation: HOME and SKILLET_DIR redirected via vi.hoisted before @skillet/core loads.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { installOfflineRegistry } from './helpers/offline-registry.js'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Writable } from 'node:stream'

// Hoisted: redirect HOME so the allowlist and kit state resolve under TEST_ROOT.
const TEST_ROOT = vi.hoisted(() => {
  const { redirectHome } = require('./helpers/redirect-home.cjs')
  return redirectHome('skillet-pending-test')
})

import { sync } from '../src/commands/sync.js'
import { listPending } from '../src/commands/pending.js'
import { approveUpdate } from '../src/commands/approve.js'
import { rejectUpdate } from '../src/commands/reject.js'
import type { Adapter } from '../src/adapter.js'
import { atomicWrite } from '../src/util/atomic.js'
import { canonicalContentHash } from '@skillet/protocol'
import { generateAuthorKey } from '../src/signing/index.js'
import { signEnvelope } from '../src/signing/envelope.js'
import { pinAuthorKey } from '../src/signing/pin.js'
import { Readable } from 'node:stream'

const CLAUDE_DIR = join(TEST_ROOT, '.claude', 'skills')
const CODEX_DIR = join(TEST_ROOT, '.agents', 'skills')

class CaptureWritable extends Writable {
  data = ''
  override _write(chunk: Buffer, _enc: string, cb: () => void) {
    this.data += chunk.toString('utf8')
    cb()
  }
}

function makeStubAdapter(opts: { name: string; detected: boolean; targetDir: string }): Adapter {
  return {
    name: opts.name,
    targetDir: opts.targetDir,
    async detect() {
      return opts.detected
    },
    targetPath(slug: string) {
      return join(opts.targetDir, slug, 'SKILL.md')
    },
    targetSkillDir(slug: string) {
      return join(opts.targetDir, slug)
    },
    async materialize(slug, bundle) {
      const written: string[] = []
      await mkdir(join(opts.targetDir, slug), { recursive: true })
      for (const [path, bytes] of bundle.entries()) {
        const dest = join(opts.targetDir, slug, path)
        await mkdir(join(opts.targetDir, slug, ...path.split('/').slice(0, -1)), {
          recursive: true,
        })
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

/**
 * Seeds a signed registry skill — diff-gated by policy (sourceClass: "external")
 * and verifiable by sync (Ed25519 signature + pinned key).
 * Returns the hash, authorKey, and pinDir so the caller can wire up sync opts.
 */
async function seedSignedRegistrySkill(
  slug: string,
  content: string,
  skilletDir: string,
  pinDir: string,
  version = 1,
): Promise<{ hash: string; authorKey: ReturnType<typeof generateAuthorKey>; pub: string }> {
  const skillsDir = join(skilletDir, 'skills', slug)
  await mkdir(skillsDir, { recursive: true })
  await writeFile(join(skillsDir, 'SKILL.md'), content, 'utf8')
  const now = new Date().toISOString()
  const bundle = new Map<string, Uint8Array>([['SKILL.md', Buffer.from(content, 'utf8')]])
  const hash = canonicalContentHash(bundle)
  const authorKey = generateAuthorKey()
  const pub = pubFromKey(authorKey)
  const sig = signEnvelope(hash, authorKey)
  // Derive the handle from the slug (e.g. "alice" from "alice/test-skill")
  const handle = slug.split('/')[0] ?? slug
  await pinAuthorKey(handle, { key_id: authorKey.keyId, pub, first_seen_version: version }, pinDir)
  const state = {
    version: 1,
    skills: {
      [slug]: {
        slug,
        name: slug,
        description: '',
        version,
        hash,
        source: 'registry' as const,
        sourceClass: 'external' as const,
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
  return { hash, authorKey, pub }
}

/**
 * Seeds a registry-sourced skill with a stub authorKeyId (no real signature).
 * Safe to use for listPending tests that don't call sync.
 */
async function seedRegistrySkill(
  slug: string,
  content: string,
  skilletDir: string,
  version = 1,
  versionLabel?: string,
): Promise<string> {
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
        version,
        ...(versionLabel ? { versionLabel } : {}),
        hash,
        source: 'registry' as const,
        sourceClass: 'external' as const,
        authorKeyId: 'a'.repeat(64),
        importedAt: now,
        updatedAt: now,
      },
    },
  }
  await atomicWrite(join(skilletDir, 'state.json'), JSON.stringify(state), {
    backup: false,
  })
  return hash
}

async function seedMultipleSignedRegistrySkills(
  skills: Array<{ slug: string; content: string; version?: number }>,
  skilletDir: string,
  pinDir: string,
): Promise<void> {
  const now = new Date().toISOString()
  const stateSkills: Record<string, unknown> = {}
  for (const { slug, content, version = 1 } of skills) {
    const skillsDir = join(skilletDir, 'skills', slug)
    await mkdir(skillsDir, { recursive: true })
    await writeFile(join(skillsDir, 'SKILL.md'), content, 'utf8')
    const bundle = new Map<string, Uint8Array>([['SKILL.md', Buffer.from(content, 'utf8')]])
    const hash = canonicalContentHash(bundle)
    const authorKey = generateAuthorKey()
    const pub = pubFromKey(authorKey)
    const sig = signEnvelope(hash, authorKey)
    const handle = slug.split('/')[0] ?? slug
    await pinAuthorKey(
      handle,
      { key_id: authorKey.keyId, pub, first_seen_version: version },
      pinDir,
    )
    stateSkills[slug] = {
      slug,
      name: slug,
      description: '',
      version,
      hash,
      source: 'registry' as const,
      sourceClass: 'external' as const,
      authorKeyId: authorKey.keyId,
      authorPubBase64: pub,
      signature: sig,
      importedAt: now,
      updatedAt: now,
    }
  }
  await atomicWrite(
    join(skilletDir, 'state.json'),
    JSON.stringify({ version: 1, skills: stateSkills }),
    { backup: false },
  )
}

// ── listPending shape ──────────────────────────────────────────────────

installOfflineRegistry()

describe('listPending — shape', () => {
  let skilletDir: string
  let cwd: string
  let approvalLockPath: string

  beforeEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true })
    skilletDir = join(TEST_ROOT, '.skillet')
    cwd = join(TEST_ROOT, 'project')
    approvalLockPath = join(TEST_ROOT, 'approval.lock')
    await mkdir(cwd, { recursive: true })
  })

  afterEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true })
  })

  it('returns empty when kit is empty', async () => {
    await mkdir(skilletDir, { recursive: true })
    await atomicWrite(join(skilletDir, 'state.json'), JSON.stringify({ version: 1, skills: {} }), {
      backup: false,
    })
    const result = await listPending([], { approvalLockPath })
    expect(result.pending).toHaveLength(0)
  })

  it('omits skills when the state entry exists but the store directory is missing', async () => {
    await mkdir(skilletDir, { recursive: true })
    const now = new Date().toISOString()
    await atomicWrite(
      join(skilletDir, 'state.json'),
      JSON.stringify({
        version: 1,
        skills: {
          'good-import': {
            slug: 'good-import',
            name: 'good-import',
            description: '',
            version: 1,
            hash: 'sha256:' + '0'.repeat(64),
            source: 'registry' as const,
            sourceClass: 'external' as const,
            authorKeyId: 'a'.repeat(64),
            importedAt: now,
            updatedAt: now,
          },
        },
      }),
      { backup: false },
    )

    const result = await listPending([], { approvalLockPath })
    expect(result.pending).toHaveLength(0)
  })

  it('returns a pending entry with correct shape fields', async () => {
    await seedRegistrySkill('demo-skill', '# Demo\n\nContent.', skilletDir)
    const result = await listPending([], { approvalLockPath })
    expect(result.pending).toHaveLength(1)

    const entry = result.pending[0]!
    expect(entry.slug).toBe('demo-skill')
    expect(entry.authorKeyId).toBe('a'.repeat(64))
    expect(entry.approvedVersion).toBeNull() // never approved before
    expect(entry.incomingVersion).toBe(1)
    // No label on the synced entry (older registry) → integers only.
    expect(entry.incomingVersionLabel).toBeUndefined()
    expect(entry.approvedVersionLabel).toBeUndefined()
    expect(typeof entry.diff).toBe('string')
  })

  it('marks a quarantined entry and carries its findings summary (informed consent data)', async () => {
    await seedRegistrySkill('spooky-skill', '# Spooky\n\nContent.', skilletDir)
    // Attach the harm-scan verdict the registry would have synced down.
    const statePath = join(skilletDir, 'state.json')
    const state = JSON.parse(await readFile(statePath, 'utf8'))
    state.skills['spooky-skill'].scan = {
      status: 'quarantined',
      findings_summary: {
        total: 1,
        counts: { destructive: { high: 1 } },
        topConfidence: 'high',
        highlights: [
          { category: 'destructive', confidence: 'high', file: 'x.sh', why: 'destructive:rm-rf-root' },
        ],
      },
    }
    await writeFile(statePath, JSON.stringify(state))

    const result = await listPending([], { approvalLockPath })
    expect(result.pending).toHaveLength(1)
    const entry = result.pending[0]!
    expect(entry.quarantined).toBe(true)
    expect(entry.scanSummary).toContain('QUARANTINED')
    expect(entry.scanSummary).toContain('destructive')
  })

  it('clean entries carry quarantined: false and a null scanSummary', async () => {
    await seedRegistrySkill('demo-skill', '# Demo\n\nContent.', skilletDir)
    const result = await listPending([], { approvalLockPath })
    expect(result.pending[0]!.quarantined).toBe(false)
    expect(result.pending[0]!.scanSummary).toBeNull()
  })

  it('surfaces incomingVersionLabel when the synced entry carries one', async () => {
    await seedRegistrySkill('demo-skill', '# Demo\n\nLabeled.', skilletDir, 2, '1.1.0')
    const result = await listPending([], { approvalLockPath })
    expect(result.pending).toHaveLength(1)
    expect(result.pending[0]!.incomingVersion).toBe(2)
    expect(result.pending[0]!.incomingVersionLabel).toBe('1.1.0')
    // The approval lock records integers only — no approved label source yet.
    expect(result.pending[0]!.approvedVersionLabel).toBeUndefined()
  })

  it('includes approvedVersion from the approval lock when previously approved', async () => {
    const { checkLock: _unused, recordApproval } = await import('../src/trust/approval-lock.js')
    // First, record an approval for v1
    await recordApproval(approvalLockPath, 'demo-skill', 1, {
      contentHash: 'sha256:old',
      authorKeyId: 'a'.repeat(64),
      approvedAt: new Date().toISOString(),
    })
    // Then seed v2 (unapproved)
    await seedRegistrySkill('demo-skill', '# Demo v2\n\nNew content.', skilletDir, 2)
    const result = await listPending([], { approvalLockPath })
    expect(result.pending).toHaveLength(1)
    expect(result.pending[0]!.approvedVersion).toBe(1)
    expect(result.pending[0]!.incomingVersion).toBe(2)
  })

  it('omits already-approved skills', async () => {
    const { recordApproval } = await import('../src/trust/approval-lock.js')
    const content = '# Demo\n\nAlready approved.'
    const bundle = new Map<string, Uint8Array>([['SKILL.md', Buffer.from(content, 'utf8')]])
    const hash = canonicalContentHash(bundle)
    await seedRegistrySkill('demo-skill', content, skilletDir)
    await recordApproval(approvalLockPath, 'demo-skill', 1, {
      contentHash: hash,
      authorKeyId: 'a'.repeat(64),
      approvedAt: new Date().toISOString(),
    })
    const result = await listPending([], { approvalLockPath })
    expect(result.pending).toHaveLength(0)
  })

  it('omits rejected skills', async () => {
    const { recordRejection } = await import('../src/trust/approval-lock.js')
    await seedRegistrySkill('demo-skill', '# Demo\n\nRejected.', skilletDir)
    await recordRejection(approvalLockPath, 'demo-skill', 1, {
      authorKeyId: 'a'.repeat(64),
      rejectedAt: new Date().toISOString(),
    })
    const result = await listPending([], { approvalLockPath })
    expect(result.pending).toHaveLength(0)
  })

  it('includes diff when an active adapter has materialized files', async () => {
    const oldContent = '# Demo\n\nOld version.'
    const newContent = '# Demo\n\nNew version.'
    const adapters = [
      makeStubAdapter({ name: 'claude-code', detected: true, targetDir: CLAUDE_DIR }),
    ]
    // Pre-materialize the old version into the adapter directory.
    await mkdir(join(CLAUDE_DIR, 'demo-skill'), { recursive: true })
    await writeFile(join(CLAUDE_DIR, 'demo-skill', 'SKILL.md'), oldContent, 'utf8')
    // Seed the new version in the kit.
    await seedRegistrySkill('demo-skill', newContent, skilletDir)
    const result = await listPending(adapters, { approvalLockPath })
    expect(result.pending).toHaveLength(1)
    const diff = result.pending[0]!.diff
    expect(diff).toContain('-Old version.')
    expect(diff).toContain('+New version.')
  })
})

// ── approve→materialize ────────────────────────────────────────────────

describe('approveUpdate + sync — approve materializes', () => {
  let skilletDir: string
  let cwd: string
  let pinDir: string
  let approvalLockPath: string

  beforeEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true })
    skilletDir = join(TEST_ROOT, '.skillet')
    cwd = join(TEST_ROOT, 'project')
    pinDir = join(TEST_ROOT, '.config', 'skillet', 'pinned')
    approvalLockPath = join(TEST_ROOT, 'approval.lock')
    await mkdir(cwd, { recursive: true })
    await mkdir(pinDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true })
  })

  it('approved skill is materialized on next sync (no interactive prompt)', async () => {
    await seedSignedRegistrySkill(
      'alice/demo-skill',
      '# Demo\n\nApproved content.',
      skilletDir,
      pinDir,
    )

    // Approve non-interactively.
    await approveUpdate('alice/demo-skill', 1, { approvalLockPath })

    // Sync should materialize without prompting (no TTY, no SKILLET_APPROVE_PRE).
    const adapter = makeStubAdapter({
      name: 'claude-code',
      detected: true,
      targetDir: CLAUDE_DIR,
    })
    const out = new CaptureWritable()
    const result = await sync(cwd, [adapter], {
      approvalLockPath,
      pinDir,
      output: out as unknown as NodeJS.WritableStream,
      input: Readable.from([]) as unknown as NodeJS.ReadableStream,
    })

    expect(result.materialized).toHaveLength(1)
    expect(result.materialized[0]?.slug).toBe('alice/demo-skill')
    expect(out.data).not.toContain('Auto-approved')
    const written = await readFile(join(CLAUDE_DIR, 'alice', 'demo-skill', 'SKILL.md'), 'utf8')
    expect(written).toContain('Approved content.')
  })

  it('rejects mismatched version in approveUpdate', async () => {
    await seedSignedRegistrySkill('alice/demo-skill', '# Demo\n\nContent.', skilletDir, pinDir, 2)
    await expect(approveUpdate('alice/demo-skill', 1, { approvalLockPath })).rejects.toThrow(
      /version 2, not 1/,
    )
  })

  it('rejects unknown slug in approveUpdate', async () => {
    await mkdir(skilletDir, { recursive: true })
    await atomicWrite(join(skilletDir, 'state.json'), JSON.stringify({ version: 1, skills: {} }), {
      backup: false,
    })
    await expect(approveUpdate('nonexistent-skill', 1, { approvalLockPath })).rejects.toThrow(
      /not found in kit/,
    )
  })
})

// ── reject→no-materialize ───────────────────────────────────────

describe('rejectUpdate + sync — rejected skill skipped', () => {
  let skilletDir: string
  let cwd: string
  let pinDir: string
  let approvalLockPath: string

  beforeEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true })
    skilletDir = join(TEST_ROOT, '.skillet')
    cwd = join(TEST_ROOT, 'project')
    pinDir = join(TEST_ROOT, '.config', 'skillet', 'pinned')
    approvalLockPath = join(TEST_ROOT, 'approval.lock')
    await mkdir(cwd, { recursive: true })
    await mkdir(pinDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true })
  })

  it('rejected skill is not materialized on next sync (AC 4: no re-prompt)', async () => {
    await seedSignedRegistrySkill(
      'alice/demo-skill',
      '# Demo\n\nRejected content.',
      skilletDir,
      pinDir,
    )

    // Reject non-interactively.
    await rejectUpdate('alice/demo-skill', { approvalLockPath })

    const adapter = makeStubAdapter({
      name: 'claude-code',
      detected: true,
      targetDir: CLAUDE_DIR,
    })
    const out = new CaptureWritable()
    const result = await sync(cwd, [adapter], {
      approvalLockPath,
      pinDir,
      output: out as unknown as NodeJS.WritableStream,
      input: Readable.from([]) as unknown as NodeJS.ReadableStream,
    })

    // No materialization occurred.
    expect(result.materialized).toHaveLength(0)
    // Sync should log that the update was rejected (not re-prompt).
    expect(out.data).toContain('rejected')
    // File should not exist on disk.
    await expect(readFile(join(CLAUDE_DIR, 'alice', 'demo-skill', 'SKILL.md'))).rejects.toThrow()
  })

  it('rejects unknown slug in rejectUpdate', async () => {
    await mkdir(skilletDir, { recursive: true })
    await atomicWrite(join(skilletDir, 'state.json'), JSON.stringify({ version: 1, skills: {} }), {
      backup: false,
    })
    await expect(rejectUpdate('nonexistent', { approvalLockPath })).rejects.toThrow(
      /not found in kit/,
    )
  })
})

// ── no blanket auto-approve regression ──────────────────────────

describe('no blanket auto-approve regression', () => {
  let skilletDir: string
  let cwd: string
  let pinDir: string
  let approvalLockPath: string

  beforeEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true })
    skilletDir = join(TEST_ROOT, '.skillet')
    cwd = join(TEST_ROOT, 'project')
    pinDir = join(TEST_ROOT, '.config', 'skillet', 'pinned')
    approvalLockPath = join(TEST_ROOT, 'approval.lock')
    await mkdir(cwd, { recursive: true })
    await mkdir(pinDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true })
  })

  it('approving skill-a does not approve skill-b', async () => {
    await seedMultipleSignedRegistrySkills(
      [
        { slug: 'alice/skill-a', content: '# A\n\nContent A.' },
        { slug: 'bob/skill-b', content: '# B\n\nContent B.' },
      ],
      skilletDir,
      pinDir,
    )

    // Approve only skill-a.
    await approveUpdate('alice/skill-a', 1, { approvalLockPath })

    // skill-b should still appear in pending.
    const result = await listPending([], { approvalLockPath })
    const slugs = result.pending.map((e) => e.slug)
    expect(slugs).not.toContain('alice/skill-a')
    expect(slugs).toContain('bob/skill-b')
  })

  it('approving v1 does not approve v2 of the same skill', async () => {
    const { recordApproval } = await import('../src/trust/approval-lock.js')
    // Record approval for v1.
    await recordApproval(approvalLockPath, 'demo-skill', 1, {
      contentHash: 'sha256:v1',
      authorKeyId: 'a'.repeat(64),
      approvedAt: new Date().toISOString(),
    })
    // Seed v2 (new content, new hash — unsigned, safe for listPending-only use).
    await seedRegistrySkill('demo-skill', '# Demo v2\n\nUpdated.', skilletDir, 2)

    const result = await listPending([], { approvalLockPath })
    expect(result.pending).toHaveLength(1)
    expect(result.pending[0]!.incomingVersion).toBe(2)
    expect(result.pending[0]!.approvedVersion).toBe(1)
  })

  it('SKILLET_APPROVE_PRE is not set — sync throws for unapproved external skills on non-TTY', async () => {
    expect(process.env['SKILLET_APPROVE_PRE']).toBeUndefined()

    await seedSignedRegistrySkill(
      'alice/demo-skill',
      '# Demo\n\nDiff-gated skill.',
      skilletDir,
      pinDir,
    )

    const adapter = makeStubAdapter({
      name: 'claude-code',
      detected: true,
      targetDir: CLAUDE_DIR,
    })
    // Non-TTY sync without approval should throw (not silently materialize).
    await expect(
      sync(cwd, [adapter], {
        approvalLockPath,
        pinDir,
        output: Object.assign(new CaptureWritable(), {
          isTTY: false,
        }) as unknown as NodeJS.WritableStream,
        input: Readable.from([]) as unknown as NodeJS.ReadableStream,
      }),
    ).rejects.toThrow(/requires approval/)
  })

  // ── U8: account-scoped write-through + pending merge ──────────────────────

  it('U8: approveUpdate writes through to the account server (best-effort)', async () => {
    const content = '---\nname: owned\n---\nv1\n'
    const skillsDir = join(skilletDir, 'skills', 'alice/owned')
    await mkdir(skillsDir, { recursive: true })
    await writeFile(join(skillsDir, 'SKILL.md'), content, 'utf8')
    const hash = canonicalContentHash(new Map([['SKILL.md', Buffer.from(content)]]))
    await atomicWrite(
      join(skilletDir, 'state.json'),
      JSON.stringify({
        version: 1,
        skills: {
          'alice/owned': {
            slug: 'alice/owned',
            name: 'owned',
            description: '',
            version: 1,
            hash,
            source: 'registry',
            sourceClass: 'external',
            owner: 'alice',
            authorKeyId: 'a'.repeat(64),
            importedAt: 'x',
            updatedAt: 'x',
          },
        },
      }),
      { backup: false },
    )

    const calls: Array<[string, string]> = []
    const fakeClient = {
      postApproval: async (id: string, h: string) => {
        calls.push([id, h])
      },
    } as unknown as import('../src/registry/client.js').RegistryClient

    await approveUpdate('alice/owned', 1, { approvalLockPath, client: fakeClient })
    expect(calls).toEqual([['alice:owned', hash]])
  })

  it('U8: listPending excludes a server-approved version', async () => {
    const content = '---\nname: demo\n---\nv1\n'
    const hash = await seedRegistrySkill('alice/demo-skill', content, skilletDir, 1)
    const fakeClient = {
      getMyDecisions: async () => ({
        update_mode: 'manual' as const,
        decisions: [
          {
            skill_id: 'alice:demo-skill',
            version_hash: hash,
            state: 'approved' as const,
            source: 'web' as const,
            decided_at: 1,
          },
        ],
      }),
    } as unknown as import('../src/registry/client.js').RegistryClient

    const result = await listPending([], { approvalLockPath, client: fakeClient })
    expect(result.pending.find((p) => p.slug === 'alice/demo-skill')).toBeUndefined()
  })
})
