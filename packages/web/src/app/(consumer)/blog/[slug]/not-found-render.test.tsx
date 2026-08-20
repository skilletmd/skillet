import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * An unknown blog slug used to serve a 2222-byte shell with no title and no
 * content: `notFound()` fires after the PPR shell is already on the wire, so
 * the boundary swap never reaches the reader. The status code stays 200 (a Next
 * limitation under cacheComponents, see
 * docs/solutions/developer-experience/verifying-nextjs-route-404s.md), but the
 * body must not be blank. These assert the rendered tree, which is the part we
 * control.
 */
describe('unknown blog slug renders the branded 404 (U4)', () => {
  let dbPath: string

  beforeEach(async () => {
    dbPath = join(await mkdtemp(join(tmpdir(), 'blog-notfound-')), 'blog.db')
    process.env.BLOG_DB_PATH = dbPath
    vi.resetModules()
  })

  afterEach(async () => {
    delete process.env.BLOG_DB_PATH
    try {
      const { getBlogDb } = await import('@/lib/blog-db')
      getBlogDb().close()
    } catch {
      /* never imported by this test */
    }
    await rm(dbPath, { force: true })
  })

  it('renders the branded copy and both recovery actions', async () => {
    const { default: BlogPostPage } = await import('./page')
    render(await BlogPostPage({ params: Promise.resolve({ slug: 'no-such-post' }) }))

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      /couldn.t find that page/i,
    )
    expect(screen.getByRole('link', { name: /browse skills/i })).toBeTruthy()
    expect(screen.getByRole('link', { name: /back home/i })).toBeTruthy()
  })

  it('renders the same branded body for a draft', async () => {
    const { getBlogDb } = await import('@/lib/blog-db')
    getBlogDb()
      .prepare(`INSERT INTO posts (slug, title, author, status) VALUES ('hidden', 'H', 'T', 'draft')`)
      .run()

    const { default: BlogPostPage } = await import('./page')
    render(await BlogPostPage({ params: Promise.resolve({ slug: 'hidden' }) }))

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      /couldn.t find that page/i,
    )
  })

  it('is not an empty tree', async () => {
    const { default: BlogPostPage } = await import('./page')
    const { container } = render(
      await BlogPostPage({ params: Promise.resolve({ slug: 'no-such-post' }) }),
    )
    expect(container.textContent?.trim().length ?? 0).toBeGreaterThan(0)
  })
})
