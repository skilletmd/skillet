import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * The posts schema is declared twice — `migrate()` here and the prebuild
 * bootstrap in scripts/ensure-blog-db.mjs — and both use CREATE TABLE IF NOT
 * EXISTS, which will not add a column to a database that already holds rows.
 * Production's blog.db is exactly that case, so the column add has to be
 * separately idempotent. These cover that, and the title fallback that keeps an
 * unset seo_title rendering today's behavior.
 */
describe('blog store', () => {
  let dbPath: string

  beforeEach(async () => {
    dbPath = join(await mkdtemp(join(tmpdir(), 'blog-store-')), 'blog.db')
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

  describe('seo_title migration (U6)', () => {
    it('adds the column to a fresh database', async () => {
      const { getBlogDb } = await import('@/lib/blog-db')
      const cols = getBlogDb()
        .prepare('SELECT name FROM pragma_table_info(?)')
        .all('posts') as Array<{ name: string }>
      expect(cols.map((c) => c.name)).toContain('seo_title')
    })

    it('is a no-op the second time and does not throw', async () => {
      const { getBlogDb, migrate } = await import('@/lib/blog-db')
      const db = getBlogDb()
      expect(() => migrate(db)).not.toThrow()
      expect(() => migrate(db)).not.toThrow()
    })

    it('adds the column to a populated database without losing rows', async () => {
      // Simulate production: a table created before the column existed.
      const { DatabaseSync } = await import('node:sqlite')
      const legacy = new DatabaseSync(dbPath)
      legacy.exec(`
        CREATE TABLE posts (
          slug TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '',
          description TEXT NOT NULL DEFAULT '', author TEXT NOT NULL DEFAULT '',
          author_bio TEXT, author_avatar TEXT, published_at TEXT, updated_at TEXT,
          tags_json TEXT NOT NULL DEFAULT '[]', og_image TEXT,
          featured INTEGER NOT NULL DEFAULT 0, read_time INTEGER,
          status TEXT NOT NULL DEFAULT 'draft', content TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
      `)
      legacy
        .prepare(`INSERT INTO posts (slug, title, status) VALUES ('kept', 'Kept', 'published')`)
        .run()
      legacy.close()

      const { getBlogDb } = await import('@/lib/blog-db')
      const db = getBlogDb()
      const cols = (db.prepare('SELECT name FROM pragma_table_info(?)').all('posts') as Array<{
        name: string
      }>).map((c) => c.name)

      expect(cols).toContain('seo_title')
      const row = db.prepare('SELECT title, seo_title FROM posts WHERE slug = ?').get('kept')
      expect(row).toMatchObject({ title: 'Kept', seo_title: null })
    })
  })

  describe('postTitleTag (U6)', () => {
    it('prefers seoTitle when set', async () => {
      const { postTitleTag } = await import('@/lib/blog')
      expect(postTitleTag({ title: 'Display headline', seoTitle: 'Short SEO title' })).toBe(
        'Short SEO title',
      )
    })

    it('falls back to the display title when seoTitle is unset', async () => {
      const { postTitleTag } = await import('@/lib/blog')
      expect(postTitleTag({ title: 'Display headline' })).toBe('Display headline')
    })

    it('treats an empty or whitespace seoTitle as unset', async () => {
      const { postTitleTag } = await import('@/lib/blog')
      expect(postTitleTag({ title: 'Display headline', seoTitle: '' })).toBe('Display headline')
      expect(postTitleTag({ title: 'Display headline', seoTitle: '   ' })).toBe('Display headline')
    })
  })
})
