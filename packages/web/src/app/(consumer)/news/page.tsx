import type { Metadata } from 'next'
import Link from 'next/link'
import { getStories, type Post } from '@/lib/blog'
import { PAGE_CONTAINER_CLASS } from '@/lib/page-layout'
import { getRegistryStats } from '@/lib/registry-stats'
import { NewsKicker, NewsMasthead } from './news-chrome'
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
  // A daily leads with the day it is dated. Everything older is still reachable
  // by permalink and RSS, so the archive below is a courtesy, not the record.
  const latestDate = stories[0]?.publishedAt?.slice(0, 10) ?? null
  const today = stories.filter((s) => s.publishedAt?.slice(0, 10) === latestDate)
  const earlier = stories.filter((s) => s.publishedAt?.slice(0, 10) !== latestDate).slice(0, 12)

  return (
    <div className={PAGE_CONTAINER_CLASS}>
      <NewsMasthead
        dateLabel={editionDate(stories[0] ?? null)}
        standfirst="What moved in agent skills yesterday, and what changed in the registry. One page, every weekday. We publish Skillet, and we cover everyone."
      />

      <NewsKicker label="Today" sub={`${today.length} ${today.length === 1 ? 'story' : 'stories'}`} />
      <NewsStories stories={today} />

      {earlier.length > 0 ? (
        <>
          <NewsKicker label="Earlier" sub="the last few editions" />
          <NewsStories stories={earlier} />
        </>
      ) : null}

      <NewsKicker label="By topic" sub="follow one, get its wire" />
      <NewsTopics stats={stats.categories} />

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
