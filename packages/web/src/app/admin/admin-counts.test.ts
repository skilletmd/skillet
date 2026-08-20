import { describe, expect, it } from 'vitest'
import { deriveAdminCounts } from './admin-counts'

describe('deriveAdminCounts', () => {
  it('counts pending mirror candidates and open report groups', () => {
    const counts = deriveAdminCounts(
      { pending: [{ id: 'a' }, { id: 'b' }], recent: [] },
      { groups: [{ skill_id: '1' }, { skill_id: '2' }, { skill_id: '3' }] },
    )
    expect(counts).toEqual({ pendingMirror: 2, openReports: 3 })
  })

  it('treats a failed fetch (null) as an unknown count, not zero', () => {
    expect(deriveAdminCounts(null, null)).toEqual({ pendingMirror: null, openReports: null })
  })

  it('is null when the payload lacks the expected array shape', () => {
    expect(deriveAdminCounts({ error: 'nope' }, { groups: 'oops' })).toEqual({
      pendingMirror: null,
      openReports: null,
    })
  })

  it('reports zero when the arrays are present but empty', () => {
    expect(deriveAdminCounts({ pending: [] }, { groups: [] })).toEqual({
      pendingMirror: 0,
      openReports: 0,
    })
  })
})
