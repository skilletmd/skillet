import { getBlogDb } from './blog-db'

export type PostStatus = 'draft' | 'published'

export interface PostFrontmatter {
  title: string
  /** Optional `<title>` override, so a long display headline can still ship a
   *  SERP-length title tag. Unset falls back to `title`. */
  seoTitle?: string
  slug: string
  description: string
  author: string
  authorBio?: string
  authorAvatar?: string
  publishedAt: string | null
  updatedAt?: string
  tags: string[]
  ogImage?: string
  featured?: boolean
  readTime?: number
  status?: PostStatus
}

export interface Post extends PostFrontmatter {
  content: string
  status: PostStatus
}

interface PostRow {
  slug: string
  title: string
  seo_title: string | null
  description: string
  author: string
  author_bio: string | null
  author_avatar: string | null
  published_at: string | null
  updated_at: string | null
  tags_json: string
  og_image: string | null
  featured: number
  read_time: number | null
  status: string
  content: string
}

function calcReadTime(content: string): number {
  const words = content.trim().split(/\s+/).length
  return Math.max(1, Math.round(words / 200))
}

function rowToPost(row: PostRow): Post {
  let tags: string[] = []
  try {
    const parsed = JSON.parse(row.tags_json)
    if (Array.isArray(parsed)) tags = parsed
  } catch {
    tags = []
  }

  return {
    title: row.title,
    seoTitle: row.seo_title ?? undefined,
    slug: row.slug,
    description: row.description,
    author: row.author,
    authorBio: row.author_bio ?? undefined,
    authorAvatar: row.author_avatar ?? undefined,
    publishedAt: row.published_at,
    updatedAt: row.updated_at ?? undefined,
    tags,
    ogImage: row.og_image ?? undefined,
    featured: row.featured === 1,
    readTime: row.read_time ?? calcReadTime(row.content),
    status: row.status === 'published' ? 'published' : 'draft',
    content: row.content,
  }
}

/** The post's `<title>` text: the SEO override when set, else the headline.
 *  Display headings always use `title` — the two deliberately diverge. */
export function postTitleTag(post: { title: string; seoTitle?: string }): string {
  const override = post.seoTitle?.trim()
  return override ? override : post.title
}

export function getPostSlugs(): string[] {
  const rows = getBlogDb().prepare('SELECT slug FROM posts').all() as Array<{ slug: string }>
  return rows.map((r) => r.slug)
}

export function getPost(slug: string, { includeDrafts = false } = {}): Post | null {
  const row = getBlogDb().prepare('SELECT * FROM posts WHERE slug = ?').get(slug) as
    | PostRow
    | undefined
  if (!row) return null

  const post = rowToPost(row)
  if (!includeDrafts && post.status === 'draft') return null
  return post
}

/**
 * Newest-published-first, drafts (null publishedAt) last. SQLite sorts NULLs
 * first by default, so the leading `published_at IS NULL` pushes them to the
 * end to match the prior filesystem ordering.
 */
const ORDER_BY = 'ORDER BY published_at IS NULL, published_at DESC'

/** Returns only published posts, sorted newest-first. Used on the public blog. */
export function getAllPosts(): Post[] {
  const rows = getBlogDb()
    .prepare(`SELECT * FROM posts WHERE status = 'published' ${ORDER_BY}`)
    .all() as unknown as PostRow[]
  return rows.map(rowToPost)
}

/** Returns all posts including drafts, sorted newest-first. Used in the admin view. */
export function getAllPostsAdmin(): Post[] {
  const rows = getBlogDb().prepare(`SELECT * FROM posts ${ORDER_BY}`).all() as unknown as PostRow[]
  return rows.map(rowToPost)
}
