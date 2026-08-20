import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BlogIndex } from './blog-index'
import type { Post } from '@/lib/blog'

/**
 * The blog index is the page best positioned to rank for the section's topic,
 * and it shipped with no `h1` at all: the eyebrow was a `<p>`, so the outline
 * started at the lead story's `h2`. These assert the outline, not the styling.
 */
function post(overrides: Partial<Post> = {}): Post {
  return {
    slug: 'a-post',
    title: 'A post title',
    description: 'A post description.',
    author: 'Taylor',
    publishedAt: '2026-08-19',
    tags: ['skills'],
    status: 'published',
    content: 'Body.',
    ...overrides,
  } as Post
}

function headingLevels(container: HTMLElement): number[] {
  return [...container.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((el) =>
    Number(el.tagName.slice(1)),
  )
}

describe('BlogIndex heading outline (U3)', () => {
  it('renders exactly one h1', () => {
    render(
      <BlogIndex
        posts={[post(), post({ slug: 'b', title: 'B' }), post({ slug: 'c', title: 'C' })]}
      />,
    )
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('starts at h1 and never skips a level', () => {
    const { container } = render(
      <BlogIndex
        posts={[post(), post({ slug: 'b', title: 'B' }), post({ slug: 'c', title: 'C' })]}
      />,
    )
    const levels = headingLevels(container)

    // The concrete shape: h1 masthead, then one h2 per story card.
    expect(levels[0]).toBe(1)
    expect(levels.slice(1).every((l) => l === 2)).toBe(true)
  })

  it('still renders an h1 when there are no posts', () => {
    render(<BlogIndex posts={[]} />)
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })
})
