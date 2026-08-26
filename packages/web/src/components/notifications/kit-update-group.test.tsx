import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { KitUpdateGroup } from './kit-update-group'
import { UpdatesList } from './updates-list'
import type { MyUpdates, UpdateItem, UpdateSourceKit } from '@/lib/account-updates'

// Grouping fans out over the per-skill decision endpoints; mock the client so we
// can assert what the single "Update all" / "Skip" actually calls.
const {
  mockApproveItems,
  mockRejectItems,
  mockApprove,
  mockReject,
  mockGetDiff,
  mockGetMyUpdates,
  mockApproveAll,
  mockRejectAll,
  mockSetMode,
} = vi.hoisted(() => ({
  mockApproveItems: vi.fn(async (items: { skill_id: string }[]) => ({
    ok: items.map((i) => i.skill_id),
    failed: [] as string[],
  })),
  mockRejectItems: vi.fn(async (items: { skill_id: string }[]) => ({
    ok: items.map((i) => i.skill_id),
    failed: [] as string[],
  })),
  mockApprove: vi.fn(async () => {}),
  mockReject: vi.fn(async () => {}),
  mockGetDiff: vi.fn(async () => ({ from: 'base', to: 'next', files: [] })),
  mockGetMyUpdates: vi.fn(),
  mockApproveAll: vi.fn(async () => 0),
  mockRejectAll: vi.fn(async () => 0),
  mockSetMode: vi.fn(async () => 0),
}))
vi.mock('@/lib/account-updates', () => ({
  approveItems: (...a: unknown[]) => mockApproveItems(...(a as [never])),
  rejectItems: (...a: unknown[]) => mockRejectItems(...(a as [never])),
  approveUpdate: (...a: unknown[]) => mockApprove(...(a as [])),
  rejectUpdate: (...a: unknown[]) => mockReject(...(a as [])),
  getSkillDiff: (...a: unknown[]) => mockGetDiff(...(a as [])),
  getMyUpdates: (...a: unknown[]) => mockGetMyUpdates(...(a as [])),
  approveAll: (...a: unknown[]) => mockApproveAll(...(a as [])),
  rejectAll: (...a: unknown[]) => mockRejectAll(...(a as [])),
  setUpdateMode: (...a: unknown[]) => mockSetMode(...(a as [])),
  getMyRemovals: async () => [],
  decideRemoval: async () => undefined,
}))
vi.mock('@/components/file-diff', () => ({ FileDiff: () => <div data-testid="file-diff" /> }))

const { mockDecrement } = vi.hoisted(() => ({ mockDecrement: vi.fn() }))
vi.mock('./use-unread-notifications', () => ({ decrementPendingUpdates: mockDecrement }))

// The group asks who you are so it can tell "a kit someone published to you"
// from "a bag you filled yourself".
const { mockSession } = vi.hoisted(() => ({
  mockSession: vi.fn(() => ({ data: null }) as { data: { handle?: string } | null }),
}))
vi.mock('next-auth/react', () => ({
  useSession: () => mockSession(),
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
}))

const { toastSpy } = vi.hoisted(() => ({ toastSpy: vi.fn() }))
vi.mock('@/components/ui/toast', async (importActual) => ({
  ...(await importActual<typeof import('@/components/ui/toast')>()),
  useToast: () => toastSpy,
}))

const KIT: UpdateSourceKit = {
  id: 'kit_team',
  name: 'Team Kit',
  owner: 'test-team',
  slug: 'team-kit',
  avatar_url: null,
}

function item(over: Partial<UpdateItem> = {}): UpdateItem {
  return {
    ref: 'k8s/debug',
    skill_id: 'k8s:debug',
    from_version: null,
    to_version: 1,
    to_hash: 'h-k8s',
    release_note: null,
    category: 'devops',
    author_name: 'K8s',
    author_avatar_url: null,
    scan_status: null,
    scan_findings: 0,
    source_kit: KIT,
    ...over,
  }
}

const fourKitItems = (): UpdateItem[] => [
  item(),
  item({ ref: 'tf/review', skill_id: 'tf:review', to_hash: 'h-tf' }),
  item({ ref: 'sec/pass', skill_id: 'sec:pass', to_hash: 'h-sec' }),
  item({ ref: 'serp/analyzer', skill_id: 'serp:analyzer', to_hash: 'h-serp' }),
]

afterEach(() => {
  vi.clearAllMocks()
  mockSession.mockReturnValue({ data: null })
})

describe('KitUpdateGroup', () => {
  // The bug: an update to somebody else's skill, sitting in your own Saved kit,
  // rendered under "Saved @you" with your face — as if you had shipped it.
  it('does not attribute your own kit to you', () => {
    mockSession.mockReturnValue({ data: { handle: 'test-team' } })
    render(<KitUpdateGroup kit={KIT} items={fourKitItems()} onResolved={vi.fn()} />)
    expect(screen.getByText('Team Kit')).toBeInTheDocument()
    expect(screen.queryByText('@test-team')).not.toBeInTheDocument()
  })

  it('renders the kit name, owner, and "N new skills"', () => {
    render(<KitUpdateGroup kit={KIT} items={fourKitItems()} onResolved={vi.fn()} />)
    expect(screen.getByText('Team Kit')).toBeInTheDocument()
    expect(screen.getByText('@test-team')).toBeInTheDocument()
    expect(screen.getByText('4 new skills')).toBeInTheDocument()
  })

  // R3 — a single kit-sourced skill still shows its kit header and label.
  it('renders "1 new skill" for a single-item group', () => {
    render(<KitUpdateGroup kit={KIT} items={[item()]} onResolved={vi.fn()} />)
    expect(screen.getByText('Team Kit')).toBeInTheDocument()
    expect(screen.getByText('1 new skill')).toBeInTheDocument()
  })

  // Groups are formed by source kit, not by kind, so a kit delivers first
  // installs and new versions together. Calling a version bump "new" hides the
  // case that matters more: a skill you already run changed underneath you.
  it('calls a group of version bumps updated, not new', () => {
    const items = [
      item({ from_version_label: '1.0.0' }),
      item({ ref: 'sec/pass', skill_id: 'sec:pass', to_hash: 'h-sec', from_version_label: '2.1.0' }),
    ]
    render(<KitUpdateGroup kit={KIT} items={items} onResolved={vi.fn()} />)
    expect(screen.getByText('2 updated skills')).toBeInTheDocument()
    expect(screen.queryByText('2 new skills')).not.toBeInTheDocument()
  })

  it('splits the count when a kit delivers both at once', () => {
    const items = [
      item(),
      item({ ref: 'sec/pass', skill_id: 'sec:pass', to_hash: 'h-sec' }),
      item({ ref: 'serp/analyzer', skill_id: 'serp:analyzer', to_hash: 'h-serp', from_version_label: '1.2.0' }),
    ]
    render(<KitUpdateGroup kit={KIT} items={items} onResolved={vi.fn()} />)
    expect(screen.getByText('2 new · 1 updated')).toBeInTheDocument()
  })

  // R4 — "Update all" approves every skill in the group and resolves the ids.
  it('Update all fans out over the group skills and resolves the accepted ids', async () => {
    const user = userEvent.setup()
    const onResolved = vi.fn()
    render(<KitUpdateGroup kit={KIT} items={fourKitItems()} onResolved={onResolved} />)

    await user.click(screen.getByRole('button', { name: 'Update' }))

    expect(mockApproveItems).toHaveBeenCalledTimes(1)
    const passed = mockApproveItems.mock.calls[0][0] as { skill_id: string; to_hash: string }[]
    expect(passed.map((p) => p.skill_id)).toEqual(['k8s:debug', 'tf:review', 'sec:pass', 'serp:analyzer'])
    await waitFor(() =>
      expect(onResolved).toHaveBeenCalledWith(['k8s:debug', 'tf:review', 'sec:pass', 'serp:analyzer']),
    )
  })

  it('Skip fans out over reject for the group skills', async () => {
    const user = userEvent.setup()
    render(<KitUpdateGroup kit={KIT} items={fourKitItems()} onResolved={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Skip' }))
    expect(mockRejectItems).toHaveBeenCalledTimes(1)
    expect(mockApproveItems).not.toHaveBeenCalled()
  })

  // R6 — the count line expands to the member skills, each without a per-skill action.
  it('expand reveals the member skills and no per-skill Update button', async () => {
    const user = userEvent.setup()
    render(<KitUpdateGroup kit={KIT} items={fourKitItems()} onResolved={vi.fn()} />)

    // The "N new skills" count is the disclosure.
    await user.click(screen.getByRole('button', { name: /new skills/i }))
    // Skill names show (humanized).
    expect(screen.getByText('Debug')).toBeInTheDocument()
    expect(screen.getByText('Review')).toBeInTheDocument()
    // Exactly one "Update" (the group's) — the child rows carry no per-skill button.
    expect(screen.getAllByRole('button', { name: /^update$/i })).toHaveLength(1)
  })

  // A new skill has no diff — the expanded row shows its description (what it
  // does), with no separate "What changed" affordance anywhere.
  it('new-skill rows show the description and no per-skill What changed', async () => {
    const user = userEvent.setup()
    const withDesc = [item({ description: 'Diagnose failing pods from kubectl output.' })]
    render(<KitUpdateGroup kit={KIT} items={withDesc} onResolved={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /new skill/i }))
    expect(screen.getByText('Diagnose failing pods from kubectl output.')).toBeInTheDocument()
    // The old "What changed" label is gone — the count is the only disclosure.
    expect(screen.queryByRole('button', { name: /what changed/i })).toBeNull()
  })

  // Auto mode: no group action, but the skills still list on expand.
  it('readOnly hides the group actions', () => {
    render(<KitUpdateGroup kit={KIT} items={fourKitItems()} onResolved={vi.fn()} readOnly />)
    expect(screen.queryByRole('button', { name: 'Update' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull()
  })
})

describe('UpdatesList — grouping by kit', () => {
  function updates(pending: UpdateItem[], mode: 'manual' | 'auto' = 'manual'): MyUpdates {
    return { update_mode: mode, pending, recently_applied: [], editedSkills: [] }
  }
  const authorItem = (over: Partial<UpdateItem> = {}): UpdateItem =>
    item({ ref: 'ada/solo', skill_id: 'ada:solo', to_hash: 'h-solo', source_kit: null, ...over })

  it('renders one kit group and no standalone rows when all share a kit', async () => {
    mockGetMyUpdates.mockResolvedValue(updates(fourKitItems()))
    render(<UpdatesList />)
    await screen.findByText('Team Kit')
    expect(screen.getByText('4 new skills')).toBeInTheDocument()
    // The four skills are inside the group (collapsed), not four standalone rows:
    // exactly one "Update all" for the group plus the page-level bulk — assert the
    // group's own header count is the single grouping.
    expect(screen.getAllByText('Team Kit')).toHaveLength(1)
  })

  it('renders a kit group plus standalone author-sub rows', async () => {
    mockGetMyUpdates.mockResolvedValue(updates([...fourKitItems(), authorItem()]))
    render(<UpdatesList />)
    await screen.findByText('Team Kit')
    // The standalone author-sub skill renders as its own row (humanized name).
    expect(screen.getByText('Solo')).toBeInTheDocument()
  })

  it('degrades to a flat list when no item carries a kit', async () => {
    mockGetMyUpdates.mockResolvedValue(
      updates([authorItem(), authorItem({ ref: 'ben/two', skill_id: 'ben:two', to_hash: 'h2' })]),
    )
    render(<UpdatesList />)
    await screen.findByText('Solo')
    expect(screen.queryByText('Team Kit')).toBeNull()
  })

  // R7 — a group's Update all removes exactly that group's skills and credits the
  // badge by the group size.
  it('group Update all resolves the group and decrements the badge by its size', async () => {
    mockGetMyUpdates.mockResolvedValue(updates(fourKitItems()))
    render(<UpdatesList />)
    await screen.findByText('Team Kit')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Update' }))
    await waitFor(() => expect(screen.queryByText('Team Kit')).toBeNull())
    expect(mockDecrement).toHaveBeenCalledWith(4)
  })
})
