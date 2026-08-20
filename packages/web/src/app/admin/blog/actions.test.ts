import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/admin', () => ({
  assertAdmin: vi.fn(async () => undefined),
}))

describe('blog admin actions', () => {
  let dbPath: string

  beforeEach(async () => {
    dbPath = join(await mkdtemp(join(tmpdir(), 'blog-actions-')), 'blog.db')
    process.env.BLOG_DB_PATH = dbPath
    vi.resetModules()
  })

  afterEach(async () => {
    delete process.env.BLOG_DB_PATH
    // Close the sqlite handle before unlinking. POSIX happily unlinks an open
    // file, but Windows locks it and rm fails with EBUSY.
    try {
      const { getBlogDb } = await import('@/lib/blog-db')
      getBlogDb().close()
    } catch {
      /* module never imported by this test, or already closed */
    }
    await rm(dbPath, { force: true })
  })

  it('toggles status atomically', async () => {
    const { getBlogDb } = await import('@/lib/blog-db')
    getBlogDb().prepare(`INSERT INTO posts (slug, title, status) VALUES ('toggle-me', 'T', 'draft')`).run()

    const { togglePostStatus } = await import('./actions')
    await togglePostStatus('toggle-me')
    let row = getBlogDb()
      .prepare('SELECT status FROM posts WHERE slug = ?')
      .get('toggle-me') as { status: string }
    expect(row.status).toBe('published')

    await togglePostStatus('toggle-me')
    row = getBlogDb()
      .prepare('SELECT status FROM posts WHERE slug = ?')
      .get('toggle-me') as { status: string }
    expect(row.status).toBe('draft')
  })

  it('allocates unique slugs under contention', async () => {
    const { getBlogDb } = await import('@/lib/blog-db')
    getBlogDb().prepare(`INSERT INTO posts (slug, title, status) VALUES ('my-post', 'Taken', 'draft')`).run()

    const { saveBlogPost } = await import('./actions')
    const result = await saveBlogPost(null, '# body', {
      title: 'My Post',
      description: '',
      publishedAt: null,
      status: 'draft',
      tags: [],
    })
    expect(result.slug).toBe('my-post-2')
  })

  it('persists an SEO title, and stores blank as NULL so the fallback is one check', async () => {
    const { saveBlogPost } = await import('./actions')
    const base = {
      title: 'A very long display headline that would truncate in a SERP',
      description: '',
      publishedAt: null,
      status: 'draft' as const,
      tags: [],
    }

    const { slug } = await saveBlogPost(null, '# body', { ...base, seoTitle: 'Short tag' })
    const { getBlogDb } = await import('@/lib/blog-db')
    const read = () =>
      getBlogDb().prepare('SELECT seo_title FROM posts WHERE slug = ?').get(slug) as {
        seo_title: string | null
      }
    expect(read().seo_title).toBe('Short tag')

    await saveBlogPost(slug, '# body', { ...base, seoTitle: '   ' })
    expect(read().seo_title).toBeNull()
  })
})
