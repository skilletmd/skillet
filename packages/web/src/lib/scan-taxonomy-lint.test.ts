import { describe, it, expect } from 'vitest'
import {
  lintTaxonomy,
  isMachineTag,
  type Vocabulary,
  type DetectorManifest,
} from './scan-taxonomy-lint'
import { SCAN_VOCABULARY } from '@skillet/protocol'
import type { ScanVocabularyEntry } from '@skillet/protocol'
import manifest from './scan-detector-inventory.json'

function flag(id: string, o: Partial<ScanVocabularyEntry> = {}): ScanVocabularyEntry {
  return {
    id,
    kind: 'flag',
    label: o.label ?? id,
    describe: o.describe ?? 'A clear, well-formed sentence about it.',
    fix: o.fix ?? 'Do the obvious thing here.',
    permission: o.permission,
  }
}

function perm(id: string, o: Partial<ScanVocabularyEntry> = {}): ScanVocabularyEntry {
  return {
    id,
    kind: 'permission',
    label: o.label ?? id,
    describe: o.describe ?? 'A clear, well-formed sentence about it.',
  }
}

function vocab(...entries: ScanVocabularyEntry[]): Vocabulary {
  return Object.fromEntries(entries.map((e) => [e.id, e]))
}

const emptyManifest: DetectorManifest = { threatCategories: {}, capabilities: [], partialDetectors: [] }

describe('isMachineTag', () => {
  it('flags family:detail tags, not prose', () => {
    expect(isMachineTag('risky-call:js-child-process-spawn-sync')).toBe(true)
    expect(isMachineTag('injection:ignore-previous')).toBe(true)
    expect(isMachineTag('Text that could hijack an agent.')).toBe(false)
    expect(isMachineTag('reads-secrets')).toBe(false) // no colon → not a tag
  })
})

describe('lintTaxonomy — copy quality', () => {
  it('flags a missing fix on a flag with a write-a-fix suggestion', () => {
    const v = vocab(flag('foo', { describe: 'A clear sentence about foo here.', fix: '' }))
    const out = lintTaxonomy(v, emptyManifest)
    const f = out.find((x) => x.target === 'flag:foo' && /Missing fix/.test(x.issue))
    expect(f).toBeTruthy()
    expect(f!.severity).toBe('error')
    expect(f!.suggestion).toMatch(/how to fix/i)
  })

  it('does not demand a fix on a permission entry (installer-voice only)', () => {
    const v = vocab(perm('runs-shell'))
    const m: DetectorManifest = { threatCategories: {}, capabilities: ['runs-shell'], partialDetectors: [] }
    const out = lintTaxonomy(v, m)
    expect(out.some((x) => /Missing fix/.test(x.issue))).toBe(false)
  })

  it('a clean, fully-backed entry produces zero findings', () => {
    const v = vocab(flag('ok', { describe: 'A clear, well-formed sentence about it.', fix: 'Do the obvious thing here.' }))
    const m: DetectorManifest = {
      threatCategories: { ok: { detectors: ['x'], whyTags: ['ok:x'] } },
      capabilities: [],
      partialDetectors: [],
    }
    expect(lintTaxonomy(v, m)).toEqual([])
  })

  it('flags a length/tone outlier (a describe far over the median)', () => {
    const v = vocab(
      flag('a', { describe: 'Short and clean enough.', fix: 'Fix it cleanly here.' }),
      flag('b', { describe: 'Also short and tidy here.', fix: 'Fix it cleanly here.' }),
      flag('big', { describe: 'This describe runs on far longer than its siblings '.repeat(4) + 'and keeps going past the median.', fix: 'Fix it cleanly here.' }),
    )
    const out = lintTaxonomy(v, emptyManifest)
    expect(out.some((x) => x.target === 'flag:big' && /median/.test(x.issue))).toBe(true)
  })
})

describe('lintTaxonomy — coverage cross-reference', () => {
  it('errors on an emitted threat category with no vocabulary entry (AE5)', () => {
    const v = vocab(flag('injection', { label: 'Prompt injection', describe: 'Text that could hijack an agent here.', fix: 'Reword it for the user.' }))
    const m: DetectorManifest = {
      threatCategories: { 'tool-misuse': { detectors: ['shell-true'], whyTags: ['tool-misuse:shell-true'] } },
      capabilities: [],
      partialDetectors: [],
    }
    const out = lintTaxonomy(v, m)
    expect(
      out.some((x) => x.target === 'flag:tool-misuse' && x.severity === 'error' && /no vocabulary entry/.test(x.issue)),
    ).toBe(true)
  })

  it('errors on an emitted capability with no vocabulary entry', () => {
    const v = vocab(perm('runs-shell'))
    const m: DetectorManifest = { threatCategories: {}, capabilities: ['network'], partialDetectors: [] }
    const out = lintTaxonomy(v, m)
    expect(
      out.some((x) => x.target === 'permission:network' && x.severity === 'error' && /no vocabulary entry/.test(x.issue)),
    ).toBe(true)
  })

  it('errors on a vocabulary entry that no detector emits (dangling flag)', () => {
    const v = vocab(flag('orphan', { describe: 'Copy with nothing behind it here.', fix: 'Confirm or remove it.' }))
    const out = lintTaxonomy(v, emptyManifest)
    expect(
      out.some((x) => x.target === 'flag:orphan' && x.severity === 'error' && /no detector emits/.test(x.issue)),
    ).toBe(true)
  })

  it('does not flag an emitted entry as an orphan', () => {
    const v = vocab(flag('injection', { label: 'Prompt injection', describe: 'Text that could hijack an agent here.', fix: 'Reword it for the user.' }))
    const m: DetectorManifest = {
      threatCategories: { injection: { detectors: ['ignore-previous'], whyTags: ['injection:ignore-previous'] } },
      capabilities: [],
      partialDetectors: [],
    }
    const out = lintTaxonomy(v, m)
    expect(out.some((x) => x.target === 'flag:injection' && /no detector emits/.test(x.issue))).toBe(false)
  })

  it('reports partial detectors as an info finding', () => {
    const m: DetectorManifest = { threatCategories: { 'risky-call': { detectors: [], whyTags: [] } }, capabilities: [], partialDetectors: ['risky-call'] }
    const v = vocab(flag('risky-call', { label: 'Run a shell command', describe: 'Runs or builds a shell command directly.', fix: 'Validate the input first here.' }))
    const out = lintTaxonomy(v, m)
    expect(out.some((x) => x.target === 'flag:risky-call' && x.severity === 'info' && /dynamically/.test(x.issue))).toBe(true)
  })
})

describe('lintTaxonomy — against the real vocabulary + committed manifest', () => {
  const out = lintTaxonomy(SCAN_VOCABULARY, manifest as DetectorManifest)

  it('the four previously-GENERIC categories now have real copy (no missing-copy finding)', () => {
    for (const id of ['output-handling', 'memory-poisoning', 'tool-misuse', 'rogue-agent']) {
      expect(
        out.some(
          (x) =>
            x.target === `flag:${id}` &&
            /no vocabulary entry|Missing describe|Missing fix|Missing label/.test(x.issue),
        ),
      ).toBe(false)
    }
  })

  it('has no dangling flags — every vocabulary entry is wired to a detector', () => {
    expect(out.some((x) => x.severity === 'error' && /no detector emits/.test(x.issue))).toBe(false)
  })

  it('reports risky-call as partial', () => {
    expect(out.some((x) => x.target === 'flag:risky-call' && /dynamically/.test(x.issue))).toBe(true)
  })

  it('has no coverage or copy errors — every emitted id is described, every entry well-formed', () => {
    expect(out.some((x) => x.severity === 'error')).toBe(false)
  })
})
