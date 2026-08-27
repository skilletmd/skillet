// The block's job is to render a copyable line or nothing at all. The "nothing"
// half matters most: an empty state here would be a placeholder apologising for
// a kit that simply has nothing to suggest.
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
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
    expect(screen.getByText('People summon @wshobson for')).toBeTruthy()
  })

  it('speaks as the author once the profile is claimed', () => {
    render(<SummonSuggestions author="phuryn" suggestions={three} voice="first-person" />)
    expect(screen.getByText('Summon me for')).toBeTruthy()
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
    expect(screen.getByTitle('Copy — uses @phuryn/retro')).toBeTruthy()
  })
})
