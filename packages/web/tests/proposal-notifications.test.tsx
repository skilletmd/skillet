import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PendingProposalsBadge } from '@/components/pending-proposals-badge'
import { ProposalNotice, OwnerProposalAlerts } from '@/components/owner-proposal-alerts'
import type { ProposalSummary } from '@/lib/types'

const mockFetch = vi.fn()
vi.mock('@/lib/proposals', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/proposals')>()
  return { ...actual, fetchSkillProposals: (...args: unknown[]) => mockFetch(...args) }
})

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

afterEach(() => {
  mockFetch.mockReset()
})

describe('PendingProposalsBadge', () => {
  it('renders nothing at zero', () => {
    const { container } = render(<PendingProposalsBadge count={0} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders a singular label for one pending proposal', () => {
    render(<PendingProposalsBadge count={1} />)
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', '1 proposal pending')
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('renders a plural count', () => {
    render(<PendingProposalsBadge count={4} />)
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', '4 proposals pending')
    expect(screen.getByText('4')).toBeInTheDocument()
  })
})

describe('ProposalNotice', () => {
  it('is one compact pill that links to the review page, carrying the count', () => {
    render(
      <ProposalNotice
        author="taylor"
        slug="deploy-ritual"
        pending={[
          summary({ proposal_id: 'p1', proposer: 'marco' }),
          summary({ proposal_id: 'p2', proposer: 'ada' }),
        ]}
      />,
    )
    expect(screen.getByText('Review changes')).toBeInTheDocument()
    // One link (to the review page) — not a row per proposal — focused on the
    // first/most-urgent one; the page lists them all.
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute('href', '/taylor/deploy-ritual/review?proposal=p1')
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', '2 proposals pending')
  })

  it('uses a singular label for one proposal', () => {
    render(<ProposalNotice author="taylor" slug="deploy-ritual" pending={[summary()]} />)
    expect(screen.getByText('Review change')).toBeInTheDocument()
  })

  it('makes a quarantined verdict unmissable (AC mirrors #3)', () => {
    render(
      <ProposalNotice
        author="taylor"
        slug="deploy-ritual"
        pending={[summary({ scan: { status: 'quarantined' } })]}
      />,
    )
    expect(screen.getByText(/needs attention/i)).toBeInTheDocument()
  })

  it('stays calm (no danger flag) for a clean pending change', () => {
    render(<ProposalNotice author="taylor" slug="deploy-ritual" pending={[summary()]} />)
    expect(screen.queryByText(/needs attention/i)).not.toBeInTheDocument()
  })
})

describe('OwnerProposalAlerts', () => {
  it('renders the notice for an owner with a pending proposal (AC #1, #2)', async () => {
    mockFetch.mockResolvedValue({ kind: 'ok', proposals: [summary()] })
    render(<OwnerProposalAlerts author="taylor" slug="deploy-ritual" />)
    expect(await screen.findByRole('link')).toHaveAttribute(
      'href',
      '/taylor/deploy-ritual/review?proposal=p1',
    )
  })

  it('renders nothing for a non-owner (endpoint answered unauthorized)', async () => {
    mockFetch.mockResolvedValue({ kind: 'unauthorized' })
    const { container } = render(<OwnerProposalAlerts author="taylor" slug="deploy-ritual" />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    await waitFor(() => expect(container.querySelector('[aria-hidden="true"]')).toBeNull())
    expect(screen.queryByLabelText('Pending proposals')).not.toBeInTheDocument()
  })

  it('renders nothing when every proposal has already been decided', async () => {
    mockFetch.mockResolvedValue({
      kind: 'ok',
      proposals: [summary({ state: 'approved' }), summary({ state: 'rejected' })],
    })
    render(<OwnerProposalAlerts author="taylor" slug="deploy-ritual" />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    expect(screen.queryByLabelText('Pending proposals')).not.toBeInTheDocument()
  })

  it('stays silent on a load error rather than breaking the public page', async () => {
    mockFetch.mockResolvedValue({ kind: 'error' })
    render(<OwnerProposalAlerts author="taylor" slug="deploy-ritual" />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    expect(screen.queryByLabelText('Pending proposals')).not.toBeInTheDocument()
  })
})
