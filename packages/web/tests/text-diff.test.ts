import { describe, expect, it } from 'vitest'
import { collapseContext, diffLines, diffStat } from '@/lib/text-diff'

describe('diffLines', () => {
  it('marks a single changed line as one del + one add', () => {
    const a = 'alpha\nbeta\ngamma'
    const b = 'alpha\nBETA\ngamma'
    const lines = diffLines(a, b)
    expect(lines).toEqual([
      { type: 'context', text: 'alpha' },
      { type: 'del', text: 'beta' },
      { type: 'add', text: 'BETA' },
      { type: 'context', text: 'gamma' },
    ])
    expect(diffStat(lines)).toEqual({ added: 1, removed: 1 })
  })

  it('detects pure insertions without touching surrounding lines', () => {
    const a = 'one\ntwo'
    const b = 'one\ninserted\ntwo'
    expect(diffStat(diffLines(a, b))).toEqual({ added: 1, removed: 0 })
  })

  it('detects pure deletions', () => {
    const a = 'one\ntwo\nthree'
    const b = 'one\nthree'
    expect(diffStat(diffLines(a, b))).toEqual({ added: 0, removed: 1 })
  })

  it('reports no changes for identical text (ignoring a trailing newline)', () => {
    const lines = diffLines('same\ntext\n', 'same\ntext')
    expect(diffStat(lines)).toEqual({ added: 0, removed: 0 })
    expect(lines.every((l) => l.type === 'context')).toBe(true)
  })
})

describe('collapseContext', () => {
  it('folds long unchanged runs into a single gap row', () => {
    const a = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n')
    // change only the last line
    const b = [...Array.from({ length: 19 }, (_, i) => `line ${i}`), 'CHANGED'].join('\n')
    const rows = collapseContext(diffLines(a, b), 3)
    const gap = rows.find((r) => r.type === 'gap')
    expect(gap).toBeDefined()
    // the leading 16 unchanged lines (0..15) collapse; 16,17,18 stay as context
    expect(gap?.hidden).toBe(16)
    expect(rows.some((r) => r.type === 'del' && r.text === 'line 19')).toBe(true)
    expect(rows.some((r) => r.type === 'add' && r.text === 'CHANGED')).toBe(true)
  })

  it('keeps everything when the whole file is short', () => {
    const rows = collapseContext(diffLines('a\nb', 'a\nB'), 3)
    expect(rows.some((r) => r.type === 'gap')).toBe(false)
  })
})
