import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProposalSummary } from '@/lib/types'
import { pendingOnly, reviewSurfaceHref } from '@/lib/proposals'

function summary(over: Partial<ProposalSummary> = {}): ProposalSummary {
  return {
    proposal_id: 'p1',
    skill_id: 'taylor:deploy-ritual',
    base_hash: 'base',
    proposed_hash: 'prop',
    state: 'pending',
    proposer: 'marco',
    created_at: 1_700_000_000,
    decided_by: null,
    decided_at: null,
    decision_note: null,
    proposal_url: '/api/v1/skills/taylor/deploy-ritual/proposals/p1',
    scan: { status: 'clean' },
    ...over,
  }
}

describe('pendingOnly', () => {
  it('keeps only pending proposals and drops decided ones', () => {
    const list = [
      summary({ proposal_id: 'a', state: 'pending' }),
      summary({ proposal_id: 'b', state: 'approved' }),
      summary({ proposal_id: 'c', state: 'rejected' }),
      summary({ proposal_id: 'd', state: 'changes_requested' }),
      summary({ proposal_id: 'e', state: 'pending' }),
    ]
    expect(pendingOnly(list).map((p) => p.proposal_id)).toEqual(['a', 'e'])
  })

  it('returns an empty array when nothing is pending', () => {
    expect(pendingOnly([summary({ state: 'approved' })])).toEqual([])
  })
})

describe('reviewSurfaceHref', () => {
  it('links to the dedicated review page for the skill', () => {
    expect(reviewSurfaceHref('taylor', 'deploy-ritual')).toBe('/taylor/deploy-ritual/review')
  })

  it('focuses a specific proposal via query param', () => {
    expect(reviewSurfaceHref('taylor', 'deploy-ritual', 'p 1')).toBe(
      '/taylor/deploy-ritual/review?proposal=p%201',
    )
  })
})

describe('fetchSkillProposals', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('reports unauthorized when no registry is configured (never fabricates)', async () => {
    vi.stubEnv('NEXT_PUBLIC_REGISTRY_URL', '')
    vi.resetModules()
    const { fetchSkillProposals } = await import('@/lib/proposals')
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    expect(await fetchSkillProposals('taylor', 'deploy-ritual')).toEqual({ kind: 'unauthorized' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns proposals on a 200 and sends the session cookie', async () => {
    vi.stubEnv('NEXT_PUBLIC_REGISTRY_URL', 'https://reg.example')
    vi.resetModules()
    const { fetchSkillProposals } = await import('@/lib/proposals')
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ proposals: [summary()] }),
    })
    vi.stubGlobal('fetch', fetchSpy)

    const result = await fetchSkillProposals('taylor', 'deploy-ritual')
    expect(result).toEqual({ kind: 'ok', proposals: [summary()] })
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/registry/api/v1/skills/taylor/deploy-ritual/proposals',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('maps 401/403 to unauthorized (viewer is not the owner)', async () => {
    vi.stubEnv('NEXT_PUBLIC_REGISTRY_URL', 'https://reg.example')
    vi.resetModules()
    const { fetchSkillProposals } = await import('@/lib/proposals')
    for (const status of [401, 403]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status }))
      expect(await fetchSkillProposals('taylor', 'deploy-ritual')).toEqual({ kind: 'unauthorized' })
    }
  })

  it('maps other non-OK statuses to error', async () => {
    vi.stubEnv('NEXT_PUBLIC_REGISTRY_URL', 'https://reg.example')
    vi.resetModules()
    const { fetchSkillProposals } = await import('@/lib/proposals')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    expect(await fetchSkillProposals('taylor', 'deploy-ritual')).toEqual({
      kind: 'error',
      status: 500,
    })
  })

  it('maps a network failure to error', async () => {
    vi.stubEnv('NEXT_PUBLIC_REGISTRY_URL', 'https://reg.example')
    vi.resetModules()
    const { fetchSkillProposals } = await import('@/lib/proposals')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    expect(await fetchSkillProposals('taylor', 'deploy-ritual')).toEqual({ kind: 'error' })
  })
})
