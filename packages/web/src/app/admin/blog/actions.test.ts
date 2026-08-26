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

  // A story's credibility is its sources, so a malformed one must not publish.
  // These run through the real save path, not the validator in isolation.
  const storyFrontmatter = (sourcesJson: string) => ({
    title: 'A story',
    description: 'summary',
    publishedAt: '2026-08-25',
    status: 'published' as const,
    tags: ['story'],
    sourcesJson,
    storyKind: 'debate',
  })

  it('stores valid story sources and the kind', async () => {
    const { saveBlogPost } = await import('./actions')
    const { getBlogDb } = await import('@/lib/blog-db')
    const sources = [
      { network: 'x', handle: 'tobi', label: 'Tobi Lütke', detail: '621K views', url: 'https://x.com/tobi/status/1' },
    ]
    const { slug } = await saveBlogPost(null, 'body', storyFrontmatter(JSON.stringify(sources)))
    const row = getBlogDb()
      .prepare('SELECT sources_json, story_kind FROM posts WHERE slug = ?')
      .get(slug) as { sources_json: string; story_kind: string }
    expect(JSON.parse(row.sources_json)).toEqual(sources)
    expect(row.story_kind).toBe('debate')
  })

  it('refuses a source with no url', async () => {
    const { saveBlogPost } = await import('./actions')
    await expect(
      saveBlogPost(null, 'body', storyFrontmatter(JSON.stringify([{ network: 'x', handle: 'tobi' }]))),
    ).rejects.toThrow(/Source 1 is missing a url/)
  })

  it('refuses a source with an unknown network', async () => {
    const { saveBlogPost } = await import('./actions')
    await expect(
      saveBlogPost(
        null,
        'body',
        storyFrontmatter(JSON.stringify([{ network: 'mastodon', handle: 'a', url: 'https://x' }])),
      ),
    ).rejects.toThrow(/network of x, hn, reddit or web/)
  })

  it('refuses malformed JSON rather than storing it', async () => {
    const { saveBlogPost } = await import('./actions')
    await expect(saveBlogPost(null, 'body', storyFrontmatter('{not json'))).rejects.toThrow(
      /valid JSON/,
    )
  })

  it('leaves an ordinary post with no sources column set', async () => {
    const { saveBlogPost } = await import('./actions')
    const { getBlogDb } = await import('@/lib/blog-db')
    const { slug } = await saveBlogPost(null, 'body', {
      title: 'Just a post',
      description: 'd',
      publishedAt: null,
      status: 'draft',
      tags: ['skills'],
    })
    const row = getBlogDb()
      .prepare('SELECT sources_json FROM posts WHERE slug = ?')
      .get(slug) as { sources_json: string | null }
    expect(row.sources_json).toBeNull()
  })
})
