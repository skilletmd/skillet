import { describe, it, expect } from 'vitest'
import { deriveEditedSkills } from '../src/commands/report-device-agents.js'
import type { SkillEntry } from '../src/kit/types.js'

/** Minimal SkillEntry for the fields deriveEditedSkills reads (slug/owner/lineage). */
function entry(partial: Partial<SkillEntry>): SkillEntry {
  return {
    slug: 'refund',
    name: 'Refund',
    description: '',
    version: 3,
    hash: 'sha256:live',
    source: 'registry',
    importedAt: '2026-07-04T00:00:00Z',
    updatedAt: '2026-07-04T00:00:00Z',
    ...partial,
  } as SkillEntry
}

const lineage = { author: 'you', slug: 'refund', version: 2, hash: 'sha256:baseline' }

describe('deriveEditedSkills', () => {
  it('reports a customized skill with ref + baseline version + baseline hash and NOTHING else', () => {
    const edited = deriveEditedSkills({
      '@you/refund': entry({ owner: 'you', slug: 'refund', customized_from: lineage }),
    })
    expect(edited).toEqual([
      { ref: '@you/refund', baselineVersion: '2', baselineHash: 'sha256:baseline' },
    ])
    // Privacy invariant (R2): only these three keys ever leave the machine.
    expect(Object.keys(edited[0]!).sort()).toEqual(['baselineHash', 'baselineVersion', 'ref'])
  })

  it('omits a skill once customized_from is cleared (take-theirs / restore) — clears by absence', () => {
    const edited = deriveEditedSkills({
      '@you/refund': entry({ owner: 'you', slug: 'refund' }), // customized_from cleared
    })
    expect(edited).toEqual([])
  })

  it('never reports a clean (uncustomized) skill', () => {
    const edited = deriveEditedSkills({
      '@you/clean': entry({ owner: 'you', slug: 'clean' }),
      '@them/other': entry({ owner: 'them', slug: 'other' }),
    })
    expect(edited).toEqual([])
  })

  it('reports only the customized entries in a mixed state', () => {
    const edited = deriveEditedSkills({
      '@you/refund': entry({ owner: 'you', slug: 'refund', customized_from: lineage }),
      '@you/clean': entry({ owner: 'you', slug: 'clean' }),
    })
    expect(edited).toEqual([
      { ref: '@you/refund', baselineVersion: '2', baselineHash: 'sha256:baseline' },
    ])
  })

  it('builds an @owner/slug ref from owner + slug when the state key is bare', () => {
    const edited = deriveEditedSkills({
      refund: entry({ owner: 'you', slug: 'refund', customized_from: lineage }),
    })
    expect(edited[0]!.ref).toBe('@you/refund')
  })

  it('falls back to the bare state key when the entry is unowned', () => {
    const edited = deriveEditedSkills({
      'my-local': entry({ owner: null, slug: 'my-local', source: 'local', customized_from: lineage }),
    })
    expect(edited[0]!.ref).toBe('my-local')
  })

  it('carries no filenames, counts, or content anywhere in the payload', () => {
    const edited = deriveEditedSkills({
      '@you/refund': entry({ owner: 'you', slug: 'refund', customized_from: lineage }),
    })
    const serialized = JSON.stringify(edited)
    expect(serialized).not.toContain('SKILL.md')
    expect(serialized).not.toMatch(/count|file|content|body/i)
  })
})
