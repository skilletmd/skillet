import { describe, it, expect } from 'vitest'
import { formatTokens, pluralize } from '@/lib/format'

describe('formatTokens', () => {
  it('shows the raw rounded integer with a tilde below 1000', () => {
    expect(formatTokens(840)).toBe('~840')
    expect(formatTokens(999)).toBe('~999')
  })

  it('shows one decimal in K below 10K', () => {
    expect(formatTokens(1000)).toBe('~1.0K')
    expect(formatTokens(1320)).toBe('~1.3K')
    expect(formatTokens(4200)).toBe('~4.2K')
  })

  it('drops the decimal at or above 10K', () => {
    expect(formatTokens(47000)).toBe('~47K')
  })

  it('returns ~0 for zero (callers guard on presence)', () => {
    expect(formatTokens(0)).toBe('~0')
  })
})

describe('pluralize', () => {
  it('returns the singular form for a count of 1', () => {
    expect(pluralize(1, 'skill')).toBe('skill')
  })

  it('returns the default plural (+s) for a count of 0', () => {
    expect(pluralize(0, 'skill')).toBe('skills')
  })

  it('returns the default plural (+s) for a count greater than 1', () => {
    expect(pluralize(2, 'skill')).toBe('skills')
  })

  it('uses the explicit plural for irregular words', () => {
    expect(pluralize(2, 'is', 'are')).toBe('are')
  })
})
