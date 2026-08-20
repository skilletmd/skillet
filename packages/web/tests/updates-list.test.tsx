import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'

const getMyUpdates = vi.fn()
const getMyRemovals = vi.fn()
const decideRemoval = vi.fn()
const approveAll = vi.fn()
const rejectAll = vi.fn()
const approveUpdate = vi.fn()
const rejectUpdate = vi.fn()
const getSkillDiff = vi.fn()
const setUpdateMode = vi.fn()

vi.mock('@/lib/account-updates', () => ({
  getMyUpdates: () => getMyUpdates(),
  getMyRemovals: () => getMyRemovals(),
  approveAll: () => approveAll(),
  rejectAll: () => rejectAll(),
  approveUpdate: (...a: unknown[]) => approveUpdate(...a),
  rejectUpdate: (...a: unknown[]) => rejectUpdate(...a),
  getSkillDiff: (...a: unknown[]) => getSkillDiff(...a),
  setUpdateMode: (m: string) => setUpdateMode(m),
  decideRemoval: (...a: unknown[]) => decideRemoval(...a),
}))

// Capture toast messages so we can assert the auto-on copy variants.
const { toastSpy } = vi.hoisted(() => ({ toastSpy: vi.fn() }))
vi.mock('@/components/ui/toast', async (importActual) => ({
  ...(await importActual<typeof import('@/components/ui/toast')>()),
  useToast: () => toastSpy,
}))

import { UpdatesList } from '@/components/notifications/updates-list'

const PENDING = {
  update_mode: 'manual' as const,
  pending: [
    {
      ref: 'alice/tool',
      skill_id: 'alice:tool',
      from_version: 1,
      to_version: 2,
      to_hash: 'sha256:b',
      release_note: null,
    },
  ],
  recently_applied: [
    {
      ref: 'bob/x',
      skill_id: 'bob:x',
      version_hash: 'sha256:c',
      source: 'auto' as const,
      decided_at: 1,
    },
  ],
}

// A second pending item, so the bulk Update all / Skip all actions render (they
// hide for a single update, which its own row already covers).
const SECOND_PENDING = {
  ref: 'carol/kit',
  skill_id: 'carol:kit',
  from_version: 3,
  to_version: 4,
  to_hash: 'sha256:d',
  release_note: null,
}
const TWO_PENDING = { ...PENDING, pending: [PENDING.pending[0], SECOND_PENDING] }

describe('UpdatesList (U11)', () => {
  beforeEach(() => {
    getMyUpdates.mockReset()
    getMyRemovals.mockReset().mockResolvedValue([])
    decideRemoval.mockReset().mockResolvedValue(undefined)
    approveAll.mockReset().mockResolvedValue(1)
    rejectAll.mockReset().mockResolvedValue(1)
    approveUpdate.mockReset().mockResolvedValue(undefined)
    rejectUpdate.mockReset().mockResolvedValue(undefined)
    setUpdateMode.mockReset().mockResolvedValue(1)
    toastSpy.mockReset()
  })

  it('lists pending updates and recently-applied', async () => {
    getMyUpdates.mockResolvedValue(PENDING)
    render(<UpdatesList />)
    expect(await screen.findByText('Tool')).toBeInTheDocument()
    // The generic "Content updated" fallback is trimmed from the card — only real
    // release notes get a line.
    expect(screen.queryByText('Content updated')).not.toBeInTheDocument()
    // @bob is the recently-applied author, still shown.
    expect(screen.getByText('@bob')).toBeInTheDocument()
    expect(screen.getByText('auto')).toBeInTheDocument()
    // No semver labels on the row (older registry) → integer fallback.
    expect(screen.getByText('v1 → v2')).toBeInTheDocument()
  })

  it('hides the "all caught up" panel when only edited skills are waiting', async () => {
    getMyUpdates.mockResolvedValue({
      update_mode: 'manual',
      pending: [],
      recently_applied: [],
      editedSkills: [
        {
          ref: 'openclaudia/serp-analyzer',
          skill_id: 'openclaudia:serp-analyzer',
          from_version_label: '1.0.0',
          to_version: 2,
          to_version_label: '1.1.0',
          to_hash: 'hash-new',
          baseline_hash: 'hash-old',
          category: null,
          author_name: 'OpenClaudia',
          author_avatar_url: null,
          devices: [{ device_id: 'd1', label: 'test-machine', last_seen_at: 1000, edited_at: 900 }],
        },
      ],
    })
    render(<UpdatesList />)
    expect(await screen.findByText(/edited these locally, so updates won.t overwrite them/i)).toBeInTheDocument()
    expect(screen.queryByText(/all caught up/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/No updates waiting for review/i)).not.toBeInTheDocument()
  })

  it('renders semver labels on the version arrow when the registry sends them', async () => {
    getMyUpdates.mockResolvedValue({
      ...PENDING,
      pending: [
        {
          ...PENDING.pending[0],
          from_version_label: '1.0.0',
          to_version_label: '2.1.0',
        },
      ],
    })
    render(<UpdatesList />)
    expect(await screen.findByText('v1.0.0 → v2.1.0')).toBeInTheDocument()
  })

  it('shows the release note as the change hint when present', async () => {
    getMyUpdates.mockResolvedValue({
      ...PENDING,
      pending: [{ ...PENDING.pending[0], release_note: 'Fixed the parser edge case.' }],
    })
    render(<UpdatesList />)
    expect(await screen.findByText('Fixed the parser edge case.')).toBeInTheDocument()
  })

  it('shows a new-skill hint when there is no prior version', async () => {
    getMyUpdates.mockResolvedValue({
      ...PENDING,
      pending: [{ ...PENDING.pending[0], from_version: null, to_version: 1, release_note: null }],
    })
    render(<UpdatesList />)
    expect(await screen.findByText('New skill')).toBeInTheDocument()
  })

  it('Update all approves and clears the pending list', async () => {
    getMyUpdates.mockResolvedValue(TWO_PENDING)
    render(<UpdatesList />)
    const btn = await screen.findByRole('button', { name: /update all/i })
    await userEvent.click(btn)
    expect(approveAll).toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByText('Tool')).not.toBeInTheDocument())
  })

  it('Skip all confirms first, then rejects and clears the pending list', async () => {
    getMyUpdates.mockResolvedValue(TWO_PENDING)
    render(<UpdatesList />)
    await screen.findByText('Tool')
    // Header button only opens the confirm dialog — nothing is skipped yet.
    await userEvent.click(screen.getByRole('button', { name: /skip all/i }))
    expect(rejectAll).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: /skip all/i }))
    expect(rejectAll).toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByText('Tool')).not.toBeInTheDocument())
  })

  it('Skip all can be cancelled without rejecting', async () => {
    getMyUpdates.mockResolvedValue(TWO_PENDING)
    render(<UpdatesList />)
    await screen.findByText('Tool')
    await userEvent.click(screen.getByRole('button', { name: /skip all/i }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: /cancel/i }))
    expect(rejectAll).not.toHaveBeenCalled()
    expect(screen.getByText('Tool')).toBeInTheDocument()
  })

  it('per-item Update approves and removes just that item', async () => {
    getMyUpdates.mockResolvedValue(PENDING)
    render(<UpdatesList />)
    const update = await screen.findByRole('button', { name: 'Update' })
    await userEvent.click(update)
    expect(approveUpdate).toHaveBeenCalledWith('alice:tool', 'sha256:b')
    await waitFor(() => expect(screen.queryByText('Tool')).not.toBeInTheDocument())
  })

  it('turning auto on with a pending queue confirms before applying', async () => {
    getMyUpdates.mockResolvedValue(PENDING)
    render(<UpdatesList />)
    const sw = await screen.findByRole('switch', { name: /auto-update/i })
    await userEvent.click(sw)
    // The toggle only opens a confirm — nothing is applied yet.
    expect(setUpdateMode).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/turn on auto-update/i)).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: /turn on/i }))
    expect(setUpdateMode).toHaveBeenCalledWith('auto')
    await waitFor(() => expect(screen.queryByText('Tool')).not.toBeInTheDocument())
    // applied === 1 → singular copy.
    expect(toastSpy).toHaveBeenCalledWith({ message: 'Auto-update on. Applied 1 update.' })
  })

  it('auto-on toast pluralizes the applied count', async () => {
    getMyUpdates.mockResolvedValue(PENDING)
    setUpdateMode.mockResolvedValueOnce(2)
    render(<UpdatesList />)
    const sw = await screen.findByRole('switch', { name: /auto-update/i })
    await userEvent.click(sw)
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: /turn on/i }))
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith({ message: 'Auto-update on. Applied 2 updates.' }),
    )
  })

  it('turning auto off applies immediately with no confirm', async () => {
    getMyUpdates.mockResolvedValue({ ...PENDING, update_mode: 'auto', pending: [] })
    render(<UpdatesList />)
    const sw = await screen.findByRole('switch', { name: /auto-update/i })
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'true'))
    await userEvent.click(sw)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(setUpdateMode).toHaveBeenCalledWith('manual')
  })

  it('closes the confirm dialog (and keeps the queue) when enabling auto fails', async () => {
    getMyUpdates.mockResolvedValue(PENDING)
    setUpdateMode.mockRejectedValueOnce(new Error('nope'))
    render(<UpdatesList />)
    const sw = await screen.findByRole('switch', { name: /auto-update/i })
    await userEvent.click(sw)
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: /turn on/i }))
    // On failure the dialog must not get stuck open behind the error toast...
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // ...and the pending queue is left intact (nothing was applied).
    expect(screen.getByText('Tool')).toBeInTheDocument()
  })

  it('turning auto on with an empty queue applies immediately, no confirm', async () => {
    getMyUpdates.mockResolvedValue({ ...PENDING, update_mode: 'manual', pending: [] })
    render(<UpdatesList />)
    const sw = await screen.findByRole('switch', { name: /auto-update/i })
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'false'))
    await userEvent.click(sw)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(setUpdateMode).toHaveBeenCalledWith('auto')
  })

  it('toast omits the count when auto is enabled with nothing to apply', async () => {
    getMyUpdates.mockResolvedValue({ ...PENDING, update_mode: 'manual', pending: [] })
    setUpdateMode.mockResolvedValueOnce(0)
    render(<UpdatesList />)
    const sw = await screen.findByRole('switch', { name: /auto-update/i })
    await userEvent.click(sw)
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith({ message: 'Auto-update on.' }))
  })

  // R5 — kit removals: rows render outside the bulk queue, Keep/Remove decide
  // per-row, and a pending removal alone defeats the "all caught up" panel.
  it('renders kit-removal rows and resolves them on Keep / Remove', async () => {
    getMyUpdates.mockResolvedValue({ ...PENDING, pending: [] })
    getMyRemovals.mockResolvedValue([
      {
        skill_id: 'dan:dropped-tool',
        author_id: 'dan',
        slug: 'dropped-tool',
        keepable: true,
        source_kit: { id: 'kit-1', name: 'Ship Review', owner: 'grace', slug: 'ship-review', avatar_url: null },
      },
      {
        skill_id: 'dan:gone-tool',
        author_id: null,
        slug: null,
        keepable: false,
        source_kit: { id: 'kit-1', name: 'Ship Review', owner: 'grace', slug: 'ship-review', avatar_url: null },
      },
    ])
    render(<UpdatesList />)

    expect(await screen.findByText('Removed from kits')).toBeInTheDocument()
    expect(screen.queryByText(/all caught up/i)).not.toBeInTheDocument()
    // A deleted-upstream skill offers no Keep.
    expect(screen.getAllByRole('button', { name: 'Keep' })).toHaveLength(1)

    await userEvent.click(screen.getByRole('button', { name: 'Keep' }))
    await waitFor(() =>
      expect(decideRemoval).toHaveBeenCalledWith('dan:dropped-tool', 'kit-1', 'keep'),
    )

    await userEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0])
    await waitFor(() =>
      expect(decideRemoval).toHaveBeenCalledWith('dan:gone-tool', 'kit-1', 'remove'),
    )
    // Both rows resolved → the section unmounts.
    await waitFor(() => expect(screen.queryByText('Removed from kits')).not.toBeInTheDocument())
  })
})
