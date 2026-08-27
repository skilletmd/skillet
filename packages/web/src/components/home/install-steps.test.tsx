// The hero is the most-visited page on the site and the one place a hardcoded
// script can claim something an author does not actually do. These pin the
// all-or-nothing cast rule and the mapping from a stored suggestion.
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { peopleFromSuggestions, SummonDemo } from './install-steps'

const row = (handle: string, task: string, slug: string) => ({
  handle,
  name: handle,
  task,
  slug,
})

describe('peopleFromSuggestions', () => {
  it('carries the author, task and slug through unchanged', () => {
    const [p] = peopleFromSuggestions([row('cloudflare', 'set up sandbox app', 'sandbox-next')])
    expect(p!.handle).toBe('cloudflare')
    expect(p!.task).toBe('set up sandbox app')
    expect(p!.slug).toBe('sandbox-next')
  })

  it('reads the slug back as words for the reply link', () => {
    const [p] = peopleFromSuggestions([row('azure', 'x', 'azure-cost-analysis')])
    expect(p!.specialty).toBe('azure cost analysis')
  })

  it('gives every generated person the same reply template', () => {
    // The hand-written replies vary on purpose so the script does not read as
    // one template. That charm is the cost of being true about real authors.
    const people = peopleFromSuggestions([row('a', 't', 's'), row('b', 't', 's')])
    expect(people[0]!.reply).toEqual(people[1]!.reply)
  })

  it('maps an empty list to an empty cast', () => {
    expect(peopleFromSuggestions([])).toEqual([])
  })
})

describe('SummonDemo cast selection', () => {
  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) => row(`author${i}`, `task ${i}`, `slug-${i}`))

  it('plays real authors when enough of them qualify', () => {
    render(<SummonDemo people={rows(5)} />)
    expect(screen.getByText(/task 0/)).toBeTruthy()
  })

  it('falls back to the hardcoded script when none qualify', () => {
    render(<SummonDemo people={[]} />)
    expect(screen.getByText(/audit my Core Web Vitals/)).toBeTruthy()
  })

  it('falls back rather than mixing when too few qualify', () => {
    // A half-real cast is harder to reason about than either.
    render(<SummonDemo people={rows(2)} />)
    expect(screen.getByText(/audit my Core Web Vitals/)).toBeTruthy()
    expect(screen.queryByText(/task 0/)).toBeNull()
  })

  it('plays the hardcoded script when given no prop at all', () => {
    render(<SummonDemo />)
    expect(screen.getByText(/audit my Core Web Vitals/)).toBeTruthy()
  })
})
