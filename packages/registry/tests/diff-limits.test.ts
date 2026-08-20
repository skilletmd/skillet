// U4 — Diff size guard (DoS bound). lib/diff.ts builds an O(m*n) LCS table, so
// two large text versions would OOM / stall the event loop on the public,
// unauthenticated GET /skills/:author/:slug/diff route. renderUnifiedDiff must
// bound BOTH sides (line count + raw bytes) BEFORE allocating the table and
// return { tooLarge: true } instead of computing.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  renderUnifiedDiff,
  MAX_DIFF_LINES,
  MAX_DIFF_BYTES,
} from '../src/lib/diff.js'

describe('diff size guard', () => {
  it('renders a normal small diff unchanged (happy path)', () => {
    const r = renderUnifiedDiff('SKILL.md', 'a', 'b', '# v1\nold\n', '# v1\nnew\n')
    assert.equal(r.tooLarge, false)
    if (r.tooLarge) return
    assert.match(r.diff, /^--- a\/SKILL\.md@a/)
    assert.match(r.diff, /-old/)
    assert.match(r.diff, /\+new/)
  })

  it('identical content yields an empty (no-hunk) diff, not too-large', () => {
    const r = renderUnifiedDiff('SKILL.md', 'a', 'b', 'same\n', 'same\n')
    assert.equal(r.tooLarge, false)
  })

  it('just-UNDER the line cap still renders', () => {
    const lines = MAX_DIFF_LINES // exactly at the cap (not over)
    const from = Array.from({ length: lines }, (_, i) => `line ${i}`).join('\n') + '\n'
    const to = from.replace('line 0', 'line CHANGED')
    const r = renderUnifiedDiff('big.txt', 'a', 'b', from, to)
    assert.equal(r.tooLarge, false, 'at the cap must still render')
  })

  it('just-OVER the line cap trips the guard (no allocation)', () => {
    const lines = MAX_DIFF_LINES + 1
    const from = Array.from({ length: lines }, (_, i) => `line ${i}`).join('\n') + '\n'
    const to = from + 'extra\n'
    const r = renderUnifiedDiff('big.txt', 'a', 'b', from, to)
    assert.equal(r.tooLarge, true)
  })

  it('just-OVER the byte cap trips the guard even with few lines (giant line)', () => {
    const giant = 'x'.repeat(MAX_DIFF_BYTES + 1) // single line, over the byte cap
    const r = renderUnifiedDiff('blob.txt', 'a', 'b', giant, giant + 'y')
    assert.equal(r.tooLarge, true)
  })

  it('worst-case ~25MB pair returns fast and bounded (covers the finding)', () => {
    // Two large text "files". Without the guard this allocates a ~10^14-entry
    // LCS table; with it, renderUnifiedDiff must return immediately.
    const huge = ('a\n').repeat(2_000_000) // ~4 MB, ~2M lines per side
    const other = ('b\n').repeat(2_000_000)
    const start = Date.now()
    const r = renderUnifiedDiff('huge.txt', 'a', 'b', huge, other)
    const elapsed = Date.now() - start
    assert.equal(r.tooLarge, true)
    assert.ok(elapsed < 1000, `guard must return fast, took ${elapsed}ms`)
  })
})
