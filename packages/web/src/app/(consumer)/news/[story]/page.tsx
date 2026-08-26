import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getPost, STORY_TAG, type StorySource } from '@/lib/blog'
import { PAGE_CONTAINER_CLASS } from '@/lib/page-layout'
import { NetworkIcon, NETWORK_NAME } from '@/components/network-icon'
import { Avatar } from '@/components/ui/avatar'
import { NewsKicker, NewsMasthead } from '../news-chrome'

const STORY_KICKER: Record<string, string> = {
  launch: 'Launch',
  labs: 'From the labs',
  research: 'Research',
  debate: 'The argument',
  trust: 'Trust',
}

/** A published story, or null. Drafts are not found: an unpublished story must
 *  404 for everyone, not render for anyone holding the URL. */
function loadStory(slug: string) {
  const post = getPost(slug)
  if (!post || !post.tags.includes(STORY_TAG)) return null
  return post
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ story: string }>
}): Promise<Metadata> {
  const { story } = await params
  const post = loadStory(story)
  if (!post) return {}
  return {
    title: `${post.title} · Skillet Daily`,
    description: post.description,
    alternates: { canonical: `/news/${story}` },
    openGraph: {
      title: post.title,
      description: post.description,
      type: 'article',
      url: `/news/${story}`,
      publishedTime: post.publishedAt ?? undefined,
    },
    twitter: { card: 'summary_large_image', title: post.title, description: post.description },
  }
}

function SourceRow({ source }: { source: StorySource }) {
  return (
    <li>
      <a
        href={source.url}
        className="group flex items-center gap-3 border-t border-(--line) py-3 hover:text-(--accent)"
      >
        <Avatar
          src={source.avatarUrl ?? null}
          name={source.label || source.handle}
          colorKey={source.handle}
          size="xs"
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">@{source.handle}</span>
          <span className="block truncate text-xs text-(--ink-2)">{source.label}</span>
        </span>
        {source.detail ? (
          <span className="shrink-0 font-mono text-2xs whitespace-nowrap text-(--ink-2)">
            {source.detail}
          </span>
        ) : null}
        <span className="shrink-0 text-(--ink-2)">
          {source.network === 'web' ? null : <NetworkIcon network={source.network} />}
          <span className="sr-only">
            {source.network === 'web' ? 'the web' : NETWORK_NAME[source.network]}
          </span>
        </span>
      </a>
    </li>
  )
}

export default async function StoryPage({ params }: { params: Promise<{ story: string }> }) {
  const { story } = await params
  const post = loadStory(story)
  // agent-routes decides an unknown story before render, so reaching here with
  // nothing is a draft or a race, not a typo. Either way it is a real 404.
  if (!post) notFound()

  const sources = post.sources ?? []
  const dateLabel = post.publishedAt
    ? new Date(`${post.publishedAt}T12:00:00Z`).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    : ''

  return (
    <div className={PAGE_CONTAINER_CLASS}>
      <NewsMasthead
        dateLabel={dateLabel}
        standfirst={STORY_KICKER[post.storyKind ?? ''] ?? 'Story'}
      />

      <article className="mt-8 max-w-[68ch]">
        <h1 className="text-3xl leading-tight font-semibold tracking-tight text-pretty text-(--ink)">
          {post.title}
        </h1>
        <p className="mt-4 text-base leading-relaxed whitespace-pre-line text-(--ink-2)">
          {post.content || post.description}
        </p>
      </article>

      {sources.length > 0 ? (
        <>
          <NewsKicker
            label="Sources"
            sub={`${sources.length} ${sources.length === 1 ? 'source' : 'sources'}`}
          />
          <ul className="max-w-[68ch]">
            {sources.map((source) => (
              <SourceRow key={source.url} source={source} />
            ))}
          </ul>
        </>
      ) : null}

      <footer className="mt-12 max-w-[65ch] border-t border-(--line) pt-4">
        <p className="font-mono text-xs leading-relaxed text-(--ink-2)">
          <span className="font-bold">Corrections</span> Every claim links to its source. Tell us
          when we get one wrong and we will fix it in place and say so.
        </p>
        <p className="mt-2 font-mono text-xs">
          <Link href="/news" className="underline">
            Skillet Daily
          </Link>
        </p>
      </footer>
    </div>
  )
}
