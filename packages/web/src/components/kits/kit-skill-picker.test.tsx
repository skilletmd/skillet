import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KitSkillPicker, type PickerSkill } from '@/components/kits/kit-skill-picker'
import type { SearchGroups } from '@/lib/search-client'

const searchUniversal = vi.fn()

vi.mock('@/lib/search-client', () => ({
  searchUniversal: (...args: unknown[]) => searchUniversal(...args),
}))

const SKILL_GROUPS: SearchGroups = {
  skills: [
    {
      type: 'skill',
      skill_id: 'thiago:skillet-sync',
      author: 'thiago',
      slug: 'skillet-sync',
      description: 'Skillet sync coach',
      install_count: 3,
      url: '/skills/thiago/skillet-sync',
      score: 1,
    },
    {
      type: 'skill',
      skill_id: 'skillet:sql-review',
      author: 'skillet',
      slug: 'sql-review',
      description: 'SQL review helper',
      install_count: 10,
      url: '/skills/skillet/sql-review',
      score: 0.9,
    },
  ],
}

const MINE: PickerSkill[] = [
  { skill_id: 'me:my-skill', author: 'me', slug: 'my-skill', description: null, category: null },
]

const SAVED: PickerSkill[] = [
  { skill_id: 'grace:saved-one', author: 'grace', slug: 'saved-one', description: null, category: null },
]

const POPULAR: PickerSkill[] = [
  { skill_id: 'acme:top-skill', author: 'acme', slug: 'top-skill', description: null, category: null },
]

const PRIVATE_MINE: PickerSkill[] = [
  {
    skill_id: 'me:secret',
    author: 'me',
    slug: 'secret',
    description: null,
    category: null,
    visibility: 'private',
  },
]

describe('KitSkillPicker', () => {
  beforeEach(() => {
    searchUniversal.mockReset()
    searchUniversal.mockResolvedValue({ query: 'sync', groups: SKILL_GROUPS })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('searches skills (types: skills) and surfaces results, excluding already-added', async () => {
    const onAdd = vi.fn()
    render(
      <KitSkillPicker
        existingSkillIds={['skillet:sql-review']}
        kitVisibility="public"
        onAdd={onAdd}
      />,
    )

    fireEvent.change(screen.getByLabelText(/search skills to add/i), {
      target: { value: 'sync' },
    })

    expect(await screen.findByText('Skillet Sync')).toBeTruthy()
    expect(screen.getByText('@thiago')).toBeTruthy()
    // Already-added skill (skillet:sql-review) is filtered out of results.
    expect(screen.queryByText('@skillet')).toBeNull()

    await waitFor(() => expect(searchUniversal).toHaveBeenCalled())
    const opts = searchUniversal.mock.calls[0][1] as { types?: string[] }
    expect(opts.types).toEqual(['skills'])
  })

  it('fires onAdd on selection without performing any network call', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const onAdd = vi.fn()
    render(<KitSkillPicker existingSkillIds={[]} kitVisibility="public" onAdd={onAdd} />)

    fireEvent.change(screen.getByLabelText(/search skills to add/i), {
      target: { value: 'sync' },
    })
    fireEvent.click(await screen.findByText('Skillet Sync'))

    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ skill_id: 'thiago:skillet-sync' }))
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('defaults to the Created tab and lists your own skills when idle', () => {
    render(
      <KitSkillPicker
        existingSkillIds={[]}
        mySkills={MINE}
        savedSkills={SAVED}
        kitVisibility="public"
        onAdd={vi.fn()}
      />,
    )
    fireEvent.focus(screen.getByLabelText(/search skills to add/i))
    // The Created filter is active by default and carries a live count.
    expect(screen.getByRole('button', { name: /Created/ }).getAttribute('aria-pressed')).toBe(
      'true',
    )
    expect(screen.getByText('My Skill')).toBeTruthy()
    // Saved skills are behind their filter, not shown yet.
    expect(screen.queryByText('Saved One')).toBeNull()
  })

  it('flips to the Saved tab to browse saved skills', () => {
    render(
      <KitSkillPicker
        existingSkillIds={[]}
        mySkills={MINE}
        savedSkills={SAVED}
        kitVisibility="public"
        onAdd={vi.fn()}
      />,
    )
    fireEvent.focus(screen.getByLabelText(/search skills to add/i))
    fireEvent.click(screen.getByRole('button', { name: /Saved/ }))
    expect(screen.getByText('Saved One')).toBeTruthy()
    expect(screen.queryByText('My Skill')).toBeNull()
  })

  it('defaults to the Popular tab when the user has no skills of their own', () => {
    render(
      <KitSkillPicker
        existingSkillIds={[]}
        popularSkills={POPULAR}
        kitVisibility="public"
        onAdd={vi.fn()}
      />,
    )
    fireEvent.focus(screen.getByLabelText(/search skills to add/i))
    // No personal skills: only the All filter shows (active), and Popular is the list.
    expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('Top Skill')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Created/ })).toBeNull()
  })

  it('hides the browse tabs and prompts to search when there is nothing to browse', () => {
    render(<KitSkillPicker existingSkillIds={[]} kitVisibility="public" onAdd={vi.fn()} />)
    fireEvent.focus(screen.getByLabelText(/search skills to add/i))
    expect(screen.queryByRole('radio', { name: 'Created' })).toBeNull()
    expect(screen.getByText(/type above to search every skill/i)).toBeTruthy()
  })

  it('badges a private skill and disables its Add in a public kit', () => {
    const onAdd = vi.fn()
    render(
      <KitSkillPicker
        existingSkillIds={[]}
        mySkills={PRIVATE_MINE}
        kitVisibility="public"
        onAdd={onAdd}
      />,
    )
    fireEvent.focus(screen.getByLabelText(/search skills to add/i))
    expect(screen.getByText('private')).toBeTruthy()
    const row = screen.getByText('Secret').closest('button') as HTMLButtonElement
    expect(row.disabled).toBe(true)
    fireEvent.click(row)
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('allows adding a private skill when the kit itself is private', () => {
    const onAdd = vi.fn()
    render(
      <KitSkillPicker
        existingSkillIds={[]}
        mySkills={PRIVATE_MINE}
        kitVisibility="private"
        onAdd={onAdd}
      />,
    )
    fireEvent.focus(screen.getByLabelText(/search skills to add/i))
    const row = screen.getByText('Secret').closest('button') as HTMLButtonElement
    expect(row.disabled).toBe(false)
    fireEvent.click(row)
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ skill_id: 'me:secret' }))
  })

  it('clears the query on Escape', async () => {
    render(<KitSkillPicker existingSkillIds={[]} kitVisibility="public" onAdd={vi.fn()} />)
    const input = screen.getByLabelText(/search skills to add/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'sync' } })
    expect(input.value).toBe('sync')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input.value).toBe('')
  })
})
