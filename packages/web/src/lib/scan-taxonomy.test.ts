import { describe, it, expect } from 'vitest'
import {
  findingCategory,
  findingCapability,
  findingShape,
  capabilityLabel,
  capabilityDescribe,
  GENERIC,
} from './scan-taxonomy'
import { FLAGS } from '@skillet/protocol'

describe('findingCategory', () => {
  it('resolves real copy for every FLAGS id (direct id lookup, no GENERIC)', () => {
    for (const id of Object.keys(FLAGS)) {
      const meta = findingCategory(id)
      expect(meta.label).toBe(FLAGS[id].label)
      expect(meta.describe).toBe(FLAGS[id].describe)
      expect(meta.describe).not.toBe(GENERIC.describe)
    }
  })

  it('resolves tool-misuse to its real copy (it fell back to GENERIC before U3)', () => {
    expect(findingCategory('tool-misuse').label).toBe('Disable a safety check')
  })

  it('falls back to GENERIC only for an id absent from the vocabulary', () => {
    const meta = findingCategory('totally-unknown-xyz')
    expect(meta.describe).toBe(GENERIC.describe)
    expect(meta.fix).toBe(GENERIC.fix)
    expect(meta.label).toBe('Totally Unknown Xyz')
  })
})

describe('findingCapability', () => {
  it('returns the permission tag for action flags', () => {
    expect(findingCapability('risky-call')).toBe('runs-shell')
    expect(findingCapability('destructive')).toBe('deletes-files')
  })

  it('returns null for a standalone flag (exfil) and an unknown id', () => {
    expect(findingCapability('exfil')).toBeNull()
    expect(findingCapability('nope-not-real')).toBeNull()
  })
})

describe('findingShape', () => {
  it('reads action vs content off the vocabulary tag', () => {
    expect(findingShape('exfil')).toBe('action')
    expect(findingShape('destructive')).toBe('action')
    expect(findingShape('injection')).toBe('content')
    expect(findingShape('secret')).toBe('content')
  })

  it('defaults an unknown id to content (quiet note, not a fake capability)', () => {
    expect(findingShape('nope-not-real')).toBe('content')
  })
})

describe('capability copy', () => {
  it('reads label + describe from the PERMISSIONS vocabulary', () => {
    expect(capabilityLabel('runs-shell')).toBe('Run commands')
    expect(capabilityDescribe('network')).toMatch(/Connects to the internet/i)
  })

  it('falls back readably for an unknown capability key', () => {
    expect(capabilityLabel('new-key')).toBe('New Key')
    expect(capabilityDescribe('new-key')).toBeNull()
  })
})
