import { describe, expect, it } from 'vitest'
import { humanizeSlug } from '@/lib/humanize-slug'

describe('humanizeSlug', () => {
  it('title-cases with lowercase minor words', () => {
    expect(humanizeSlug('deploy-to-vercel')).toBe('Deploy to Vercel')
    expect(humanizeSlug('write-a-skill')).toBe('Write a Skill')
    expect(humanizeSlug('test-coverage-gaps')).toBe('Test Coverage Gaps')
  })

  it('keeps minor words capitalized at the edges', () => {
    expect(humanizeSlug('to-the-moon')).toBe('To the Moon')
    expect(humanizeSlug('what-its-for')).toBe('What Its For')
  })

  it('preserves acronyms and mixed-case terms', () => {
    expect(humanizeSlug('pr-review-strict')).toBe('PR Review Strict')
    expect(humanizeSlug('deploy-to-github')).toBe('Deploy to GitHub')
    expect(humanizeSlug('intro-to-nextjs')).toBe('Intro to Next.js')
  })

  // Two-letter tokens default to uppercase rather than being enumerated, so an
  // initialism nobody listed still reads right.
  it('uppercases two-letter initialisms, listed or not', () => {
    expect(humanizeSlug('ui-skills')).toBe('UI Skills')
    expect(humanizeSlug('pm-skills')).toBe('PM Skills')
    expect(humanizeSlug('ui-skills-root')).toBe('UI Skills Root')
    expect(humanizeSlug('qa-versioned')).toBe('QA Versioned')
    expect(humanizeSlug('os-tuning')).toBe('OS Tuning')
    expect(humanizeSlug('vc-updates')).toBe('VC Updates')
  })

  it('leaves ordinary two-letter words alone', () => {
    expect(humanizeSlug('go-fast')).toBe('Go Fast')
    expect(humanizeSlug('up-next')).toBe('Up Next')
    expect(humanizeSlug('my-skills')).toBe('My Skills')
    expect(humanizeSlug('no-ai-slop')).toBe('No AI Slop')
    expect(humanizeSlug('in-progress')).toBe('In Progress')
  })

  // The registry generates kit names through the same function, so a repo name
  // with no separators, or with a slash, must survive the trip.
  it('handles repo names as well as slugs', () => {
    expect(humanizeSlug('taste-skill')).toBe('Taste Skill')
    expect(humanizeSlug('open-mercato')).toBe('Open Mercato')
    expect(humanizeSlug('hyperframes')).toBe('Hyperframes')
  })
})
