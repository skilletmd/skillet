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
})
