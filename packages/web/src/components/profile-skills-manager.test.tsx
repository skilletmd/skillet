import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { ProfileSkillsManager, type ManagedSkill } from '@/components/profile-skills-manager'
import { setSkillVisibility, deprecateSkill, undeprecateSkill } from '@/lib/deprecation'

// Isolate the manager from render + network deps. The dropdown mock renders its
// content inline so row-menu items are queryable without Radix's portal.
vi.mock('@/components/skill-card', () => ({
  SkillCard: ({ slug }: { slug: string }) => <div data-testid={`card-${slug}`}>{slug}</div>,
}))
vi.mock('@/components/directory-card', () => ({ SkillIcon: () => <span data-testid="skill-icon" /> }))
vi.mock('@/components/visibility-badge', () => ({ PrivateMark: () => <span>private</span> }))
vi.mock('@/lib/deprecation', () => ({
  setSkillVisibility: vi.fn(async () => ({ visibility: 'public' })),
  deprecateSkill: vi.fn(async () => ({ deprecated: true })),
  undeprecateSkill: vi.fn(async () => ({ deprecated: false })),
}))
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: any) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: any) => <>{children}</>,
  DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onSelect }: any) => <button onClick={() => onSelect?.()}>{children}</button>,
}))

const mockSetVisibility = vi.mocked(setSkillVisibility)
const mockDeprecate = vi.mocked(deprecateSkill)
const mockUndeprecate = vi.mocked(undeprecateSkill)

function skills(): ManagedSkill[] {
  return [
    { author: 'me', slug: 'alpha', title: 'Alpha', description: 'a', category: null, visibility: 'public', installCount: 3 },
    { author: 'me', slug: 'beta', title: 'Beta', description: 'b', category: null, visibility: 'private', installCount: 1 },
  ]
}

function skillsWithDeprecated(): ManagedSkill[] {
  return [
    ...skills(),
    { author: 'me', slug: 'gamma', title: 'Gamma', description: 'g', category: null, visibility: 'public', installCount: 0, deprecated: true },
  ]
}

const selectAll = () => screen.getByLabelText('Select all skills') as HTMLInputElement
const gotoList = () => fireEvent.click(screen.getByRole('button', { name: /list/i }))
const bulk = () => within(screen.getByRole('group', { name: 'Bulk actions' }))
const row = (title: string) => within(screen.getByText(title).closest('li') as HTMLElement)
const dialog = () => within(screen.getByRole('dialog'))
// Filter options render inline (dropdown mock): a label span + a muted count span.
const filterOption = (key: 'all' | 'public' | 'private' | 'unpublished') =>
  screen.getByRole('button', { name: new RegExp(`^${key}\\s*\\d+`, 'i') })

beforeEach(() => {
  mockSetVisibility.mockReset().mockResolvedValue({ visibility: 'public' })
  mockDeprecate.mockReset().mockResolvedValue({ deprecated: true })
  mockUndeprecate.mockReset().mockResolvedValue({ deprecated: false })
})
afterEach(() => vi.restoreAllMocks())

describe('ProfileSkillsManager: view + selection', () => {
  it('renders card view by default with a card/list toggle for everyone', () => {
    render(<ProfileSkillsManager skills={skills()} isSelf={false} emptyCopy="none" />)
    expect(screen.getByRole('button', { name: /card/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /list/i })).toBeInTheDocument()
    expect(screen.getByTestId('card-alpha')).toBeInTheDocument()
  })

  it('owner list view: checkboxes, select-all/clear, count', () => {
    render(<ProfileSkillsManager skills={skills()} isSelf emptyCopy="none" />)
    gotoList()
    const rows = [
      screen.getByLabelText('Select Alpha') as HTMLInputElement,
      screen.getByLabelText('Select Beta') as HTMLInputElement,
    ]
    fireEvent.click(selectAll())
    expect(rows.every((c) => c.checked)).toBe(true)
    expect(screen.getByText('2 selected')).toBeInTheDocument()
    fireEvent.click(selectAll())
    expect(rows.some((c) => c.checked)).toBe(false)
    expect(screen.getByText('Select all')).toBeInTheDocument()
  })

  it('non-owner list view has no checkboxes and no bulk group', () => {
    render(<ProfileSkillsManager skills={skills()} isSelf={false} emptyCopy="none" />)
    gotoList()
    expect(screen.queryByLabelText('Select all skills')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Select Alpha')).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Bulk actions' })).not.toBeInTheDocument()
    expect(screen.getByText('private')).toBeInTheDocument()
  })

  it('title links to the skill page', () => {
    render(<ProfileSkillsManager skills={skills()} isSelf emptyCopy="none" />)
    gotoList()
    expect(screen.getByText('Alpha').closest('a')).toHaveAttribute('href', '/me/alpha')
  })

  it('renders the empty state when there are no skills', () => {
    render(<ProfileSkillsManager skills={[]} isSelf emptyCopy="nothing here" />)
    expect(screen.getByText('nothing here')).toBeInTheDocument()
  })

  it('has no em-dash in its rendered text', () => {
    const { container } = render(<ProfileSkillsManager skills={skills()} isSelf emptyCopy="none" />)
    expect(container.textContent).not.toContain('—')
  })
})

describe('ProfileSkillsManager: bulk actions', () => {
  it('no bulk group until something is selected', () => {
    render(<ProfileSkillsManager skills={skills()} isSelf emptyCopy="none" />)
    gotoList()
    expect(screen.queryByRole('group', { name: 'Bulk actions' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Select Alpha'))
    expect(screen.getByRole('group', { name: 'Bulk actions' })).toBeInTheDocument()
  })

  it('bulk make public calls setSkillVisibility per selected skill and clears selection', async () => {
    render(<ProfileSkillsManager skills={skills()} isSelf emptyCopy="none" />)
    gotoList()
    fireEvent.click(selectAll())
    fireEvent.click(bulk().getByRole('button', { name: /make public/i }))
    await waitFor(() => expect(mockSetVisibility).toHaveBeenCalledTimes(2))
    expect(mockSetVisibility).toHaveBeenCalledWith('me', 'alpha', 'public')
    expect(mockSetVisibility).toHaveBeenCalledWith('me', 'beta', 'public')
    await waitFor(() => expect(screen.getByText('Select all')).toBeInTheDocument())
  })

  it('bulk remove calls deprecateSkill (not a hard delete) after confirming in the modal', async () => {
    render(<ProfileSkillsManager skills={skills()} isSelf emptyCopy="none" />)
    gotoList()
    fireEvent.click(selectAll())
    fireEvent.click(bulk().getByRole('button', { name: /unpublish/i }))
    // A modal confirmation opens; nothing happens until it is confirmed.
    expect(mockDeprecate).not.toHaveBeenCalled()
    fireEvent.click(dialog().getByRole('button', { name: /unpublish/i }))
    await waitFor(() => expect(mockDeprecate).toHaveBeenCalledTimes(2))
    expect(mockDeprecate).toHaveBeenCalledWith('me', 'alpha')
    // Unpublished, not deleted: still present under All (now badged).
    expect(screen.getByText('Alpha')).toBeInTheDocument()
  })

  it('bulk remove is a no-op when the modal is canceled', () => {
    render(<ProfileSkillsManager skills={skills()} isSelf emptyCopy="none" />)
    gotoList()
    fireEvent.click(selectAll())
    fireEvent.click(bulk().getByRole('button', { name: /unpublish/i }))
    fireEvent.click(dialog().getByRole('button', { name: /cancel/i }))
    expect(mockDeprecate).not.toHaveBeenCalled()
    expect(screen.getByText('Alpha')).toBeInTheDocument()
  })

  it('partial failure reverts only the failed row and keeps it selected', async () => {
    mockSetVisibility.mockImplementation(async (_a: string, slug: string) => {
      if (slug === 'beta') throw new Error('boom')
      return { visibility: 'private' as const }
    })
    render(<ProfileSkillsManager skills={skills()} isSelf emptyCopy="none" />)
    gotoList()
    fireEvent.click(selectAll())
    fireEvent.click(bulk().getByRole('button', { name: /make private/i }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/could not update 1 skill/i))
    expect((screen.getByLabelText('Select Beta') as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText('Select Alpha') as HTMLInputElement).checked).toBe(false)
  })
})

describe('ProfileSkillsManager: per-row Edit menu', () => {
  it('row menu toggles the single skill visibility', async () => {
    render(<ProfileSkillsManager skills={skills()} isSelf emptyCopy="none" />)
    gotoList()
    // Alpha is public, so its menu offers Make private.
    fireEvent.click(row('Alpha').getByRole('button', { name: /make private/i }))
    await waitFor(() => expect(mockSetVisibility).toHaveBeenCalledWith('me', 'alpha', 'private'))
    expect(mockSetVisibility).toHaveBeenCalledTimes(1)
  })

  it('row menu unpublish deprecates the single skill after confirming in the modal', async () => {
    render(<ProfileSkillsManager skills={skills()} isSelf emptyCopy="none" />)
    gotoList()
    fireEvent.click(row('Beta').getByRole('button', { name: /unpublish/i }))
    expect(mockDeprecate).not.toHaveBeenCalled()
    fireEvent.click(dialog().getByRole('button', { name: /unpublish/i }))
    await waitFor(() => expect(mockDeprecate).toHaveBeenCalledWith('me', 'beta'))
    expect(mockDeprecate).toHaveBeenCalledTimes(1)
  })
})

describe('ProfileSkillsManager: unpublished (deprecated) group', () => {
  it('card view hides deprecated skills; the All list shows them at the end', () => {
    render(<ProfileSkillsManager skills={skillsWithDeprecated()} isSelf emptyCopy="none" />)
    expect(screen.queryByText('Gamma')).not.toBeInTheDocument() // card view
    gotoList()
    // All (default) includes the unpublished skill.
    expect(screen.getByText('Gamma')).toBeInTheDocument()
    expect(screen.getByText('Alpha')).toBeInTheDocument()
  })

  it('Unpublished filter narrows to just the deprecated skills', () => {
    render(<ProfileSkillsManager skills={skillsWithDeprecated()} isSelf emptyCopy="none" />)
    gotoList()
    fireEvent.click(filterOption('unpublished'))
    expect(screen.getByText('Gamma')).toBeInTheDocument()
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument()
  })

  it('Unpublished filter shows an empty state when nothing is deprecated', () => {
    render(<ProfileSkillsManager skills={skills()} isSelf emptyCopy="none" />)
    gotoList()
    fireEvent.click(filterOption('unpublished'))
    expect(screen.getByText(/no unpublished skills/i)).toBeInTheDocument()
  })

  it('Private filter shows only private skills; Public only public', () => {
    render(<ProfileSkillsManager skills={skills()} isSelf emptyCopy="none" />)
    gotoList()
    fireEvent.click(filterOption('private'))
    expect(screen.getByText('Beta')).toBeInTheDocument()
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument()
    fireEvent.click(filterOption('public'))
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.queryByText('Beta')).not.toBeInTheDocument()
  })

  it('restores a deprecated skill via its Restore button', async () => {
    render(<ProfileSkillsManager skills={skillsWithDeprecated()} isSelf emptyCopy="none" />)
    gotoList()
    fireEvent.click(filterOption('unpublished'))
    fireEvent.click(row('Gamma').getByRole('button', { name: /restore/i }))
    await waitFor(() => expect(mockUndeprecate).toHaveBeenCalledWith('me', 'gamma'))
  })

  it('unpublishing keeps the skill (moves it to unpublished) instead of deleting it', async () => {
    render(<ProfileSkillsManager skills={skills()} isSelf emptyCopy="none" />)
    gotoList()
    fireEvent.click(row('Alpha').getByRole('button', { name: /unpublish/i }))
    fireEvent.click(dialog().getByRole('button', { name: /unpublish/i }))
    await waitFor(() => expect(mockDeprecate).toHaveBeenCalledWith('me', 'alpha'))
    // Still present under All (now badged), not deleted.
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    // And it now appears under the Unpublished filter (count is 1).
    fireEvent.click(filterOption('unpublished'))
    expect(screen.getByText('Alpha')).toBeInTheDocument()
  })
})
