import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Blog metadata is generated from the sqlite store, so each test gets its own
// throwaway DB via BLOG_DB_PATH (same shape as the admin actions suite).
// `getBlogDb` memoizes its handle at module scope, so every test re-imports
// through `vi.resetModules()` in beforeEach.

async function seedPost(fields: Record<string, string | number | null> = {}) {
  const { getBlogDb } = await import('@/lib/blog-db')
  const row = {
    slug: 'a-post',
    title: 'A post title',
    description: 'A post description.',
    author: 'Taylor',
    published_at: '2026-08-19T15:00:00Z',
    og_image: null,
    status: 'published',
    content: 'Body copy.',
    ...fields,
  }
  getBlogDb()
    .prepare(
      `INSERT INTO posts (slug, title, description, author, published_at, og_image, status, content)
       VALUES (@slug, @title, @description, @author, @published_at, @og_image, @status, @content)`,
    )
    .run(row)
  return String(row.slug)
}

async function metadataFor(slug: string) {
  const { generateMetadata } = await import('./page')
  return generateMetadata({ params: Promise.resolve({ slug }) })
}

describe('blog post metadata', () => {
  let dbPath: string

  beforeEach(async () => {
    dbPath = join(await mkdtemp(join(tmpdir(), 'blog-metadata-')), 'blog.db')
    process.env.BLOG_DB_PATH = dbPath
    const { vi } = await import('vitest')
    vi.resetModules()
  })

  afterEach(async () => {
    delete process.env.BLOG_DB_PATH
    try {
      const { getBlogDb } = await import('@/lib/blog-db')
      getBlogDb().close()
    } catch {
      /* never imported by this test, or already closed */
    }
    await rm(dbPath, { force: true })
  })

  describe('share card (U1)', () => {
    it('leaves images to the opengraph-image file convention when the post sets no ogImage', async () => {
      const slug = await seedPost()
      const meta = await metadataFor(slug)

      // Next appends a build hash to the file-convention route
      // (/blog/[slug]/opengraph-image-<hash>), so any path this module hardcodes
      // is guaranteed to 404. Emitting nothing lets Next inject the real URL.
      expect(meta.openGraph?.images).toBeUndefined()
      expect(meta.twitter?.images).toBeUndefined()
      expect(JSON.stringify(meta)).not.toContain('opengraph-image')
    })

    it('honors an explicit ogImage on both the OG and Twitter card', async () => {
      const slug = await seedPost({ og_image: 'https://cdn.example.com/card.png' })
      const meta = await metadataFor(slug)

      expect(JSON.stringify(meta.openGraph?.images)).toContain(
        'https://cdn.example.com/card.png',
      )
      expect(JSON.stringify(meta.twitter?.images)).toContain(
        'https://cdn.example.com/card.png',
      )
    })

    it('returns without throwing for an unknown slug', async () => {
      await expect(metadataFor('no-such-post')).resolves.toBeDefined()
    })
  })

  describe('seo title override (U6)', () => {
    it('uses the SEO title in the title tag when set', async () => {
      const slug = await seedPost()
      const { getBlogDb } = await import('@/lib/blog-db')
      getBlogDb().prepare('UPDATE posts SET seo_title = ? WHERE slug = ?').run('Short tag', slug)

      const meta = await metadataFor(slug)
      expect(meta.title).toBe('Short tag · Skillet')
    })

    it('leaves the OG and Twitter titles on the display headline', async () => {
      const slug = await seedPost()
      const { getBlogDb } = await import('@/lib/blog-db')
      getBlogDb().prepare('UPDATE posts SET seo_title = ? WHERE slug = ?').run('Short tag', slug)

      const meta = await metadataFor(slug)
      expect(meta.openGraph?.title).toBe('A post title')
      expect(meta.twitter?.title).toBe('A post title')
    })

    it('falls back to the headline when unset', async () => {
      const slug = await seedPost()
      const meta = await metadataFor(slug)
      expect(meta.title).toBe('A post title · Skillet')
    })
  })

  describe('unknown and draft slugs (U4)', () => {
    it('marks an unknown slug noindex', async () => {
      const meta = await metadataFor('no-such-post')
      expect(meta.robots).toEqual({ index: false, follow: false })
    })

    it('marks a draft noindex, since drafts are not public', async () => {
      const slug = await seedPost({ status: 'draft' })
      const meta = await metadataFor(slug)
      expect(meta.robots).toEqual({ index: false, follow: false })
    })

    it('leaves a published post indexable', async () => {
      const slug = await seedPost()
      const meta = await metadataFor(slug)
      expect(meta.robots).toBeUndefined()
    })
  })

  describe('canonical and og:url (U2)', () => {
    it('declares a self-referencing canonical', async () => {
      const slug = await seedPost()
      const meta = await metadataFor(slug)

      expect(meta.alternates?.canonical).toBe('/blog/a-post')
    })

    it('emits og:url matching the canonical', async () => {
      const slug = await seedPost()
      const meta = await metadataFor(slug)

      expect(meta.openGraph?.url).toBe('/blog/a-post')
    })
  })
})
