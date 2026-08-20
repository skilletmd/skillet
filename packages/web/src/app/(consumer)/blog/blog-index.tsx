import type { CSSProperties } from 'react'
import Link from 'next/link'
import type { Post } from '@/lib/blog'
import { PAGE_CONTAINER_CLASS } from '@/lib/page-layout'
import { blogHref } from '@/lib/urls'
import { panelHues } from '@/lib/docs-panel'

// The masthead. Two words at display size read as a section name, not as a
// post headline, so it can carry real weight without competing with the lead
// story. It is the page's h1, so the outline runs h1 > h2 (lead story) >
// h3 (grid stories) instead of starting at h2, which is how it shipped.
const PAGE_HEADING = 'Skillet Blog'
const MASTHEAD_CLASS =
  'text-display font-semibold leading-[1.02] tracking-[-0.035em]'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Headline category for the kicker. "skills" tags almost every post, so prefer
 * the more specific tag and fall back to the first one. */
function category(tags: string[]): string {
  return tags.find((t) => t !== 'skills') ?? tags[0] ?? 'blog'
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
  // Accept a bare date (YYYY-MM-DD) or a full ISO datetime; take the date part.
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return iso
  return `${MONTHS[m - 1]} ${d}, ${y}`
}

/**
 * Each story sits on its own soft two-hue wash, the same treatment the docs use
 * for their illustration panels (`.docs-img-panel` + `panelHues`). Seeded on the
 * slug, so a post's colour is stable across reloads and neighbouring cards
 * differ. Low saturation on purpose: the headline stays the hero.
 */
function panelStyle(seed: string): CSSProperties {
  const { g1, g2 } = panelHues(seed)
  return { '--g1': g1, '--g2': g2 } as CSSProperties
}

function Kicker({ tags }: { tags: string[] }) {
  return (
    <span className="font-mono text-xs uppercase tracking-[0.08em] text-(--accent)">
      {category(tags)}
    </span>
  )
}

/** Date and length only. The author is carried on the post itself, not here:
 *  on an index of one person's writing the byline is noise on every card. */
function Byline({ post }: { post: Post }) {
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 text-sm text-(--ink-2)">
      {post.publishedAt && <span>{formatDate(post.publishedAt)}</span>}
      {post.publishedAt && post.readTime && <span aria-hidden>·</span>}
      {post.readTime && <span>{post.readTime} min read</span>}
    </div>
  )
}

/** One story card. Every post gets the same card: the old lead/grid split only
 *  earned its keep at five or more posts and read lopsided below that. A
 *  `featured` post still leads, it is just no longer a different shape. */
function StoryCard({ post }: { post: Post }) {
  return (
    <Link
      href={blogHref(post.slug)}
      className="docs-img-panel group flex h-full flex-col rounded-2xl p-6"
      style={panelStyle(post.slug)}
    >
      <Kicker tags={post.tags} />
      <h2 className="mt-2 text-2xl font-semibold leading-[1.15] tracking-[-0.02em] group-hover:underline">
        {post.title}
      </h2>
      <p className="mt-2 leading-[1.55] text-(--ink-2)">{post.description}</p>
      {/* mt-auto pins the meta to the card floor, so it lines up across a row
          regardless of how long each headline and description run. */}
      <div className="mt-auto pt-6">
        <Byline post={post} />
      </div>
    </Link>
  )
}

export function BlogIndex({ posts }: { posts: Post[] }) {
  if (posts.length === 0) {
    return (
      <main className={PAGE_CONTAINER_CLASS}>
        <h1 className={MASTHEAD_CLASS}>{PAGE_HEADING}</h1>
        <p className="mt-6 text-(--ink-2)">No posts yet.</p>
      </main>
    )
  }

  // A featured post leads; everything else keeps the store's newest-first order.
  const ordered = [...posts].sort((a, b) => Number(b.featured) - Number(a.featured))

  return (
    <main className={PAGE_CONTAINER_CLASS}>
      {/* No rule under the mast: the cards already separate the sections. */}
      <h1 className={MASTHEAD_CLASS}>{PAGE_HEADING}</h1>

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        {ordered.map((post) => (
          <StoryCard key={post.slug} post={post} />
        ))}
      </div>
    </main>
  )
}
