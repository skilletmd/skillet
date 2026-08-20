import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// The catalog half of the sitemap needs the registry; this suite is about the
// blog half, so the registry is stubbed empty.
vi.mock('@/lib/registry', () => ({
  getSkillCatalog: async () => ({ skills: [], total: 0, limit: 0, offset: 0 }),
  getKitCatalog: async () => ({ items: [], total: 0, limit: 0, offset: 0 }),
  getAllAuthorUsernames: async () => [],
}))

type Entry = { url: string; lastModified?: string | Date }

async function seed(rows: Array<Record<string, string | null>>) {
  const { getBlogDb } = await import('@/lib/blog-db')
  const db = getBlogDb()
  for (const r of rows) {
    db.prepare(
      `INSERT INTO posts (slug, title, status, published_at, updated_at)
       VALUES (@slug, @title, 'published', @published_at, @updated_at)`,
    ).run({ title: 'T', published_at: null, updated_at: null, ...r })
  }
}

const blogEntries = (all: Entry[]) => all.filter((e) => /\/blog\//.test(e.url))
const nonBlog = (all: Entry[]) => all.filter((e) => !/\/blog\//.test(e.url))

describe('sitemap lastmod (U7)', () => {
  let dbPath: string

  beforeEach(async () => {
    dbPath = join(await mkdtemp(join(tmpdir(), 'sitemap-')), 'blog.db')
    process.env.BLOG_DB_PATH = dbPath
    vi.resetModules()
  })

  afterEach(async () => {
    delete process.env.BLOG_DB_PATH
    try {
      const { getBlogDb } = await import('@/lib/blog-db')
      getBlogDb().close()
    } catch {
      /* never imported */
    }
    await rm(dbPath, { force: true })
  })

  it('uses updatedAt when the post has one', async () => {
    await seed([{ slug: 'edited', published_at: '2026-01-01', updated_at: '2026-08-19' }])
    const { default: sitemap } = await import('./sitemap')
    const entry = blogEntries(await sitemap())[0]

    expect(entry.url).toContain('/blog/edited')
    expect(String(entry.lastModified)).toContain('2026-08-19')
  })

  it('falls back to publishedAt when updatedAt is null', async () => {
    await seed([{ slug: 'never-edited', published_at: '2026-01-15', updated_at: null }])
    const { default: sitemap } = await import('./sitemap')
    const entry = blogEntries(await sitemap())[0]

    expect(String(entry.lastModified)).toContain('2026-01-15')
  })

  it('omits lastModified entirely when both dates are null', async () => {
    await seed([{ slug: 'undated', published_at: null, updated_at: null }])
    const { default: sitemap } = await import('./sitemap')
    const entry = blogEntries(await sitemap())[0]

    // An absent key beats an Invalid Date, which would break the XML.
    expect(entry.lastModified).toBeUndefined()
    expect('lastModified' in entry).toBe(false)
  })

  it('leaves non-blog routes without a lastModified', async () => {
    await seed([{ slug: 'a-post', published_at: '2026-01-01', updated_at: null }])
    const { default: sitemap } = await import('./sitemap')

    expect(nonBlog(await sitemap()).every((e) => e.lastModified === undefined)).toBe(true)
  })
})
