import { describe, it, expect } from 'vitest'
import {
  buildScannerAudit,
  labScannerBlocked,
  realVocabulary,
} from './scanner-audit'
import type { DetectorManifest } from '@/lib/scan-taxonomy-lint'
import manifest from '@/lib/scan-detector-inventory.json'
import { PERMISSION_ORDER, FLAGS } from '@skillet/protocol'

describe('labScannerBlocked', () => {
  it('blocks production and allows dev/test', () => {
    expect(labScannerBlocked('production')).toBe(true)
    expect(labScannerBlocked('development')).toBe(false)
    expect(labScannerBlocked('test')).toBe(false)
    expect(labScannerBlocked(undefined)).toBe(false)
  })
})

describe('buildScannerAudit — real vocabulary + committed manifest', () => {
  const audit = buildScannerAudit(realVocabulary(), manifest as DetectorManifest)

  it('renders the 7 permissions in canonical chip order', () => {
    expect(audit.permissions.map((p) => p.id)).toEqual([...PERMISSION_ORDER])
  })

  it('renders every flag from the vocabulary', () => {
    expect(audit.flags).toHaveLength(Object.keys(FLAGS).length)
  })

  it('cross-references emitting detectors for a covered flag', () => {
    const injection = audit.flags.find((f) => f.id === 'injection')
    expect(injection?.emitted).toBe(true)
    expect(injection?.detectors.length).toBeGreaterThan(0)
  })

  it('has no dangling flags — every vocabulary flag is emitted by a detector', () => {
    expect(audit.flags.every((f) => f.emitted || f.partial)).toBe(true)
    expect(
      audit.flags.flatMap((f) => f.findings).some((x) => /no detector emits/.test(x.issue)),
    ).toBe(false)
  })

  it('marks the partial (dynamic-why) detector', () => {
    const riskyCall = audit.flags.find((f) => f.id === 'risky-call')
    expect(riskyCall?.partial).toBe(true)
  })

  it('every permission carries copy and is emitted by a detector', () => {
    for (const p of audit.permissions) {
      expect(p.label.length).toBeGreaterThan(0)
      expect(p.describe.length).toBeGreaterThan(0)
      expect(p.emitted).toBe(true)
    }
  })

  it('summary counts equal the flattened findings', () => {
    const flattened =
      audit.permissions.flatMap((p) => p.findings).length +
      audit.flags.flatMap((f) => f.findings).length
    expect(audit.summary.total).toBe(flattened)
    expect(audit.summary.error + audit.summary.warn + audit.summary.info).toBe(audit.summary.total)
  })
})

describe('buildScannerAudit — fixture', () => {
  it('attaches the orphan finding to the offending permission row', () => {
    const m: DetectorManifest = {
      threatCategories: { injection: { detectors: ['ignore-previous'], whyTags: ['injection:ignore-previous'] } },
      capabilities: ['network'],
      partialDetectors: [],
    }
    const audit = buildScannerAudit(realVocabulary(), m)
    const net = audit.permissions.find((p) => p.id === 'network')
    expect(net?.emitted).toBe(true)
    const shell = audit.permissions.find((p) => p.id === 'runs-shell')
    expect(shell?.emitted).toBe(false)
    expect(shell?.findings.some((f) => /no detector emits/.test(f.issue))).toBe(true)
  })
})
