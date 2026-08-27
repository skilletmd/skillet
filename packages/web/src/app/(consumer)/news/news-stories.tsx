import { StoryCard } from '@/components/news/story-card'
import type { Post } from '@/lib/blog'

/**
 * The day's written stories, tiled.
 *
 * This block used to render the raw collected posts instead — the material the
 * stories are written FROM. It predated the writing, and never learned about
 * it: no headline, no body, no cover, and a "not in the registry" chip where
 * the Import button belongs. The cards were only ever on /feed.
 *
 * Masonry rather than a list, because a card here has no byline row above it
 * and the bodies vary enough in length that a grid leaves ragged whitespace.
 */
export function NewsStories({ stories }: { stories: Post[] }) {
  if (stories.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-(--line) p-6 text-center text-sm text-(--ink-2)">
        Nothing on the wire yet today.
      </p>
    )
  }
  return (
    <div className="columns-1 gap-3 sm:columns-2 lg:columns-3 [&>*]:mb-3 [&>*]:break-inside-avoid">
      {stories.map((s) => (
        <StoryCard
          key={s.slug}
          slug={s.slug}
          headline={s.title}
          summary={s.description}
          sources={s.sources ?? []}
          subject={s.subject}
        />
      ))}
    </div>
  )
}
