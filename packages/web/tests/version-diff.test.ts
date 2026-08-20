import { describe, expect, it, vi } from 'vitest'
import { buildVersionDiff } from '@/lib/version-diff'
import type { SkillBundleFileIndexEntry } from '@/lib/skill-bundle-file-fetch'

const t = (path: string, size: number): SkillBundleFileIndexEntry => ({
  path,
  kind: 'text',
  size,
  executable: false,
})
const bin = (path: string, size: number): SkillBundleFileIndexEntry => ({
  path,
  kind: 'binary',
  size,
  executable: false,
})

describe('buildVersionDiff', () => {
  it('detects modified, added, and removed text files, SKILL.md first', async () => {
    const prevIndex = [t('SKILL.md', 10), t('old.md', 5)]
    const curIndex = [t('SKILL.md', 12), t('new.md', 6)]
    const texts: Record<string, Record<string, string>> = {
      A: { 'SKILL.md': 'a\nb\nc', 'old.md': 'gone' },
      B: { 'SKILL.md': 'a\nB\nc', 'new.md': 'fresh' },
    }
    const fetchText = vi.fn((hash: string, path: string) =>
      Promise.resolve(texts[hash]?.[path] ?? null),
    )

    const diffs = await buildVersionDiff(curIndex, prevIndex, fetchText, 'B', 'A')

    expect(diffs.map((d) => `${d.path}:${d.status}`)).toEqual([
      'SKILL.md:modified',
      'new.md:added',
      'old.md:removed',
    ])
    const skill = diffs[0]
    expect(skill.added).toBe(1)
    expect(skill.removed).toBe(1)
  })

  it('omits files whose text is byte-identical across versions', async () => {
    const index = [t('SKILL.md', 3), t('same.md', 4)]
    const same: Record<string, string> = { 'SKILL.md': 'a\nb', 'same.md': 'keep' }
    const fetchText = vi.fn((_h: string, path: string) => Promise.resolve(same[path] ?? null))

    // Only SKILL.md changes; same.md is identical.
    const cur = [t('SKILL.md', 3), t('same.md', 4)]
    const prev = [t('SKILL.md', 3), t('same.md', 4)]
    const texts: Record<string, Record<string, string>> = {
      B: { 'SKILL.md': 'a\nb\nc', 'same.md': 'keep' },
      A: { 'SKILL.md': 'a\nb', 'same.md': 'keep' },
    }
    const fetch2 = vi.fn((hash: string, path: string) => Promise.resolve(texts[hash]?.[path] ?? null))
    const diffs = await buildVersionDiff(cur, prev, fetch2, 'B', 'A')
    expect(diffs.map((d) => d.path)).toEqual(['SKILL.md'])
    // touch the unused fixtures to keep the linter honest
    void index
    void fetchText
    void same
  })

  it('reports a binary change only when its size moves, and never fetches bytes', async () => {
    const fetchText = vi.fn(() => Promise.resolve(null))

    const changed = await buildVersionDiff([bin('logo.png', 200)], [bin('logo.png', 100)], fetchText, 'B', 'A')
    expect(changed).toEqual([{ path: 'logo.png', status: 'binary-changed', added: 0, removed: 0 }])

    const unchanged = await buildVersionDiff([bin('logo.png', 100)], [bin('logo.png', 100)], fetchText, 'B', 'A')
    expect(unchanged).toEqual([])

    // A binary body is never pulled into the browser to detect a change.
    expect(fetchText).not.toHaveBeenCalled()
  })

  it('labels an added binary file without a text diff', async () => {
    const fetchText = vi.fn(() => Promise.resolve(null))
    const diffs = await buildVersionDiff([bin('img.png', 50)], [], fetchText, 'B', 'A')
    expect(diffs).toEqual([{ path: 'img.png', status: 'binary-added', added: 0, removed: 0 }])
  })
})
