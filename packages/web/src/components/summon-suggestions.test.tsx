// The block's job is to render a copyable line or nothing at all. The "nothing"
// half matters most: an empty state here would be a placeholder apologising for
// a kit that simply has nothing to suggest.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SummonSuggestions } from './summon-suggestions'

const three = [
  { task: 'run sprint retrospective', ref: '@phuryn/retro' },
  { task: 'draft nda', ref: '@phuryn/draft-nda' },
  { task: 'check grammar', ref: '@phuryn/grammar-check' },
]

describe('SummonSuggestions', () => {
  it('renders the full copyable line, handle included', () => {
    render(<SummonSuggestions author="phuryn" suggestions={three} />)
    expect(screen.getByText('/skillet @phuryn run sprint retrospective')).toBeTruthy()
    expect(screen.getByText('/skillet @phuryn draft nda')).toBeTruthy()
  })

  it('describes an unclaimed mirror rather than speaking as them', () => {
    render(<SummonSuggestions author="wshobson" suggestions={three} voice="third-person" />)
    expect(screen.getByText('People summon @wshobson for:')).toBeTruthy()
  })

  it('speaks as the author once the profile is claimed', () => {
    render(<SummonSuggestions author="phuryn" suggestions={three} voice="first-person" />)
    expect(screen.getByText('Summon me for:')).toBeTruthy()
  })

  it('renders nothing at all for an empty set', () => {
    const { container } = render(<SummonSuggestions author="a" suggestions={[]} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders fewer lines rather than padding to three', () => {
    render(<SummonSuggestions author="a" suggestions={three.slice(0, 1)} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
  })

  it('names the source skill so a reader can see where a line came from', () => {
    render(<SummonSuggestions author="phuryn" suggestions={three.slice(0, 1)} />)
    expect(screen.getByTitle("Copy. Uses @phuryn/retro")).toBeTruthy()
  })

  it('gives each row its own accessible copy label', () => {
    render(<SummonSuggestions author="phuryn" suggestions={three} />)
    expect(screen.getByLabelText('Copy /skillet @phuryn draft nda')).toBeTruthy()
  })

  it('uses the copy glyph rather than repeating the word down the column', () => {
    const { container } = render(<SummonSuggestions author="phuryn" suggestions={three} />)
    expect(container.querySelectorAll('svg')).toHaveLength(3)
    expect(screen.queryByText('Copy')).toBeNull()
  })

  describe('copy reporting', () => {
    let origFetch: typeof globalThis.fetch
    let origClipboard: unknown
    let posts: string[]

    beforeEach(() => {
      posts = []
      origFetch = globalThis.fetch
      globalThis.fetch = (async (url: unknown) => {
        posts.push(String(url))
        return { ok: true, status: 204 }
      }) as unknown as typeof fetch
      origClipboard = navigator.clipboard
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: vi.fn().mockResolvedValue(undefined) },
        configurable: true,
      })
    })
    afterEach(() => {
      globalThis.fetch = origFetch
      Object.defineProperty(navigator, 'clipboard', { value: origClipboard, configurable: true })
    })

    it('reports the copy to the author it was copied from', async () => {
      render(<SummonSuggestions author="phuryn" suggestions={three.slice(0, 1)} />)
      await userEvent.click(screen.getByRole('button'))
      await waitFor(() => expect(posts).toHaveLength(1))
      expect(posts[0]).toContain('authors/phuryn/suggestions/copy')
    })

    it('still copies when reporting fails', async () => {
      // The count is ours, not the visitor's. A dead endpoint must leave the
      // row behaving exactly as it does offline.
      globalThis.fetch = (async () => {
        throw new Error('offline')
      }) as unknown as typeof fetch
      render(<SummonSuggestions author="phuryn" suggestions={three.slice(0, 1)} />)
      await userEvent.click(screen.getByRole('button'))
      await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        '/skillet @phuryn run sprint retrospective',
      ))
      expect(screen.getByRole('status').textContent).toBe('Copied')
    })

    it('counts one row once however many times it is clicked', async () => {
      // Mashing a line is one person wanting it, not three.
      render(<SummonSuggestions author="phuryn" suggestions={three.slice(0, 1)} />)
      const row = screen.getByRole('button')
      await userEvent.click(row)
      await userEvent.click(row)
      await userEvent.click(row)
      await waitFor(() => expect(posts).toHaveLength(1))
    })

    it('counts two different rows separately', async () => {
      render(<SummonSuggestions author="phuryn" suggestions={three.slice(0, 2)} />)
      const rows = screen.getAllByRole('button')
      await userEvent.click(rows[0]!)
      await userEvent.click(rows[1]!)
      await waitFor(() => expect(posts).toHaveLength(2))
    })
  })
})
