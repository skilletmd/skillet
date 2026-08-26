import { getBlogDb } from './blog-db'

export type PostStatus = 'draft' | 'published'

/** One cited source under a story. Network drives the mark; label says what the
 *  source contributes ("Anthropic's reply"); detail carries reach. */
/** The skill a story is about. `slug` is the name as written; `repo` is
 *  owner/name, which is what the import path needs when we do not carry it. */
export interface StorySubject {
  slug: string | null
  repo: string | null
}

export interface StorySource {
  network: 'x' | 'hn' | 'reddit' | 'web'
  handle: string
  label: string
  detail?: string | null
  url: string
  avatarUrl?: string | null
}

/** Tag marking a post as an edition of the Skillet Daily feed's story stream. */
export const STORY_TAG = 'story'

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
  /** Present on story posts; empty for ordinary blog posts. */
  sources?: StorySource[]
  storyKind?: string
  /** What a skill story is ABOUT, so the card can offer to add it. A story
   *  that describes a skill and gives no way to get it is a dead end. */
  subject?: StorySubject
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
  sources_json: string | null
  story_kind: string | null
  subject_json: string | null
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
    sources: parseSources(row.sources_json),
    storyKind: row.story_kind ?? undefined,
    subject: parseSubject(row.subject_json),
  }
}

/** The skill a story is about, when it is about one. Same no-throw contract as
 *  parseSources: a malformed blob costs an add button, never the feed. */
function parseSubject(raw: string | null): StorySubject | undefined {
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return undefined
    const slug = typeof parsed.slug === 'string' ? parsed.slug : null
    const repo = typeof parsed.repo === 'string' ? parsed.repo : null
    return slug || repo ? { slug, repo } : undefined
  } catch {
    return undefined
  }
}

/** Sources, or an empty list. A malformed blob must not take down the feed the
 *  post appears in, so this never throws. */
function parseSources(raw: string | null): StorySource[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (s): s is StorySource =>
        Boolean(s) && typeof s.url === 'string' && typeof s.handle === 'string',
    )
  } catch {
    return []
  }
}

/**
 * Published stories, newest first.
 *
 * Stories ride the blog store rather than a table of their own: drafts, the
 * publish gate, the admin editor and the feed builder all already exist here,
 * and a second CMS would duplicate every one of them.
 */
export function getStories(): Post[] {
  return getAllPosts().filter((p) => p.tags.includes(STORY_TAG))
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
