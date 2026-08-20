import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditedSkillsSection } from './edited-skills-section'
import { UpdatesList } from './updates-list'
import type { EditedSkillItem, MyUpdates, UpdateItem } from '@/lib/account-updates'

// The section fetches the author diff and writes the upgrade decision through the
// shared account-updates client; mock it so we can assert what gets called.
const { mockApprove, mockGetDiff, mockGetMyUpdates, mockApproveAll, mockRejectAll, mockSetMode } =
  vi.hoisted(() => ({
    mockApprove: vi.fn(async () => {}),
    mockGetDiff: vi.fn(async () => ({ from: 'base', to: 'next', files: [] })),
    mockGetMyUpdates: vi.fn(),
    mockApproveAll: vi.fn(async () => 0),
    mockRejectAll: vi.fn(async () => 0),
    mockSetMode: vi.fn(async () => 0),
  }))
vi.mock('@/lib/account-updates', () => ({
  approveUpdate: (...a: unknown[]) => mockApprove(...(a as [])),
  getSkillDiff: (...a: unknown[]) => mockGetDiff(...(a as [])),
  getMyUpdates: (...a: unknown[]) => mockGetMyUpdates(...(a as [])),
  approveAll: (...a: unknown[]) => mockApproveAll(...(a as [])),
  rejectAll: (...a: unknown[]) => mockRejectAll(...(a as [])),
  setUpdateMode: (...a: unknown[]) => mockSetMode(...(a as [])),
  getMyRemovals: async () => [],
  decideRemoval: async () => undefined,
}))

// The author diff renderer is exercised elsewhere; stub it to a marker so this
// test focuses on the section's wiring, not FileDiff internals.
vi.mock('@/components/file-diff', () => ({
  FileDiff: () => <div data-testid="file-diff" />,
}))
vi.mock('./use-unread-notifications', () => ({
  decrementPendingUpdates: vi.fn(),
}))

// Capture toast messages so the "See changes" fallback can be asserted.
const { toastSpy } = vi.hoisted(() => ({ toastSpy: vi.fn() }))
vi.mock('@/components/ui/toast', async (importActual) => ({
  ...(await importActual<typeof import('@/components/ui/toast')>()),
  useToast: () => toastSpy,
}))

function editedItem(over: Partial<EditedSkillItem> = {}): EditedSkillItem {
  return {
    ref: 'ada/refactor-helper',
    skill_id: 'sk_1',
    from_version_label: '1.0.0',
    to_version: 2,
    to_version_label: '2.0.0',
    to_hash: 'hash-v2',
    baseline_hash: 'hash-v1',
    category: 'coding',
    author_name: 'Ada',
    author_avatar_url: null,
    devices: [
      { device_id: 'd1', label: 'Taylor’s laptop', last_seen_at: 1_000, edited_at: 900 },
    ],
    ...over,
  }
}

afterEach(() => vi.clearAllMocks())

describe('EditedSkillsSection', () => {
  it('renders nothing when there are no edited skills', () => {
    const { container } = render(<EditedSkillsSection items={[]} onUpgraded={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  // AE1 — an edited skill renders in the section with the author diff and device.
  it('renders the skill, the device name, and the lazy author diff (from baseline)', async () => {
    const user = userEvent.setup()
    render(<EditedSkillsSection items={[editedItem()]} onUpgraded={vi.fn()} />)

    const section = screen.getByRole('region', { name: /skills you’ve edited/i })
    expect(within(section).getByText('Refactor Helper')).toBeInTheDocument()
    expect(within(section).getByText(/Taylor’s laptop/)).toBeInTheDocument()
    expect(within(section).getByText(/synced/)).toBeInTheDocument()

    // The author diff is lazy — nothing fetched until the panel opens.
    expect(mockGetDiff).not.toHaveBeenCalled()
    await user.click(within(section).getByRole('button', { name: /what the author changed/i }))
    // Fetched as the AUTHOR-side baseline→target change; the user's edited bytes
    // are never requested (only ref, target, baseline).
    expect(mockGetDiff).toHaveBeenCalledWith('ada/refactor-helper', 'hash-v2', 'hash-v1')
    await waitFor(() => expect(screen.getByTestId('file-diff')).toBeInTheDocument())
  })

  it('shows the version label and the overwrite warning', () => {
    render(<EditedSkillsSection items={[editedItem()]} onUpgraded={vi.fn()} />)
    expect(screen.getByText('v1.0.0 → v2.0.0')).toBeInTheDocument()
    expect(
      screen.getByText(/Upgrading replaces your local edit with the author’s version\./),
    ).toBeInTheDocument()
  })

  // See changes deep-links into the desktop viewer (the only surface that can
  // show the yours-vs-theirs diff), and still shows the toast as a fallback.
  it('See changes fires the skillet:// deep link and shows the fallback toast', async () => {
    const user = userEvent.setup()
    let firedHref: string | null = null
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        firedHref = this.href
      })
    render(<EditedSkillsSection items={[editedItem()]} onUpgraded={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'See changes' }))

    // editedItem ref is ada/refactor-helper → author/slug path segments.
    expect(firedHref).toBe('skillet://compare/ada/refactor-helper')
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('compare your version') }),
    )
    clickSpy.mockRestore()
  })

  // R8 / KD1 — only the author's side; no "Keep mine" or dismiss control.
  it('offers Upgrade and See changes but no Keep mine / dismiss', () => {
    render(<EditedSkillsSection items={[editedItem()]} onUpgraded={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Upgrade' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'See changes' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /keep mine/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /dismiss/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^skip$/i })).not.toBeInTheDocument()
  })

  // R9 — Upgrade writes a normal decision on the target hash, then clears the row.
  it('Upgrade triggers the decision mutation on the target hash', async () => {
    const user = userEvent.setup()
    const onUpgraded = vi.fn()
    render(<EditedSkillsSection items={[editedItem()]} onUpgraded={onUpgraded} />)
    await user.click(screen.getByRole('button', { name: 'Upgrade' }))
    expect(mockApprove).toHaveBeenCalledWith('sk_1', 'hash-v2')
    await waitFor(() => expect(onUpgraded).toHaveBeenCalledWith('sk_1'))
  })

  // U6 / AE6 — an edit-only card (has_upstream: false): edited locally with no
  // upstream update. No Upgrade, no version arrow, no author-diff; See changes stays.
  it('renders an edit-only card with no Upgrade, no version arrow, no author diff', () => {
    render(
      <EditedSkillsSection items={[editedItem({ has_upstream: false })]} onUpgraded={vi.fn()} />,
    )
    expect(screen.getByText('Edited locally')).toBeInTheDocument()
    expect(screen.queryByText('v1.0.0 → v2.0.0')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Upgrade' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /what the author changed/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText(/Upgrading replaces your local edit/),
    ).not.toBeInTheDocument()
    // Still deep-links to the desktop to compare.
    expect(screen.getByRole('button', { name: 'See changes' })).toBeInTheDocument()
  })

  // R6 — a skill edited on two machines names both devices.
  it('renders a line per device when edited on multiple devices', () => {
    render(
      <EditedSkillsSection
        items={[
          editedItem({
            devices: [
              { device_id: 'd1', label: 'Work laptop', last_seen_at: 1_000, edited_at: 900 },
              { device_id: 'd2', label: 'Home desktop', last_seen_at: 2_000, edited_at: 950 },
            ],
          }),
        ]}
        onUpgraded={vi.fn()}
      />,
    )
    expect(screen.getByText(/Work laptop/)).toBeInTheDocument()
    expect(screen.getByText(/Home desktop/)).toBeInTheDocument()
  })
})

describe('UpdatesList — edited section is separate from the bulk-approvable list', () => {
  function pendingItem(): UpdateItem {
    return {
      ref: 'ben/formatter',
      skill_id: 'sk_pending',
      from_version: 1,
      to_version: 2,
      to_hash: 'p-hash',
      release_note: null,
      category: 'coding',
      author_name: 'Ben',
      author_avatar_url: null,
      scan_status: null,
      scan_findings: 0,
    }
  }
  function myUpdates(): MyUpdates {
    // Two pending items so the bulk Update all / Skip all controls render (they
    // hide for a single update), which is what this test checks the edited skill
    // is kept out of.
    return {
      update_mode: 'manual',
      pending: [pendingItem(), { ...pendingItem(), ref: 'dee/linter', skill_id: 'sk_pending_2' }],
      recently_applied: [],
      editedSkills: [editedItem()],
    }
  }

  // AE2 — the edited skill lives in its own section, not the bulk-approve list,
  // and the edited section carries no bulk control.
  it('keeps the edited skill out of the Pending list and out of Update all', async () => {
    mockGetMyUpdates.mockResolvedValue(myUpdates())
    render(<UpdatesList />)

    // Pending section renders its bulk control; the edited section is separate.
    await screen.findByText('Formatter')
    expect(screen.getByRole('button', { name: 'Update all' })).toBeInTheDocument()

    const edited = screen.getByRole('region', { name: /skills you’ve edited/i })
    // The edited skill is inside its own region…
    expect(within(edited).getByText('Refactor Helper')).toBeInTheDocument()
    // …with its own per-row Upgrade, and no bulk Update all / Skip all inside it.
    expect(within(edited).getByRole('button', { name: 'Upgrade' })).toBeInTheDocument()
    expect(within(edited).queryByRole('button', { name: /update all|skip all/i })).toBeNull()
    // The pending skill is not duplicated into the edited section.
    expect(within(edited).queryByText('Formatter')).toBeNull()
  })
})
