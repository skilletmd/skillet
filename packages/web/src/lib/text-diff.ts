/**
 * Minimal line-level diff — no dependency. A skill's SKILL.md is prose/markdown
 * measured in hundreds of lines, so a straightforward LCS DP is more than fast
 * enough; we cap the matrix and fall back to a whole-file replace on anything
 * pathologically large so a giant generated file can't wedge the browser.
 */

export type DiffLine =
  | { type: 'context'; text: string }
  | { type: 'add'; text: string }
  | { type: 'del'; text: string }

export interface DiffStat {
  added: number
  removed: number
}

/** Cap on either side's line count before we stop computing an LCS. */
const MAX_LINES = 4000

function splitLines(s: string): string[] {
  // Trailing newline shouldn't show as a phantom empty final line.
  const lines = s.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** Longest-common-subsequence line diff of `a` → `b`. */
export function diffLines(a: string, b: string): DiffLine[] {
  const aLines = splitLines(a)
  const bLines = splitLines(b)

  if (aLines.length > MAX_LINES || bLines.length > MAX_LINES) {
    return [
      ...aLines.map((text) => ({ type: 'del' as const, text })),
      ...bLines.map((text) => ({ type: 'add' as const, text })),
    ]
  }

  const n = aLines.length
  const m = bLines.length
  // dp[i][j] = LCS length of aLines[i:] and bLines[j:].
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        aLines[i] === bLines[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (aLines[i] === bLines[j]) {
      out.push({ type: 'context', text: aLines[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: 'del', text: aLines[i] })
      i++
    } else {
      out.push({ type: 'add', text: bLines[j] })
      j++
    }
  }
  while (i < n) out.push({ type: 'del', text: aLines[i++] })
  while (j < m) out.push({ type: 'add', text: bLines[j++] })
  return out
}

export function diffStat(lines: DiffLine[]): DiffStat {
  let added = 0
  let removed = 0
  for (const l of lines) {
    if (l.type === 'add') added++
    else if (l.type === 'del') removed++
  }
  return { added, removed }
}

/**
 * Collapse long runs of unchanged lines to `context` lines on either side of a
 * change, so a two-line edit in a big file doesn't render the whole file. Runs
 * longer than `context * 2 + 1` are replaced by a single gap marker.
 */
export interface DiffRow {
  type: DiffLine['type'] | 'gap'
  text?: string
  /** For a gap row: how many unchanged lines were hidden. */
  hidden?: number
}

export function collapseContext(lines: DiffLine[], context = 3): DiffRow[] {
  // Mark which context lines are "near" a change (within `context`).
  const keep = new Array(lines.length).fill(false)
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].type === 'add' || lines[i].type === 'del') {
      for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) {
        keep[k] = true
      }
    }
  }

  const rows: DiffRow[] = []
  let run = 0
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].type !== 'context' || keep[i]) {
      if (run > 0) {
        rows.push({ type: 'gap', hidden: run })
        run = 0
      }
      rows.push({ type: lines[i].type, text: lines[i].text })
    } else {
      run++
    }
  }
  if (run > 0) rows.push({ type: 'gap', hidden: run })
  return rows
}
