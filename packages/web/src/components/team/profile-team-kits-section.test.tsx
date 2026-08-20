import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProfileTeamKitsSection, type TeamKitsGroup } from './profile-team-kits-section'
import type { AuthorProfileKit } from '@/lib/types'

// The mute toggle writes through the account-updates client; mock it.
const { mockMute, mockUnmute } = vi.hoisted(() => ({
  mockMute: vi.fn(async (_kitId: string) => {}),
  mockUnmute: vi.fn(async (_kitId: string) => {}),
}))
vi.mock('@/lib/account-updates', () => ({
  muteTeamKit: (...a: unknown[]) => mockMute(...(a as [string])),
  unmuteTeamKit: (...a: unknown[]) => mockUnmute(...(a as [string])),
}))
const { toastSpy } = vi.hoisted(() => ({ toastSpy: vi.fn() }))
vi.mock('@/components/ui/toast', async (importActual) => ({
  ...(await importActual<typeof import('@/components/ui/toast')>()),
  useToast: () => toastSpy,
}))

function kit(over: Partial<AuthorProfileKit> = {}): AuthorProfileKit {
  return {
    id: 'kit_1',
    slug: 'team-kit',
    owner: 'acme',
    name: 'Team Kit',
    visibility: 'public',
    skillCount: 3,
    skillRefs: ['a/one', 'b/two'],
    skillCategories: ['coding', 'devops'],
    ...over,
  }
}
const team = (over: Partial<TeamKitsGroup> = {}): TeamKitsGroup => ({
  slug: 'acme',
  name: 'Acme',
  kits: [kit()],
  ...over,
})

afterEach(() => vi.clearAllMocks())

describe('ProfileTeamKitsSection', () => {
  it('renders each team with its kits', () => {
    render(<ProfileTeamKitsSection teams={[team()]} mutedKitIds={[]} />)
    expect(screen.getByText('Acme')).toBeInTheDocument()
    expect(screen.getByText('Team Kit')).toBeInTheDocument()
  })

  it('renders an empty state when the viewer has no team kits', () => {
    render(<ProfileTeamKitsSection teams={[]} mutedKitIds={[]} />)
    expect(screen.getByText(/No team kits yet/i)).toBeInTheDocument()
  })

  it('shows the +/✓ coin: synced kit reads Remove, muted kit reads Add', () => {
    const { unmount } = render(<ProfileTeamKitsSection teams={[team()]} mutedKitIds={[]} />)
    // Synced (not muted) → the ✓ coin, click to remove.
    expect(screen.getByRole('button', { name: /remove/i })).toBeInTheDocument()
    unmount()
    // Muted → the + coin, click to add back.
    render(<ProfileTeamKitsSection teams={[team()]} mutedKitIds={['kit_1']} />)
    expect(screen.getByRole('button', { name: /add/i })).toBeInTheDocument()
  })

  it('removes (mutes) a synced kit on click (optimistic → endpoint)', async () => {
    const user = userEvent.setup()
    render(<ProfileTeamKitsSection teams={[team()]} mutedKitIds={[]} />)
    await user.click(screen.getByRole('button', { name: /remove/i }))
    expect(await screen.findByRole('button', { name: /add/i })).toBeInTheDocument()
    expect(mockMute).toHaveBeenCalledWith('kit_1')
  })

  it('adds (unmutes) a muted kit on click', async () => {
    const user = userEvent.setup()
    render(<ProfileTeamKitsSection teams={[team()]} mutedKitIds={['kit_1']} />)
    await user.click(screen.getByRole('button', { name: /add/i }))
    expect(await screen.findByRole('button', { name: /remove/i })).toBeInTheDocument()
    expect(mockUnmute).toHaveBeenCalledWith('kit_1')
  })

  it('reverts and toasts when the call fails', async () => {
    mockMute.mockRejectedValueOnce(new Error('boom'))
    const user = userEvent.setup()
    render(<ProfileTeamKitsSection teams={[team()]} mutedKitIds={[]} />)
    await user.click(screen.getByRole('button', { name: /remove/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /remove/i })).toBeInTheDocument())
    expect(toastSpy).toHaveBeenCalled()
  })

  it('groups kits under their team and counts them', () => {
    render(
      <ProfileTeamKitsSection
        teams={[team({ kits: [kit(), kit({ id: 'kit_2', name: 'Second Kit', slug: 'second' })] })]}
        mutedKitIds={[]}
      />,
    )
    const section = screen.getByText('Acme').closest('section') as HTMLElement
    expect(within(section).getByText('Team Kit')).toBeInTheDocument()
    expect(within(section).getByText('Second Kit')).toBeInTheDocument()
  })
})
