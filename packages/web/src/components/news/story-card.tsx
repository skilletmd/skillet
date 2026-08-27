import Link from 'next/link'
import { Avatar } from '@/components/ui/avatar'
import { NetworkIcon, type Network } from '@/components/network-icon'
import { PendingSkillAttachment } from '@/components/pending-skill-card'

/**
 * A written Skillet Daily story, as a card.
 *
 * One component for both surfaces. /feed hangs it under a byline row and /news
 * tiles it into a masonry, but the card itself — headline, body, the sources it
 * was written from, and the skill it is about — is the same object in both
 * places, and it stopped being the same the moment there were two of them.
 * /news spent a while rendering the raw collected quotes instead: the material
 * the cards are written FROM, with no headline and no way to install anything.
 */

export interface StoryCardSource {
  network: Network | 'web'
  handle: string
  label: string
  detail?: string | null
  url: string
  avatarUrl?: string | null
}

export interface StoryCardSubject {
  slug: string | null
  repo: string | null
  category?: string | null
  name?: string | null
}

/**
 * The card shows ONE sentence, never the whole summary.
 *
 * The writer drafts a full paragraph and the permalink prints all of it, but in
 * a tile that paragraph ran five or six lines and three of them side by side
 * became a wall. A card is an invitation to read the story, not the story: it
 * has to be skimmable against nine siblings, and the first sentence is the one
 * the writer already made carry the point.
 *
 * Splitting on the sentence rather than clamping with CSS is deliberate. A clamp
 * cuts mid-word and trails an ellipsis into nothing; a sentence ends where the
 * thought does. The clamp stays underneath only as a backstop for a first
 * sentence that is itself enormous.
 */
function firstSentence(text: string): string {
  const trimmed = text.trim()
  // Require the space after the stop so "2.0" and "skills.sh" do not split it.
  const end = trimmed.search(/[.!?]\s/)
  return end === -1 ? trimmed : trimmed.slice(0, end + 1)
}

export function StoryCard({
  slug,
  headline,
  summary,
  sources,
  subject,
}: {
  slug: string
  headline: string
  summary: string
  sources: StoryCardSource[]
  subject?: StoryCardSubject | null
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-(--line) bg-(--surface)">
      {/* The headline is the permalink. A story nobody can link to is a story
          nobody forwards, which is the whole point of writing one. */}
      <Link href={`/news/${slug}`} className="group block px-4 pt-4 pb-3">
        <h3 className="text-base leading-snug font-semibold tracking-tight text-pretty text-(--ink) group-hover:text-(--accent)">
          {headline}
        </h3>
        <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-(--ink-2)">
          {firstSentence(summary)}
        </p>
      </Link>

      {sources.length > 0 ? (
        <div className="px-4 pb-4">
          <p className="font-mono text-2xs tracking-[0.08em] uppercase text-(--ink-2)">
            {sources.length} {sources.length === 1 ? 'source' : 'sources'}
          </p>
          <ul className="pt-1">
            {sources.map((src) => (
              <li key={src.url}>
                <a
                  href={src.url}
                  className="group flex items-center gap-2 py-1.5 text-xs hover:text-(--accent)"
                >
                  {/* Face only. A network badge pinned to a 20px avatar never
                      sat cleanly on the circle, and the mark reads better as
                      its own column on the right. */}
                  <Avatar
                    src={src.avatarUrl ?? null}
                    name={src.label || src.handle}
                    colorKey={src.handle}
                    size="xxs"
                  />
                  <span className="truncate font-medium">@{src.handle}</span>
                  <span className="truncate text-(--ink-2)">{src.label}</span>
                  <span className="ml-auto flex shrink-0 items-center gap-2">
                    {src.detail ? (
                      <span className="font-mono text-2xs whitespace-nowrap text-(--ink-2)">
                        {src.detail}
                      </span>
                    ) : null}
                    <span className="text-(--ink-2)">
                      {src.network === 'web' ? (
                        <span
                          aria-hidden="true"
                          className="grid h-3.5 w-3.5 place-items-center rounded-sm border border-(--line) font-mono text-2xs"
                        >
                          W
                        </span>
                      ) : (
                        <NetworkIcon network={src.network} />
                      )}
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* A card that describes a skill and offers no way to get it is a dead
          end: the reader we just convinced has nowhere to go. */}
      {subject?.slug || subject?.repo ? (
        <PendingSkillAttachment
          slug={subject.slug ?? subject.repo!.split('/')[1]!}
          repo={subject.repo}
          category={subject.category}
          name={subject.name}
        />
      ) : null}
    </div>
  )
}
