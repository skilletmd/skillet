/**
 * The above-the-fold block: three columns at three densities.
 *
 * Borrowed from Wirecutter's front, which runs a dense text-only river down the
 * left, one lead at full size in the middle, and small timely cards down the
 * right. The three sit SIDE BY SIDE, and that adjacency is the point: stacked
 * as bands they read as a queue and the eye just works down it, where in
 * columns the size difference does the ranking on its own and the reader takes
 * all three in at once.
 *
 * Skillet's three content types map onto it directly. Registry movement is the
 * river, today's lead story is the lead, and browse-by-topic is the right
 * rail. Weight tracks editorial value, not recency: a uniform grid says
 * every story is equally worth your time, which is never true and is what makes
 * a page read as generated rather than edited.
 */
import Link from 'next/link'
import type { Post } from '@/lib/blog'
import { PendingSkillAttachment } from '@/components/pending-skill-card'

/** Same rule as the cards: one sentence. The permalink prints the rest. */
function firstSentence(text: string): string {
  const trimmed = text.trim()
  const end = trimmed.search(/[.!?]\s/)
  return end === -1 ? trimmed : trimmed.slice(0, end + 1)
}

/** Heavy rule, Wirecutter's band separator. Thicker than NewsKicker's hairline
 *  on purpose: these divide sections, not rows. */
export function NewsRule() {
  return <hr className="mt-10 mb-4 h-0.5 border-0 bg-(--ink)" />
}

/**
 * The lead. Headline at display size, one-sentence standfirst, and the skill it
 * is about attached underneath.
 *
 * The skill is what makes this a lead rather than a big headline. Wirecutter's
 * lead is a photograph of the thing it recommends and a place to go buy it;
 * ours is the skill's cover and an Import button. A story about a skill with no
 * way to get the skill sends away the one reader it just convinced.
 */
export function NewsLead({ story }: { story: Post | null }) {
  if (!story) return null
  return (
    <article>
      <Link href={`/news/${story.slug}`} className="group block">
        <h2 className="text-3xl leading-[1.1] font-semibold tracking-tight text-pretty text-(--ink) group-hover:text-(--accent) sm:text-4xl">
          {story.title}
        </h2>
        {story.description ? (
          <p className="mt-4 max-w-[58ch] text-lg leading-[1.55] text-(--ink-2)">
            {firstSentence(story.description)}
          </p>
        ) : null}
      </Link>
      {story.subject?.slug || story.subject?.repo ? (
        <div className="mt-5 max-w-md">
          <PendingSkillAttachment
            slug={story.subject.slug ?? story.subject.repo!.split('/')[1]!}
            repo={story.subject.repo}
            category={story.subject.category}
            name={story.subject.name}
          />
        </div>
      ) : null}
    </article>
  )
}

/** A column heading inside the fold block. Small, uppercase, out of the way of
 *  the lead. */
export function NewsColumnLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-3 block border-b border-(--ink) pb-1.5 font-mono text-2xs font-semibold tracking-[0.16em] uppercase text-(--ink)">
      {children}
    </span>
  )
}
