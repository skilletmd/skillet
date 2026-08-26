import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CATEGORIES, isCategoryKey } from '@/lib/categories'
import { getSignalItems } from '@/lib/news-signal'
import { PAGE_CONTAINER_CLASS } from '@/lib/page-layout'
import { getSkillCatalog } from '@/lib/registry-catalog'
import { getDiscoverFeed } from '@/lib/registry'
import { NewsKicker, NewsMasthead } from '../news-chrome'
import { NewsFeed } from '../news-feed'

/** A topic room shows the conversation first and the shelf second. Enough drops
 *  to prove the room is stocked, not so many that it becomes the grid again. */
const DROP_LIMIT = 9

function meta(topic: string) {
  return CATEGORIES.find((c) => c.key === topic)
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ topic: string }>
}): Promise<Metadata> {
  const { topic } = await params
  const cat = meta(topic)
  if (!cat) return {}
  const title = `${cat.label} skills, and what people say about them · Skillet Daily`
  return {
    title,
    description: `What is happening in ${cat.label.toLowerCase()} skill land: who shipped what, what people are saying, and what just landed in the registry.`,
    alternates: { canonical: `/news/${topic}` },
  }
}

export default async function NewsTopicPage({
  params,
}: {
  params: Promise<{ topic: string }>
}) {
  const { topic } = await params
  // An unknown category is a real 404, not an empty room. The rail only ever
  // links keys that exist, so anything else was typed or guessed.
  if (!isCategoryKey(topic)) notFound()
  const cat = meta(topic)!

  const [feed, catalog] = await Promise.all([
    getDiscoverFeed(),
    getSkillCatalog({ category: topic, limit: DROP_LIMIT }),
  ])

  // A post belongs to this room when the skill it resolves to lives here. That
  // is inferred from the registry, not from keywords in the post text: keyword
  // topic-tagging mislabelled often enough that it was cut from the cards.
  const inRoom = new Set(
    (catalog.skills ?? []).map((s: { author: string; slug: string }) => `${s.author}/${s.slug}`),
  )
  const posts = getSignalItems().filter((p) =>
    p.skills.some((s) => inRoom.has(`${s.author}/${s.slug}`)),
  )

  const drops = (feed?.events ?? []).filter(
    (e) => e.kind === 'skill' && e.skill.category === topic,
  )

  return (
    <div className={PAGE_CONTAINER_CLASS}>
      <NewsMasthead
        dateLabel={cat.label}
        standfirst={`${cat.blurb} Below: what people are saying, and what just landed.`}
      />

      <NewsKicker
        label="The room"
        sub={`${posts.length} posts · ${drops.length} new`}
      />
      {posts.length === 0 && drops.length === 0 ? (
        <p className="max-w-[65ch] rounded-xl border border-dashed border-(--line) p-6 text-sm text-(--ink-2)">
          Nothing on the wire for {cat.label.toLowerCase()} this week. The{' '}
          <Link href="/news" className="underline">
            main feed
          </Link>{' '}
          carries every topic.
        </p>
      ) : (
        <NewsFeed posts={posts} drops={drops} dropLimit={DROP_LIMIT} />
      )}

      <NewsKicker label="On the shelf" sub={`${cat.label} skills in the registry`} />
      <div className="flex flex-wrap gap-2">
        {(catalog.skills ?? []).map((s: { author: string; slug: string }) => (
          <Link
            key={`${s.author}/${s.slug}`}
            href={`/${s.author}/${s.slug}`}
            className="rounded-lg border border-(--line) bg-(--surface) px-3 py-2 font-mono text-xs transition-colors hover:border-(--ink-2)"
          >
            @{s.author}/{s.slug}
          </Link>
        ))}
      </div>

      <footer className="mt-12 border-t border-(--line) pt-4">
        <p className="font-mono text-xs text-(--ink-2)">
          <Link href="/news" className="underline">
            All topics
          </Link>
        </p>
      </footer>
    </div>
  )
}
