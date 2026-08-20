/**
 * Client-side gate.
 *
 * The harm scan lives on the server, but the spec requires that the sync
 * client refuse to materialize a quarantined version without explicit extra
 * consent. These tests run sync() against a kit entry that already carries
 * scan info (as it would after the registry pull writes the SkillEntry
 * back to local state) and assert:
 *
 *   - Non-TTY sync with a quarantined entry skips the slug with a clear
 *     `quarantined: ...` reason in the failed list.
 *   - The adapter never sees the materialize() call — disk is untouched.
 *   - Passing `allowQuarantined: true` lets the same run proceed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { installOfflineRegistry } from './helpers/offline-registry.js'
import { mkdir, readFile, rm, writeFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

const TEST_ROOT = vi.hoisted(() => {
  const { redirectHome } = require('./helpers/redirect-home.cjs')
  return redirectHome('skillet-quarantine-test')
})

import { sync } from '../src/commands/sync.js'
import type { Adapter } from '../src/adapter.js'
import { atomicWrite } from '../src/util/atomic.js'
import { canonicalContentHash } from '@skillet/protocol'
import type { ScanManifestInfo } from '@skillet/protocol'

const CLAUDE_DIR = join(TEST_ROOT, '.claude', 'skills')

function stubAdapter(materializeSpy: (slug: string) => void): Adapter {
  return {
    name: 'claude-code',
    targetDir: CLAUDE_DIR,
    async detect() {
      return true
    },
    targetPath(slug) {
      return join(CLAUDE_DIR, slug, 'SKILL.md')
    },
    async materialize(slug, bundle) {
      materializeSpy(slug)
      const written: string[] = []
      await mkdir(join(CLAUDE_DIR, slug), { recursive: true })
      for (const [path, bytes] of bundle.entries()) {
        const dest = join(CLAUDE_DIR, slug, path)
        await writeFile(dest, Buffer.from(bytes))
        written.push(dest)
      }
      return written
    },
  }
}

async function seedKitEntry(opts: {
  slug: string
  content: string
  scan?: ScanManifestInfo
}): Promise<void> {
  const skilletDir = process.env['SKILLET_DIR'] as string
  const skillsDir = join(skilletDir, 'skills', opts.slug)
  await mkdir(skillsDir, { recursive: true })
  await writeFile(join(skillsDir, 'SKILL.md'), opts.content, 'utf8')
  const bundle = new Map<string, Uint8Array>([['SKILL.md', Buffer.from(opts.content, 'utf8')]])
  const hash = canonicalContentHash(bundle)
  const now = new Date().toISOString()
  const state = {
    version: 1,
    skills: {
      [opts.slug]: {
        slug: opts.slug,
        name: opts.slug,
        description: '',
        version: 1,
        hash,
        source: 'local' as const,
        sourceKit: '@test/sync-kit',
        importedAt: now,
        updatedAt: now,
        scan: opts.scan,
      },
    },
  }
  await atomicWrite(join(skilletDir, 'state.json'), JSON.stringify(state), {
    backup: false,
  })
}

const QUARANTINED_SCAN: ScanManifestInfo = {
  status: 'quarantined',
  findings_summary: {
    total: 2,
    counts: { destructive: { high: 1 }, injection: { medium: 1 } },
    topConfidence: 'high',
    highlights: [
      {
        category: 'destructive',
        confidence: 'high',
        file: 'scripts/setup.sh',
        why: 'destructive:rm-rf-root',
      },
      {
        category: 'injection',
        confidence: 'medium',
        file: 'SKILL.md',
        why: 'injection:ignore-previous',
      },
    ],
  },
}

installOfflineRegistry()

describe('sync() — quarantine gate', () => {
  let cwd: string

  beforeEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true })
    cwd = join(TEST_ROOT, 'project')
    await mkdir(cwd, { recursive: true })
  })

  afterEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true })
  })

  it('refuses to materialize a quarantined entry in a non-TTY run, leaving disk untouched', async () => {
    await seedKitEntry({
      slug: 'tainted',
      content: '---\nname: tainted\n---\n# x\n',
      scan: QUARANTINED_SCAN,
    })
    let calls = 0
    const adapter = stubAdapter(() => calls++)

    const writes: string[] = []
    const output = {
      write(s: string) {
        writes.push(s)
        return true
      },
      isTTY: false,
    } as unknown as NodeJS.WriteStream

    const result = await sync(cwd, [adapter], { output })

    expect(calls).toBe(0)
    expect(result.materialized).toHaveLength(0)
    expect(result.failed).toEqual([
      {
        slug: 'tainted',
        reason: expect.stringContaining('quarantined: harm scan flagged'),
      },
    ])
    await expect(stat(join(CLAUDE_DIR, 'tainted', 'SKILL.md'))).rejects.toThrow()
  })

  it('materializes the same entry when allowQuarantined is set', async () => {
    await seedKitEntry({
      slug: 'tainted',
      content: '---\nname: tainted\n---\n# x\n',
      scan: QUARANTINED_SCAN,
    })
    let calls = 0
    const adapter = stubAdapter(() => calls++)

    const output = {
      write() {
        return true
      },
      isTTY: false,
    } as unknown as NodeJS.WriteStream

    const result = await sync(cwd, [adapter], {
      output,
      allowQuarantined: true,
    })

    expect(calls).toBe(1)
    expect(result.materialized).toHaveLength(1)
    expect(result.failed).toHaveLength(0)
    const onDisk = await readFile(join(CLAUDE_DIR, 'tainted', 'SKILL.md'), 'utf8')
    expect(onDisk).toContain('name: tainted')
  })

  it('allowQuarantinedSlugs grants exactly the named slug — a mixed batch never widens consent', async () => {
    // Three entries in one state: two quarantined, one clean. Only q-consented
    // carries a per-slug grant; q-unseen must still be refused even though it
    // rides the same sync call (the review-surface consent contract, U1).
    const skilletDir = process.env['SKILLET_DIR'] as string
    const mk = async (slug: string) => {
      const dir = join(skilletDir, 'skills', slug)
      await mkdir(dir, { recursive: true })
      const content = `---\nname: ${slug}\n---\n# ${slug}\n`
      await writeFile(join(dir, 'SKILL.md'), content, 'utf8')
      const bundle = new Map<string, Uint8Array>([['SKILL.md', Buffer.from(content, 'utf8')]])
      return { content, hash: canonicalContentHash(bundle) }
    }
    const now = new Date().toISOString()
    const entries: Record<string, unknown> = {}
    for (const [slug, scan] of [
      ['q-consented', QUARANTINED_SCAN],
      ['q-unseen', QUARANTINED_SCAN],
      ['clean-one', undefined],
    ] as const) {
      const { hash } = await mk(slug)
      entries[slug] = {
        slug,
        name: slug,
        description: '',
        version: 1,
        hash,
        source: 'local' as const,
        sourceKit: '@test/sync-kit',
        importedAt: now,
        updatedAt: now,
        ...(scan ? { scan } : {}),
      }
    }
    await atomicWrite(join(skilletDir, 'state.json'), JSON.stringify({ version: 1, skills: entries }), {
      backup: false,
    })

    const materialized: string[] = []
    const adapter = stubAdapter((slug) => materialized.push(slug))
    const output = {
      write() {
        return true
      },
      isTTY: false,
    } as unknown as NodeJS.WriteStream

    const result = await sync(cwd, [adapter], {
      output,
      allowQuarantinedSlugs: ['q-consented'],
    })

    expect(materialized.sort()).toEqual(['clean-one', 'q-consented'])
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]!.slug).toBe('q-unseen')
    expect(result.failed[0]!.reason).toContain('quarantined')
    await expect(readFile(join(CLAUDE_DIR, 'q-unseen', 'SKILL.md'), 'utf8')).rejects.toThrow()
  })

  it('findings summaries strip terminal escapes from registry-supplied text', async () => {
    const { renderFindingsSummary } = await import('../src/trust/quarantine.js')
    const hostile: import('@skillet/protocol').ScanManifestInfo = {
      status: 'quarantined',
      findings_summary: {
        total: 1,
        counts: { destructive: { high: 1 } },
        topConfidence: 'high',
        highlights: [
          {
            category: 'destr\u001b[31muctive',
            confidence: 'high',
            file: '\u001b]0;owned\u0007x.sh',
            why: 'rm-rf\u001b[2J-root',
          },
        ],
      },
    }
    const rendered = renderFindingsSummary(hostile)
    expect(rendered).not.toMatch(/\u001b/)
    expect(rendered).toContain('destructive')
    expect(rendered).toContain('x.sh')
  })

  it('a clean entry materializes without consulting the quarantine gate', async () => {
    await seedKitEntry({
      slug: 'clean',
      content: '---\nname: clean\n---\n# clean\n',
    })
    let calls = 0
    const adapter = stubAdapter(() => calls++)

    const output = {
      write() {
        return true
      },
      isTTY: false,
    } as unknown as NodeJS.WriteStream

    const result = await sync(cwd, [adapter], { output })
    expect(calls).toBe(1)
    expect(result.materialized).toHaveLength(1)
  })
})
