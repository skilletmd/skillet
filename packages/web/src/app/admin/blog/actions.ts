'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import type { MarkdownEditorFrontmatter } from '@/components/markdown-editor'
import { getBlogDb } from '@/lib/blog-db'
import { assertAdmin } from '@/lib/admin'
import { slugify as canonicalSlugify } from '@/lib/slugify'

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function slugify(value: string): string {
  return canonicalSlugify(value, { fallback: 'untitled-post' })
}

function assertSafeSlug(slug: string): string {
  if (!SLUG_PATTERN.test(slug)) throw new Error(`Invalid blog slug: ${slug}`)
  return slug
}

function postExists(slug: string): boolean {
  const safeSlug = assertSafeSlug(slug)
  const row = getBlogDb().prepare('SELECT 1 FROM posts WHERE slug = ?').get(safeSlug)
  return row !== undefined
}

function uniqueSlug(baseSlug: string): string {
  const db = getBlogDb()
  db.exec('BEGIN IMMEDIATE')
  try {
    let candidate = assertSafeSlug(baseSlug)
    let index = 2

    while (true) {
      const info = db
        .prepare(
          `INSERT INTO posts (slug, author, status) VALUES (?, 'Skillet', 'draft')
           ON CONFLICT(slug) DO NOTHING`,
        )
        .run(candidate)
      if (info.changes === 1) {
        db.exec('COMMIT')
        return candidate
      }
      candidate = assertSafeSlug(`${baseSlug}-${index}`)
      index += 1
    }
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

function revalidatePost(slug: string): void {
  revalidatePath('/blog')
  // A story is a post, so publishing one has to refresh the news surfaces too.
  revalidatePath('/news')
  revalidatePath(`/news/${slug}`)
  revalidatePath('/feed/global')
  revalidatePath(`/blog/${slug}`)
  revalidatePath('/admin/blog')
  revalidatePath(`/admin/blog/${slug}`)
  revalidatePath(`/admin/blog/${slug}/edit`)
}

function frontmatterFromFormData(formData: FormData): MarkdownEditorFrontmatter {
  const statusRaw = String(formData.get('status') ?? 'draft')
  const tagsRaw = String(formData.get('tags') ?? '').trim()

  return {
    title: String(formData.get('title') ?? '').trim(),
    seoTitle: String(formData.get('seoTitle') ?? '').trim() || undefined,
    description: String(formData.get('description') ?? '').trim(),
    publishedAt: String(formData.get('publishedAt') ?? '').trim() || null,
    status: statusRaw === 'published' ? 'published' : 'draft',
    tags: tagsRaw
      ? tagsRaw
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean)
      : [],
  }
}

const today = () => new Date().toISOString().slice(0, 10)

/** Insert a placeholder row so a brand-new post has something to update. */
function ensureRow(slug: string): void {
  getBlogDb()
    .prepare(
      `INSERT INTO posts (slug, author, status) VALUES (?, 'Skillet', 'draft')
       ON CONFLICT(slug) DO NOTHING`,
    )
    .run(slug)
}

/**
 * Story sources, validated before they can be stored.
 *
 * A story's credibility is its sources, so a malformed one must not publish:
 * every entry needs a network, a handle and a URL. Blank input stores NULL
 * rather than an empty array, keeping ordinary blog posts untouched.
 */
function normalizeSources(raw: string | undefined): string | null {
  const text = raw?.trim()
  if (!text) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Sources must be valid JSON.')
  }
  if (!Array.isArray(parsed)) throw new Error('Sources must be a JSON array.')
  parsed.forEach((entry, i) => {
    const source = entry as Record<string, unknown>
    if (!source || typeof source.url !== 'string' || !source.url.trim()) {
      throw new Error(`Source ${i + 1} is missing a url.`)
    }
    if (typeof source.handle !== 'string' || !source.handle.trim()) {
      throw new Error(`Source ${i + 1} is missing a handle.`)
    }
    if (!['x', 'hn', 'reddit', 'web'].includes(String(source.network))) {
      throw new Error(`Source ${i + 1} needs a network of x, hn, reddit or web.`)
    }
  })
  return JSON.stringify(parsed)
}

function writePost(slug: string, content: string, frontmatter: MarkdownEditorFrontmatter): void {
  ensureRow(slug)
  getBlogDb()
    .prepare(
      `UPDATE posts SET
         title = @title,
         seo_title = @seo_title,
         description = @description,
         published_at = @published_at,
         tags_json = @tags_json,
         status = @status,
         updated_at = @updated_at,
         content = @content,
         sources_json = @sources_json,
         story_kind = @story_kind
       WHERE slug = @slug`,
    )
    .run({
      slug,
      title: frontmatter.title || 'Untitled post',
      // Blank stores NULL, not '', so the fallback is a single check.
      seo_title: frontmatter.seoTitle?.trim() || null,
      description: frontmatter.description,
      published_at: frontmatter.publishedAt || null,
      tags_json: JSON.stringify(frontmatter.tags ?? []),
      status: frontmatter.status,
      updated_at: today(),
      content,
      sources_json: normalizeSources(frontmatter.sourcesJson),
      story_kind: frontmatter.storyKind?.trim() || null,
    })
}

export async function togglePostStatus(slug: string): Promise<void> {
  await assertAdmin()
  const safeSlug = assertSafeSlug(slug)
  const info = getBlogDb()
    .prepare(
      `UPDATE posts SET
         status = CASE WHEN status = 'published' THEN 'draft' ELSE 'published' END,
         updated_at = ?
       WHERE slug = ?`,
    )
    .run(today(), safeSlug)
  if (info.changes === 0) throw new Error(`Post not found: ${slug}`)
  revalidatePost(safeSlug)
}

export async function savePost(slug: string, formData: FormData): Promise<void> {
  await assertAdmin()
  const safeSlug = assertSafeSlug(slug)
  if (!postExists(safeSlug)) throw new Error(`Post not found: ${slug}`)
  const body = String(formData.get('body') ?? '')

  writePost(safeSlug, body, frontmatterFromFormData(formData))
  revalidatePost(safeSlug)
  redirect(`/admin/blog/${safeSlug}?saved=1`)
}

export async function saveBlogPost(
  currentSlug: string | null,
  content: string,
  frontmatter: MarkdownEditorFrontmatter,
): Promise<{ slug: string }> {
  await assertAdmin()
  const slug = currentSlug ? assertSafeSlug(currentSlug) : uniqueSlug(slugify(frontmatter.title))

  writePost(slug, content, frontmatter)
  revalidatePost(slug)

  return { slug }
}
