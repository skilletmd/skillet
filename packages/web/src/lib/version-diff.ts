import { SKILL_ENTRYPOINT } from '@/lib/skill-bundle'
import type { SkillBundleFileIndexEntry } from '@/lib/skill-bundle-file-fetch'
import { collapseContext, diffLines, diffStat, type DiffRow } from '@/lib/text-diff'

/**
 * Whole-bundle version diff. A skill is a folder, so "what changed" spans every
 * file, not just SKILL.md. Given the two versions' file indexes (metadata only)
 * plus a lazy text fetcher, this returns one {@link FileDiff} per file that
 * actually changed — added, removed, modified, or a binary swap we can't line-diff.
 *
 * Text diffs are computed here; binary changes are reported by presence/size
 * alone (the index carries no per-file content hash, and we never pull binary
 * bytes into the browser just to detect a change).
 */

export type FileStatus = 'added' | 'removed' | 'modified' | 'binary-added' | 'binary-removed' | 'binary-changed'

export interface FileDiff {
  path: string
  status: FileStatus
  /** Present for text diffs (added/removed/modified). */
  rows?: DiffRow[]
  added: number
  removed: number
}

/** Fetch one file's decoded text at a version hash, or null if missing/binary. */
export type TextFetcher = (hash: string, path: string) => Promise<string | null>

/** SKILL.md leads; everything else is alphabetical. */
function comparePaths(a: string, b: string): number {
  if (a === SKILL_ENTRYPOINT) return b === SKILL_ENTRYPOINT ? 0 : -1
  if (b === SKILL_ENTRYPOINT) return 1
  return a.localeCompare(b)
}

async function diffOnePath(
  path: string,
  cur: SkillBundleFileIndexEntry | undefined,
  prev: SkillBundleFileIndexEntry | undefined,
  fetchText: TextFetcher,
  curHash: string,
  prevHash: string,
): Promise<FileDiff | null> {
  const curText = cur?.kind === 'text'
  const prevText = prev?.kind === 'text'

  // Added.
  if (cur && !prev) {
    if (!curText) return { path, status: 'binary-added', added: 0, removed: 0 }
    const text = await fetchText(curHash, path)
    if (text == null) return { path, status: 'binary-added', added: 0, removed: 0 }
    const rows = collapseContext(diffLines('', text))
    const { added, removed } = diffStat(diffLines('', text))
    return { path, status: 'added', rows, added, removed }
  }

  // Removed.
  if (prev && !cur) {
    if (!prevText) return { path, status: 'binary-removed', added: 0, removed: 0 }
    const text = await fetchText(prevHash, path)
    if (text == null) return { path, status: 'binary-removed', added: 0, removed: 0 }
    const lines = diffLines(text, '')
    return { path, status: 'removed', rows: collapseContext(lines), ...diffStat(lines) }
  }

  // Present in both.
  if (cur && prev) {
    if (!curText || !prevText) {
      // At least one side is binary — report a change only if the size moved.
      return cur.size === prev.size
        ? null
        : { path, status: 'binary-changed', added: 0, removed: 0 }
    }
    const [prevBody, curBody] = await Promise.all([
      fetchText(prevHash, path),
      fetchText(curHash, path),
    ])
    if (prevBody == null || curBody == null) {
      return cur.size === prev.size
        ? null
        : { path, status: 'binary-changed', added: 0, removed: 0 }
    }
    const lines = diffLines(prevBody, curBody)
    const stat = diffStat(lines)
    if (stat.added === 0 && stat.removed === 0) return null
    return { path, status: 'modified', rows: collapseContext(lines), ...stat }
  }

  return null
}

/** Bounded-concurrency map so a many-file bundle doesn't fan out unbounded. */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let index = 0
  async function worker(): Promise<void> {
    while (index < items.length) {
      const i = index++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return out
}

export async function buildVersionDiff(
  curIndex: SkillBundleFileIndexEntry[],
  prevIndex: SkillBundleFileIndexEntry[],
  fetchText: TextFetcher,
  curHash: string,
  prevHash: string,
): Promise<FileDiff[]> {
  const curMap = new Map(curIndex.map((f) => [f.path, f]))
  const prevMap = new Map(prevIndex.map((f) => [f.path, f]))
  const paths = [...new Set([...curMap.keys(), ...prevMap.keys()])].sort(comparePaths)

  const diffs = await mapPool(paths, 6, (path) =>
    diffOnePath(path, curMap.get(path), prevMap.get(path), fetchText, curHash, prevHash),
  )
  return diffs.filter((d): d is FileDiff => d != null)
}
