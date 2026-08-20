import { describe, it, expect, beforeEach } from 'vitest'
import { symlinksAvailable } from "../../tests/symlink-support.js";
import { mkdir, writeFile, rm, symlink, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { canonicalContentHash } from '@skillet/protocol'
import {
  skillContentDir,
  ensureSkillStoreReadme,
  SKILL_STORE_README,
} from '../kit/store.js'
import { detectStoreDrift, readTreeIgnoringDotfiles } from './edits-store.js'

const STORE_ROOT = join(process.env['SKILLET_DIR'] ?? join(homedir(), '.skillet'), 'skills')

const SLUG = '@openclaudia/serp-analyzer'

async function writeStore(files: Record<string, string>): Promise<string> {
  const dir = skillContentDir(SLUG)
  await rm(dir, { recursive: true, force: true })
  for (const [rel, body] of Object.entries(files)) {
    const dest = join(dir, ...rel.split('/'))
    await mkdir(join(dest, '..'), { recursive: true })
    await writeFile(dest, body)
  }
  return dir
}

async function baselineOf(dir: string): Promise<string> {
  return canonicalContentHash(await readTreeIgnoringDotfiles(dir))
}

describe('detectStoreDrift (U1)', () => {
  beforeEach(async () => {
    await rm(skillContentDir(SLUG), { recursive: true, force: true })
  })

  it('reports not-drifted when store bytes equal the baseline', async () => {
    const dir = await writeStore({ 'SKILL.md': '# Serp Analyzer\nbody\n' })
    const baseline = await baselineOf(dir)
    const res = await detectStoreDrift(SLUG, baseline)
    expect(res.drifted).toBe(false)
    expect(res.uncapturable).toBe(false)
  })

  it('reports drifted with the captured tree when a file changed', async () => {
    const dir = await writeStore({ 'SKILL.md': '# Serp Analyzer\nbody\n' })
    const baseline = await baselineOf(dir)
    await writeFile(join(dir, 'SKILL.md'), '# Serp Analyzer LOCAL CHANGE\nbody\n')
    const res = await detectStoreDrift(SLUG, baseline)
    expect(res.drifted).toBe(true)
    expect(res.uncapturable).toBe(false)
    expect(res.tree).not.toBeNull()
    expect(res.tree?.has('SKILL.md')).toBe(true)
  })

  it('treats a missing store dir as not-drifted (nothing on disk)', async () => {
    const res = await detectStoreDrift(SLUG, 'sha256:whatever')
    expect(res.drifted).toBe(false)
    expect(res.uncapturable).toBe(false)
  })

  it('treats an empty store dir as not-drifted', async () => {
    await mkdir(skillContentDir(SLUG), { recursive: true })
    const res = await detectStoreDrift(SLUG, 'sha256:whatever')
    expect(res.drifted).toBe(false)
  })

  // Creating a symlink on Windows needs SeCreateSymbolicLinkPrivilege (admin, or
  // Developer Mode), which a normal contributor shell does not have — symlink()
  // throws EPERM before the assertion is ever reached.
  it.skipIf(!symlinksAvailable)('skips a symlinked store dir without claiming drift', async () => {
    const real = await writeStore({ 'SKILL.md': 'x\n' })
    const baseline = await baselineOf(real)
    // Replace the store dir with a symlink to a different tree.
    const other = join(real, '..', 'other-tree')
    await mkdir(other, { recursive: true })
    await writeFile(join(other, 'SKILL.md'), 'DIFFERENT\n')
    await rm(real, { recursive: true, force: true })
    await symlink(other, real, 'dir')
    const res = await detectStoreDrift(SLUG, baseline)
    expect(res.drifted).toBe(false)
    expect(res.uncapturable).toBe(false)
  })

  it('ignores dotfiles so a .DS_Store does not read as drift', async () => {
    const dir = await writeStore({ 'SKILL.md': 'body\n' })
    const baseline = await baselineOf(dir)
    await writeFile(join(dir, '.DS_Store'), 'junk')
    const res = await detectStoreDrift(SLUG, baseline)
    expect(res.drifted).toBe(false)
  })
})

describe('ensureSkillStoreReadme (U8)', () => {
  it('writes the README at the store root, not inside any skill dir', async () => {
    await ensureSkillStoreReadme()
    expect(await readFile(join(STORE_ROOT, 'README.md'), 'utf8')).toBe(SKILL_STORE_README)
    // Not inside a skill bundle dir.
    await expect(stat(join(skillContentDir(SLUG), 'README.md'))).rejects.toThrow()
  })

  it('is idempotent and refreshes stale content', async () => {
    await ensureSkillStoreReadme()
    await writeFile(join(STORE_ROOT, 'README.md'), 'stale\n')
    await ensureSkillStoreReadme()
    expect(await readFile(join(STORE_ROOT, 'README.md'), 'utf8')).toBe(SKILL_STORE_README)
  })

  it('does not read as drift for a skill (README lives outside the skill dir)', async () => {
    const dir = await writeStore({ 'SKILL.md': 'body\n' })
    const baseline = await baselineOf(dir)
    await ensureSkillStoreReadme()
    const res = await detectStoreDrift(SLUG, baseline)
    expect(res.drifted).toBe(false)
  })
})
