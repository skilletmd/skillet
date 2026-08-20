/**
 * Trust policy — sync-path behavior + the security boundary.
 *
 * Proves end-to-end through sync():
 *   - own-kit default (auto-apply): a valid, signed own-kit update materializes
 *     with NO approval prompt (does not throw "requires approval" even non-TTY).
 *   - external default (diff-gate): a stranger's update is gated (non-TTY throws).
 *   - per-skill override flips an external skill to auto-apply through sync.
 *   - SECURITY BOUNDARY: auto-apply removes the human diff prompt ONLY.
 *     A trusted, auto-apply skill receiving a TAMPERED (signature-mismatched),
 *     UNSIGNED, or COMPROMISED-AUTHOR-KEY (validly signed by a key that does not
 *     match the TOFU pin) update is STILL hard-blocked by the
 *     integrity gate — never materialized, never silently trusted.
 *
 * Isolation mirrors sync.test.ts: HOME + SKILLET_DIR are redirected via vi.hoisted
 * before @skillet/core loads so the materialization allowlist and kit state resolve
 * under a tmp dir. No security checks are mocked.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { installOfflineRegistry } from './helpers/offline-registry.js'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'

const TEST_ROOT = vi.hoisted(() => {
  const { redirectHome } = require('./helpers/redirect-home.cjs')
  return redirectHome('skillet-policy-sync')
})

import { sync } from '../src/commands/sync.js'
import type { Adapter } from '../src/adapter.js'
import { atomicWrite } from '../src/util/atomic.js'
import { canonicalContentHash } from '@skillet/protocol'
import { generateAuthorKey } from '../src/signing/index.js'
import { signEnvelope } from '../src/signing/envelope.js'
import { pinAuthorKey } from '../src/signing/pin.js'
import { savePolicy, type TrustPolicyFile } from '../src/trust/policy.js'

const CLAUDE_DIR = join(TEST_ROOT, '.claude', 'skills')

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
        await mkdir(join(targetDir, slug, ...path.split('/').slice(0, -1)), {
          recursive: true,
        })
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

const SLUG = 'alice/test-skill'
const CONTENT = '---\nname: test\n---\n\nHello policy.\n'

interface SeedOpts {
  sourceClass?: 'own-kit' | 'external'
  /** Sign over this hash instead of the real one (simulates tampered content). */
  signOverHash?: string
  /** Omit the signature entirely (simulates an unsigned update). */
  unsigned?: boolean
  /**
   * Pin a DIFFERENT author key than the one that signed the update. Models a
   * compromised/rotated author key: the envelope is validly signed by the
   * served key, but that key does not match the TOFU-pinned key, so
   * resolveAuthorKey throws key_id_mismatch.
   */
  pinDifferentKey?: boolean
  /** When false, skip TOFU pin setup (NF-006 unpinned-author gate). */
  pinAuthor?: boolean
}

async function seedRegistrySkill(opts: SeedOpts = {}): Promise<void> {
  const authorKey = generateAuthorKey()
  const pub = pubFromKey(authorKey)
  const skilletDir = process.env['SKILLET_DIR'] as string

  const bundle = new Map<string, Uint8Array>([['SKILL.md', Buffer.from(CONTENT)]])
  const hash = canonicalContentHash(bundle)

  // Write the bundle to the local skill store.
  const skillsDir = join(skilletDir, 'skills', SLUG)
  await mkdir(skillsDir, { recursive: true })
  await writeFile(join(skillsDir, 'SKILL.md'), CONTENT, 'utf8')

  const sig = signEnvelope(opts.signOverHash ?? hash, authorKey)
  const now = new Date().toISOString()
  const state = {
    version: 1,
    skills: {
      [SLUG]: {
        slug: SLUG,
        name: 'test-skill',
        description: '',
        version: 1,
        hash,
        source: 'registry' as const,
        sourceClass: opts.sourceClass ?? 'external',
        sourceKit: '@test/sync-kit',
        authorKeyId: authorKey.keyId,
        authorPubBase64: pub,
        ...(opts.unsigned ? {} : { signature: sig }),
        importedAt: now,
        updatedAt: now,
      },
    },
  }
  await atomicWrite(join(skilletDir, 'state.json'), JSON.stringify(state), {
    backup: false,
  })

  // By default pin the same key that signed the update. For the compromised-key
  // case, pin a different key so the served key_id no longer matches the pin.
  let pinKeyId = authorKey.keyId
  let pinPub = pub
  if (opts.pinDifferentKey) {
    const other = generateAuthorKey()
    pinKeyId = other.keyId
    pinPub = pubFromKey(other)
  }
  if (opts.pinAuthor !== false) {
    await pinAuthorKey('alice', { key_id: pinKeyId, pub: pinPub, first_seen_version: 1 }, pinDir)
  }
}

let cwd: string
let pinDir: string
let policyPath: string

function syncOpts(out: Writable) {
  return {
    output: out,
    input: Readable.from([]),
    approvalLockPath: join(TEST_ROOT, 'approval.lock'),
    configDir: join(TEST_ROOT, '.config'),
    pinDir,
    policyPath,
  }
}

class CaptureWritable extends Writable {
  data = ''
  isTTY = false
  override _write(chunk: Buffer, _enc: string, cb: () => void) {
    this.data += chunk.toString('utf8')
    cb()
  }
}

installOfflineRegistry()

describe('trust policy through sync()', () => {
  beforeEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true })
    cwd = join(TEST_ROOT, 'project')
    pinDir = join(TEST_ROOT, '.config', 'skillet', 'pinned')
    policyPath = join(TEST_ROOT, '.config', 'skillet', 'trust-policy.json')
    await mkdir(cwd, { recursive: true })
    await mkdir(pinDir, { recursive: true })
  })
  afterEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true })
  })

  it('own-kit default auto-applies a valid signed update — no approval prompt', async () => {
    await seedRegistrySkill({ sourceClass: 'own-kit' }) // global own-kit = auto
    const out = new CaptureWritable()
    const result = await sync(cwd, [makeStubAdapter(CLAUDE_DIR)], syncOpts(out))

    expect(result.failed).toEqual([])
    expect(result.materialized).toHaveLength(1)
    expect(out.data).not.toContain('requires approval')
    expect(await readFile(join(CLAUDE_DIR, SLUG, 'SKILL.md'), 'utf8')).toBe(CONTENT)
  })

  it("external default diff-gates a stranger's update (non-TTY → throws)", async () => {
    await seedRegistrySkill({ sourceClass: 'external' }) // global external = gate
    const out = new CaptureWritable()
    await expect(sync(cwd, [makeStubAdapter(CLAUDE_DIR)], syncOpts(out))).rejects.toThrow(
      'requires approval',
    )
  })

  it('own-kit skill from unpinned author is diff-gated', async () => {
    await seedRegistrySkill({ sourceClass: 'own-kit', pinAuthor: false })
    const out = new CaptureWritable()
    await expect(sync(cwd, [makeStubAdapter(CLAUDE_DIR)], syncOpts(out))).rejects.toThrow(
      'requires approval',
    )
  })

  it('per-skill override flips an external skill to auto-apply', async () => {
    await seedRegistrySkill({ sourceClass: 'external' })
    const policy: TrustPolicyFile = {
      version: 1,
      globals: { 'own-kit': 'auto', external: 'gate' },
      authors: {},
      skills: { [SLUG]: 'auto' },
    }
    await savePolicy(policy, policyPath)

    const out = new CaptureWritable()
    const result = await sync(cwd, [makeStubAdapter(CLAUDE_DIR)], syncOpts(out))
    expect(result.failed).toEqual([])
    expect(result.materialized).toHaveLength(1)
    expect(out.data).not.toContain('requires approval')
  })

  // ── AC #5: the security boundary ──────────────────────────────────────────

  // ── R1/R2: NO path reverts an edit — customize-in-place everywhere ────────

  const EDITED = '---\nname: test\n---\n\nHELLO EDITED.\n'

  it('R1/R2: headless sync does NOT revert an edited registry skill — it customizes in place', async () => {
    // own-kit auto-applies; first sync lands the canonical bundle on disk.
    await seedRegistrySkill({ sourceClass: 'own-kit' })
    await sync(cwd, [makeStubAdapter(CLAUDE_DIR)], syncOpts(new CaptureWritable()))

    // Drift the on-disk copy (edit), then sync again non-interactively.
    const skillFile = join(CLAUDE_DIR, SLUG, 'SKILL.md')
    await writeFile(skillFile, EDITED, 'utf8')

    const out = new CaptureWritable() // isTTY=false → headless
    const result = await sync(cwd, [makeStubAdapter(CLAUDE_DIR)], syncOpts(out))

    // The edit is left LIVE and the skill is marked customized — never reverted.
    expect(result.customized).toEqual([{ slug: SLUG, hasUpdate: false }])
    expect(result.materialized).toHaveLength(0)
    expect(await readFile(skillFile, 'utf8')).toBe(EDITED)
  })

  it('R1/R2: interactive sync also leaves the edit live and customizes it', async () => {
    await seedRegistrySkill({ sourceClass: 'own-kit' })
    await sync(cwd, [makeStubAdapter(CLAUDE_DIR)], syncOpts(new CaptureWritable()))

    const skillFile = join(CLAUDE_DIR, SLUG, 'SKILL.md')
    await writeFile(skillFile, EDITED, 'utf8')

    const out = new CaptureWritable()
    const result = await sync(cwd, [makeStubAdapter(CLAUDE_DIR)], {
      ...syncOpts(out),
      pullMode: 'interactive',
    })

    // Deliberate behavior change from the shipped fork-on-edit: the edit stays
    // in place as the user's customized version, with no approval prompt and no
    // revert to the signed bytes.
    expect(result.customized).toEqual([{ slug: SLUG, hasUpdate: false }])
    expect(out.data).not.toContain('requires approval')
    expect(await readFile(skillFile, 'utf8')).toBe(EDITED)
  })

  it('SECURITY: a tampered update to a trusted auto-apply skill is still blocked', async () => {
    // own-kit → auto-apply by default, BUT the signature is over a different
    // hash than the actual bundle content (content was swapped post-signing).
    await seedRegistrySkill({
      sourceClass: 'own-kit',
      signOverHash: 'sha256:' + '0'.repeat(64),
    })
    const out = new CaptureWritable()
    const result = await sync(cwd, [makeStubAdapter(CLAUDE_DIR)], syncOpts(out))

    // Auto-apply removed the prompt, but the integrity gate still fired.
    expect(result.materialized).toHaveLength(0)
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]?.slug).toBe(SLUG)
    // Nothing was written to disk.
    await expect(readFile(join(CLAUDE_DIR, SLUG, 'SKILL.md'))).rejects.toThrow()
  })

  it('SECURITY: an unsigned update to a trusted auto-apply skill is still blocked', async () => {
    await seedRegistrySkill({ sourceClass: 'own-kit', unsigned: true })
    const out = new CaptureWritable()
    const result = await sync(cwd, [makeStubAdapter(CLAUDE_DIR)], syncOpts(out))

    expect(result.materialized).toHaveLength(0)
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]?.reason).toMatch(/signature|integrity/i)
    await expect(readFile(join(CLAUDE_DIR, SLUG, 'SKILL.md'))).rejects.toThrow()
  })

  it('SECURITY: a compromised author key (validly signed, wrong pinned key) to a trusted auto-apply skill is still blocked', async () => {
    // own-kit → auto-apply, envelope is validly signed by the served key, BUT
    // the served key_id does not match the TOFU-pinned key. The integrity gate
    // (resolveAuthorKey → key_id_mismatch) must still hard-block it.
    await seedRegistrySkill({ sourceClass: 'own-kit', pinDifferentKey: true })
    const out = new CaptureWritable()
    const result = await sync(cwd, [makeStubAdapter(CLAUDE_DIR)], syncOpts(out))

    expect(out.data).not.toContain('requires approval') // auto-apply: no prompt
    expect(result.materialized).toHaveLength(0)
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]?.slug).toBe(SLUG)
    expect(result.failed[0]?.reason).toMatch(/key_id_mismatch/i)
    // Nothing written to disk.
    await expect(readFile(join(CLAUDE_DIR, SLUG, 'SKILL.md'))).rejects.toThrow()
  })
})
