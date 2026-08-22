import type { Metadata } from 'next'
import { markdownAlternates } from '@/lib/markdown-alternate'
import Link from 'next/link'
import { MarkdownContent } from '@/components/markdown-content'
import { NotFoundBody } from '@/components/not-found-body'
import { PostShare } from '@/components/post-share'
import { Avatar } from '@/components/ui/avatar'
import { getAllPosts, getPost, postTitleTag, type Post } from '@/lib/blog'
import { blogHref } from '@/lib/urls'
import { PAGE_CONTAINER_CLASS } from '@/lib/page-layout'
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://skillet.md'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

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

/** Most-related published posts: rank by shared tags, then recency. */
function relatedPosts(current: Post, limit = 4): Post[] {
  return getAllPosts()
    .filter((p) => p.slug !== current.slug)
    .map((p) => ({ p, shared: p.tags.filter((t) => current.tags.includes(t)).length }))
    .sort((a, b) => b.shared - a.shared)
    .slice(0, limit)
    .map((x) => x.p)
}

// No generateStaticParams: blog content lives on the server's disk (never in the
// repo), so the build always runs against an empty blog DB — prebuilding is
// impossible and an empty generateStaticParams crashes the build under Cache
// Components. Posts render on-demand (and are still server-rendered for SEO).

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const post = getPost(slug)
  // Unknown or draft slug. The 200 status is already on the wire (see
  // NotFoundBody), so noindex is what actually keeps this out of an index.
  if (!post) return { robots: { index: false, follow: false } }

  // Only an author-supplied card is set here. The default comes from the
  // sibling opengraph-image.tsx, which Next serves at a build-hashed path
  // (/blog/[slug]/opengraph-image-<hash>) and injects automatically — but only
  // when this object leaves `images` alone. Hardcoding the unhashed path, as
  // this did, points every share card at a 404.
  const ogImage = post.ogImage
    ? {
        openGraph: { images: [{ url: post.ogImage, width: 1200, height: 630, alt: post.title }] },
        twitter: { images: [post.ogImage] },
      }
    : { openGraph: {}, twitter: {} }

  const canonical = blogHref(slug)

  return {
    title: `${postTitleTag(post)} · Skillet`,
    description: post.description,
    alternates: markdownAlternates(canonical, {
      'application/rss+xml': [{ url: '/blog/rss.xml', title: 'Skillet Blog' }],
    }),
    openGraph: {
      title: post.title,
      description: post.description,
      type: 'article',
      url: canonical,
      publishedTime: post.publishedAt ?? undefined,
      modifiedTime: post.updatedAt,
      ...ogImage.openGraph,
    },
    twitter: {
      card: 'summary_large_image',
      title: post.title,
      description: post.description,
      ...ogImage.twitter,
    },
  }
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const post = getPost(slug)
  if (!post) return <NotFoundBody />

  const related = relatedPosts(post)

  return (
    <main className={PAGE_CONTAINER_CLASS}>
      <div className="flex flex-col gap-12 lg:flex-row lg:gap-14">
        <article className="min-w-0 max-w-[680px] flex-1">
          <Link
            href="/blog"
            className="font-mono text-xs uppercase tracking-[0.08em] text-(--accent) hover:underline"
          >
            ← Blog
          </Link>

          <p className="mt-8 font-mono text-xs uppercase tracking-[0.08em] text-(--accent)">
            {category(post.tags)}
          </p>
          <h1 className="mt-3 text-display font-semibold leading-[1.07] tracking-[-0.03em]">
            {post.title}
          </h1>
          <p className="mt-5 text-xl leading-[1.5] text-(--ink-2)">{post.description}</p>

          <div className="mt-6 flex flex-wrap items-center gap-x-1.5 border-t border-(--line) pt-6 text-sm text-(--ink-2)">
            <span>By {post.author}</span>
            {post.publishedAt && (
              <>
                <span aria-hidden>·</span>
                <span>{formatDate(post.publishedAt)}</span>
              </>
            )}
            {post.readTime && (
              <>
                <span aria-hidden>·</span>
                <span>{post.readTime} min read</span>
              </>
            )}
          </div>

          <MarkdownContent content={post.content} className="mt-10" />

          <div className="mt-12">
            <PostShare
              url={new URL(blogHref(slug), SITE_URL).toString()}
              title={post.title}
            />
          </div>

          <footer className="mt-12 border-t border-(--line) pt-8">
            <div className="flex items-start gap-4">
              <Avatar src={post.authorAvatar} name={post.author} size="md" />
              <div>
                <p className="font-semibold">{post.author}</p>
                {post.authorBio && (
                  <p className="mt-0.5 text-sm text-(--ink-2)">{post.authorBio}</p>
                )}
              </div>
            </div>
          </footer>
        </article>

        {related.length > 0 && (
          <aside className="lg:sticky lg:top-24 lg:h-fit lg:w-[260px] lg:shrink-0">
            <p className="font-mono text-xs uppercase tracking-[0.08em] text-(--ink-2)">
              More from the blog
            </p>
            <ul className="mt-4 flex flex-col">
              {related.map((p) => (
                <li key={p.slug}>
                  <Link
                    href={blogHref(p.slug)}
                    className="group block border-t border-(--line) py-4"
                  >
                    <span className="font-mono text-xs uppercase tracking-[0.08em] text-(--accent)">
                      {category(p.tags)}
                    </span>
                    <h2 className="mt-1.5 text-lg font-semibold leading-[1.2] tracking-[-0.02em] group-hover:underline">
                      {p.title}
                    </h2>
                    {p.readTime && (
                      <span className="mt-1.5 block text-xs text-(--ink-2)">
                        {p.readTime} min read
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>
    </main>
  )
}
