import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react'
import { FileDiff } from '@/components/file-diff'
import { ProposedChanges } from '@/components/proposed-changes'
import type { ProposalDetail, ProposalFileDiff, ProposalSummary } from '@/lib/types'

const fetchSkillProposals = vi.fn()
const fetchProposalDetail = vi.fn()
const submitProposalDecision = vi.fn()
const signContentHashForProposal = vi.fn()

vi.mock('@/lib/proposal-signing', () => ({
  signContentHashForProposal: (...a: unknown[]) => signContentHashForProposal(...a),
}))

vi.mock('@/lib/proposals', async () => {
  const actual = await vi.importActual<typeof import('@/lib/proposals')>('@/lib/proposals')
  return {
    ...actual,
    fetchSkillProposals: (...a: unknown[]) => fetchSkillProposals(...a),
    fetchProposalDetail: (...a: unknown[]) => fetchProposalDetail(...a),
    submitProposalDecision: (...a: unknown[]) => submitProposalDecision(...a),
  }
})

function summary(overrides: Partial<ProposalSummary> = {}): ProposalSummary {
  return {
    proposal_id: 'prop_1',
    skill_id: 'taylor:deploy-ritual',
    base_hash: 'sha256:1a2b3c4d5e6f',
    proposed_hash: 'sha256:9f8e7d6c5b4a',
    state: 'pending',
    proposer: 'deploy-bot',
    created_at: Math.floor(new Date('2026-06-13T20:00:00Z').getTime() / 1000),
    decided_by: null,
    decided_at: null,
    decision_note: null,
    proposal_url: '/api/v1/skills/taylor/deploy-ritual/proposals/prop_1',
    scan: { status: 'clean' },
    ...overrides,
  }
}

function detail(overrides: Partial<ProposalDetail> = {}): ProposalDetail {
  return {
    proposal_id: 'prop_1',
    skill_id: 'taylor:deploy-ritual',
    base_hash: 'sha256:1a2b3c4d5e6f',
    proposed_hash: 'sha256:9f8e7d6c5b4a',
    state: 'pending',
    proposer: { handle: 'deploy-bot', author_key_id: 'ed25519:abc…123', author_public_key: 'pk' },
    signature: { alg: 'ed25519', key_id: 'ed25519:abc…123', sig: 'b64' },
    created_at: Math.floor(new Date('2026-06-13T20:00:00Z').getTime() / 1000),
    decided_by: null,
    decided_at: null,
    decision_note: null,
    scan: { status: 'clean' },
    // The client fails closed on a missing flag, so the baseline fixture
    // models a current registry that grants the viewer decision rights.
    can_decide: true,
    diff: [
      {
        path: 'SKILL.md',
        status: 'modified',
        binary: false,
        diff: ['@@ -1,2 +1,3 @@', ' intro', '-old line', '+new line', '+extra line'].join('\n'),
      },
    ],
    ...overrides,
  }
}

/** Two changed files — FileDiff only renders collapse rows for multi-file diffs. */
const TWO_FILES: ProposalFileDiff[] = [
  {
    path: 'SKILL.md',
    status: 'modified',
    binary: false,
    diff: ['@@ -1,2 +1,3 @@', ' intro', '-old line', '+new line', '+extra line'].join('\n'),
  },
  {
    path: 'scripts/run.sh',
    status: 'modified',
    binary: false,
    diff: ['@@ -1,1 +1,1 @@', '-set +e', '+set -e'].join('\n'),
  },
]

/** Default: one pending proposal whose detail loads. */
function wireOnePending(d: ProposalDetail = detail(), s: ProposalSummary = summary()) {
  fetchSkillProposals.mockResolvedValue({ kind: 'ok', proposals: [s] })
  fetchProposalDetail.mockResolvedValue({ kind: 'ok', proposal: d })
}

async function renderSurface() {
  await act(async () => {
    render(<ProposedChanges author="taylor" slug="deploy-ritual" />)
  })
}

beforeEach(() => {
  fetchSkillProposals.mockReset()
  fetchProposalDetail.mockReset()
  submitProposalDecision.mockReset()
  signContentHashForProposal.mockReset()
  signContentHashForProposal.mockResolvedValue({
    alg: 'ed25519',
    key_id: 'test-key',
    sig: 'test-sig',
  })
})

describe('ProposedChanges', () => {
  it('renders nothing for non-owners / unauthorized viewers', async () => {
    fetchSkillProposals.mockResolvedValue({ kind: 'unauthorized' })
    await renderSurface()
    await waitFor(() => expect(fetchSkillProposals).toHaveBeenCalled())
    expect(screen.queryByRole('heading', { name: 'Proposed changes' })).not.toBeInTheDocument()
  })

  it('renders nothing for an authorized owner with no pending proposals', async () => {
    fetchSkillProposals.mockResolvedValue({ kind: 'ok', proposals: [] })
    await renderSurface()
    await waitFor(() => expect(fetchSkillProposals).toHaveBeenCalled())
    expect(screen.queryByRole('heading', { name: 'Proposed changes' })).not.toBeInTheDocument()
  })

  it('renders an error state when the proposal detail fails to load', async () => {
    fetchSkillProposals.mockResolvedValue({ kind: 'ok', proposals: [summary()] })
    fetchProposalDetail.mockResolvedValue({ kind: 'error' })
    await renderSurface()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Could not load the proposal detail/i,
    )
  })

  it('renders proposer identity and a plain safety line', async () => {
    wireOnePending()
    await renderSurface()
    expect(await screen.findByText('deploy-bot')).toBeInTheDocument()
    expect(screen.getByText(/wants to update this skill/i)).toBeInTheDocument()
    // No hashes or key ids on the surface — one plain "looks safe" line instead.
    expect(screen.getByText(/Looks safe/i)).toBeInTheDocument()
    expect(screen.queryByText('9f8e7d6c5b4a')).not.toBeInTheDocument()
  })

  it('shows a single-file diff inline with a count header and marker-stripped text', async () => {
    wireOnePending()
    await renderSurface()
    await screen.findByText('deploy-bot')
    expect(screen.getByText((_c, el) => el?.textContent === '1 file changed')).toBeInTheDocument()
    // One file: FileDiff skips the collapse row and shows the change directly.
    // The +/− lives in an aria-hidden gutter, never in the copyable line text.
    expect(screen.getByText('new line')).toBeInTheDocument()
    expect(screen.getByText('old line')).toBeInTheDocument()
    expect(screen.queryByText('+new line')).not.toBeInTheDocument()
    expect(screen.queryByText('-old line')).not.toBeInTheDocument()
  })

  it('collapses multi-file diffs behind per-file aria-expanded rows', async () => {
    wireOnePending(detail({ diff: TWO_FILES }))
    await renderSurface()
    await screen.findByText('deploy-bot')
    expect(screen.getByText((_c, el) => el?.textContent === '2 files changed')).toBeInTheDocument()
    const fileToggle = screen.getByRole('button', { name: /SKILL\.md/ })
    expect(fileToggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('new line')).not.toBeInTheDocument()
    fireEvent.click(fileToggle)
    expect(fileToggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('new line')).toBeInTheDocument()
  })

  it('renders the same per-file structure as the update-card surface (AE3 parity)', async () => {
    wireOnePending(detail({ diff: TWO_FILES }))
    let review: HTMLElement | null = null
    await act(async () => {
      review = render(<ProposedChanges author="taylor" slug="deploy-ritual" />).container
    })
    await screen.findByText('deploy-bot')
    // Open every file row on the review surface so both surfaces show the bodies.
    for (const toggle of within(review!).getAllByRole('button', { expanded: false })) {
      fireEvent.click(toggle)
    }
    // The update card mounts the shared FileDiff expanded with no count header.
    const card = render(
      <FileDiff files={TWO_FILES} defaultExpanded showCountHeader={false} />,
    ).container
    const fileRows = (root: HTMLElement) =>
      Array.from(root.querySelectorAll('li')).map((li) => li.textContent)
    expect(fileRows(review!)).toHaveLength(2)
    expect(fileRows(review!)).toEqual(fileRows(card))
  })

  it('renders read-only when the registry says the viewer cannot decide', async () => {
    wireOnePending(detail({ can_decide: false }))
    await renderSurface()
    await screen.findByText('deploy-bot')
    expect(screen.getByText(/Only the skill owner can decide/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Approve & publish/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument()
  })

  it('enables the decision actions when can_decide is true', async () => {
    wireOnePending(detail({ can_decide: true }))
    await renderSurface()
    await screen.findByText('deploy-bot')
    expect(screen.getByRole('button', { name: /Approve & publish/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeEnabled()
    expect(screen.queryByText(/Only the skill owner can decide/i)).not.toBeInTheDocument()
  })

  it('renders read-only when the registry omits can_decide (fail closed)', async () => {
    const d = detail()
    delete d.can_decide
    wireOnePending(d)
    await renderSurface()
    await screen.findByText('deploy-bot')
    expect(screen.getByText(/Only the skill owner can decide/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Approve & publish/i })).not.toBeInTheDocument()
  })

  it('lets the owner approve through an inline confirm', async () => {
    wireOnePending()
    submitProposalDecision.mockResolvedValue({
      state: 'approved',
      version_hash: 'sha256:9f8e7d6c5b4a',
    })
    await renderSurface()
    await screen.findByText('deploy-bot')

    fireEvent.click(screen.getByRole('button', { name: /Approve & publish/i }))
    expect(screen.getByText(/becomes the current version/i)).toBeInTheDocument()
    expect(submitProposalDecision).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    })
    expect(signContentHashForProposal).toHaveBeenCalledWith('sha256:9f8e7d6c5b4a')
    expect(submitProposalDecision).toHaveBeenCalledWith(
      'taylor',
      'deploy-ritual',
      'prop_1',
      'approve',
      expect.objectContaining({
        signature: { alg: 'ed25519', key_id: 'test-key', sig: 'test-sig' },
      }),
    )
    expect(await screen.findByText(/Everyone who installed this skill gets the update/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /View skill/i })).toHaveAttribute(
      'href',
      '/taylor/deploy-ritual',
    )
  })

  it('blocks approve and surfaces the verdict when the scan is quarantined', async () => {
    wireOnePending(
      detail({
        scan: { status: 'quarantined', findings_summary: { total: 1, highest_confidence: 'high' } },
      }),
    )
    await renderSurface()
    await screen.findByText('deploy-bot')

    expect(screen.getByRole('button', { name: /Approve & publish/i })).toBeDisabled()
    expect(screen.getByText(/found a serious problem/i)).toBeInTheDocument()
    expect(screen.getByText(/blocked this change/i)).toBeInTheDocument()
    expect(screen.getByText(/highest confidence: high/i)).toBeInTheDocument()
  })

  it('allows approve when flagged but surfaces the risk (flagged is human-approvable)', async () => {
    wireOnePending(detail({ scan: { status: 'flagged', findings_summary: { total: 2 } } }))
    await renderSurface()
    await screen.findByText('deploy-bot')

    expect(screen.getByRole('button', { name: /Approve & publish/i })).toBeEnabled()
    expect(screen.getByText(/the security check flagged something/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Approve & publish/i }))
    expect(screen.getByText(/approving it anyway/i)).toBeInTheDocument()
  })

  it('disables approve while the scan is still pending', async () => {
    wireOnePending(detail({ scan: { status: 'pending' } }))
    await renderSurface()
    await screen.findByText('deploy-bot')
    expect(screen.getByRole('button', { name: /Approve & publish/i })).toBeDisabled()
    expect(screen.getByText(/still running/i)).toBeInTheDocument()
  })

  it('disables approve when the proposal is unsigned', async () => {
    wireOnePending(detail({ signature: null }))
    await renderSurface()
    await screen.findByText('deploy-bot')
    expect(screen.getByRole('button', { name: /Approve & publish/i })).toBeDisabled()
    expect(screen.getByText(/can.t be verified, so it can.t be published/i)).toBeInTheDocument()
  })

  it('offers only Approve and Reject — no request-changes affordance', async () => {
    wireOnePending()
    await renderSurface()
    await screen.findByText('deploy-bot')

    expect(screen.getByRole('button', { name: /Approve & publish/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Request changes/i })).not.toBeInTheDocument()
  })

  it('rejects through an inline confirm', async () => {
    wireOnePending()
    submitProposalDecision.mockResolvedValue({ state: 'rejected' })
    await renderSurface()
    await screen.findByText('deploy-bot')

    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Reject proposal' }))
    })
    expect(submitProposalDecision).toHaveBeenCalledWith(
      'taylor',
      'deploy-ritual',
      'prop_1',
      'reject',
      {},
    )
    expect(await screen.findByText(/Proposal rejected/i)).toBeInTheDocument()
  })

  it('surfaces the server reason when the decision is rejected by the backend', async () => {
    wireOnePending()
    const { ProposalDecisionError } = await import('@/lib/proposals')
    submitProposalDecision.mockRejectedValue(
      new ProposalDecisionError(
        'approve requires a signature field: the owner must sign the proposed_hash.',
        'signature_required',
      ),
    )
    await renderSurface()
    await screen.findByText('deploy-bot')

    fireEvent.click(screen.getByRole('button', { name: /Approve & publish/i }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    })
    await waitFor(() =>
      expect(screen.getByText(/owner must sign the proposed_hash/i)).toBeInTheDocument(),
    )
  })
})
