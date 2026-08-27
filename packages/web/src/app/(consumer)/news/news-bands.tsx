/**
 * The two non-news bands on the daily.
 *
 * The page mixes three content types with wildly different volumes: about 8
 * machine-written stories a weekday, a handful of editorial posts ever, and a
 * continuous stream of registry activity. Rendered at the same weight the
 * highest-volume type wins on count alone, which is how the homepage rail ended
 * up serving news in an editorial slot.
 *
 * So weight tracks editorial value rather than recency, and each band gets its
 * own density: the stories stay a card grid, the essays are a short titled band,
 * and activity is a dense list (see news-live.tsx).
 */
import Link from 'next/link'
import type { Post } from '@/lib/blog'

/**
 * Evergreen essays, and deliberately not sorted or dated.
 *
 * A date here would invite reading them as stale next to an edition published
 * this morning. They are reference: "what a skill buys you" is as true in
 * November as today, which is the whole reason they can sit on a daily page
 * permanently without rotting.
 */
export function NewsEssays({ posts }: { posts: Post[] }) {
  if (posts.length === 0) return null
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {posts.map((post) => (
        <li key={post.slug}>
          <Link
            href={`/blog/${post.slug}`}
            className="group flex h-full flex-col gap-1 rounded-lg border border-(--line) p-4 transition-colors hover:bg-(--accent-bg)/40"
          >
            <span className="text-base font-semibold leading-[1.3] text-(--ink) group-hover:underline">
              {post.title}
            </span>
            {post.description ? (
              <span className="line-clamp-2 text-sm leading-relaxed text-(--ink-2)">
                {post.description}
              </span>
            ) : null}
          </Link>
        </li>
      ))}
    </ul>
  )
}
