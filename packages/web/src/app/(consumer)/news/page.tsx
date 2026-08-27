import type { Metadata } from 'next'
import Link from 'next/link'
import { getEditorialPosts, getStories, type Post } from '@/lib/blog'
import { PAGE_CONTAINER_CLASS } from '@/lib/page-layout'
import { getDiscoverFeed } from '@/lib/registry'
import { getRegistryStats } from '@/lib/registry-stats'
import { NewsKicker, NewsMasthead } from './news-chrome'
import { NewsEssays } from './news-bands'
import { NewsColumnLabel, NewsLead, NewsRule } from './news-lead'
import { NewsLive } from './news-live'
import { NewsStories } from './news-stories'
import { NewsTopics } from './news-topics'

const TITLE = 'Skillet Daily · agent skills, every weekday'
const DESCRIPTION =
  'What moved in agent skills yesterday, and what changed in the registry. Coverage of every runtime, not just ours: Claude Code, Codex, Cursor, Gemini, OpenClaw.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: {
    canonical: '/news',
    types: { 'application/rss+xml': [{ url: '/news/rss.xml', title: 'Skillet Daily' }] },
  },
  openGraph: { title: TITLE, description: DESCRIPTION, type: 'website', url: '/news' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
}

/**
 * The EDITION's date, never today's.
 *
 * With no edition this used to fall back to `new Date()`, which under
 * cacheComponents is a prerender error — "used `new Date()` before accessing
 * either uncached data or Request data" — and it took the whole build down. It
 * only ever fired where no `daily`-tagged post exists, so a machine with one
 * built fine and production did not. Stamping today's date on a page with no
 * edition was also just wrong: the date labels the edition, so with no edition
 * there is nothing to date and the masthead drops the slot.
 */
function editionDate(post: Post | null): string | null {
  const iso = post?.publishedAt
  if (!iso) return null
  // `new Date('2026-08-25')` parses as UTC midnight, which renders as the 24th
  // anywhere west of Greenwich. Split the date-only string and build a local date.
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return new Date(iso).toLocaleDateString('en-US', dateStyle)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', dateStyle)
}

const dateStyle = { month: 'long', day: 'numeric', year: 'numeric' } as const

export default async function NewsPage() {
  const stats = await getRegistryStats()
  const stories = getStories()
  // Soft: the daily is the page's reason to exist and must render without the
  // registry. A feed outage drops the activity band, never the edition.
  const feed = await getDiscoverFeed().catch(() => null)
  const essays = getEditorialPosts().slice(0, 3)
  // A daily leads with the day it is dated. Everything older is still reachable
  // by permalink and RSS, so the archive below is a courtesy, not the record.
  const latestDate = stories[0]?.publishedAt?.slice(0, 10) ?? null
  const today = stories.filter((s) => s.publishedAt?.slice(0, 10) === latestDate)
  // The lead is the edition's first story: the order the writer already chose.
  // Re-ranking here would second-guess an editorial call with a heuristic.
  const [lead, ...restOfToday] = today
  const earlier = stories.filter((s) => s.publishedAt?.slice(0, 10) !== latestDate).slice(0, 12)

  return (
    <div className={PAGE_CONTAINER_CLASS}>
      <NewsMasthead
        dateLabel={editionDate(stories[0] ?? null)}
        standfirst="What moved in agent skills yesterday, and what changed in the registry. One page, every weekday. We publish Skillet, and we cover everyone."
      />

      {/* The fold: three columns at three densities, side by side. Stacked as
          bands these read as a queue; in columns the size difference does the
          ranking and the reader takes all three in at once. */}
      <NewsRule />
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_minmax(0,15rem)]">
        <aside className="order-2 lg:order-1">
          <NewsColumnLabel>Live</NewsColumnLabel>
          {feed?.events?.length ? (
            <NewsLive events={feed.events} limit={8} />
          ) : (
            <p className="text-sm text-(--ink-2)">Nothing moving right now.</p>
          )}
        </aside>

        <div className="order-1 lg:order-2">
          <NewsLead story={lead ?? null} />
        </div>

        <aside className="order-3">
          <NewsColumnLabel>By topic</NewsColumnLabel>
          <NewsTopics stats={stats.categories} />
        </aside>
      </div>

      <NewsKicker
        label="Today"
        sub={`${restOfToday.length} more`}
      />
      <NewsStories stories={restOfToday} />

      {essays.length > 0 ? (
        <>
          <NewsRule />
          <NewsKicker label="Start here" sub="what a skill is, and why it travels" />
          <NewsEssays posts={essays} />
        </>
      ) : null}

      {earlier.length > 0 ? (
        <>
          <NewsKicker label="Earlier" sub="the last few editions" />
          <NewsStories stories={earlier} />
        </>
      ) : null}

      <footer className="mt-12 border-t border-(--line) pt-4">
        <p className="max-w-[65ch] font-mono text-xs leading-relaxed text-(--ink-2)">
          <span className="font-bold">About</span> Skillet Daily covers agent skills across every
          runtime: who shipped what, what the research says, and what changed in the open registry.
        </p>
        <p className="mt-1.5 max-w-[65ch] font-mono text-xs leading-relaxed text-(--ink-2)">
          <span className="font-bold">Corrections</span> Every claim links to its source. Tell us
          when we get one wrong and we will fix it in place and say so.{' '}
          <Link href="/blog" className="underline">
            Past editions
          </Link>
        </p>
      </footer>
    </div>
  )
}
