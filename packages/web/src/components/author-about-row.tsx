import Link from 'next/link'
import type { ReactNode } from 'react'
import { Avatar } from '@/components/ui/avatar'
import { PersonHoverName } from '@/components/person-hover-card'

/**
 * The author, in the rail's About block: avatar, full name, handle, Follow.
 *
 * The person moves here from the byline so they live in one place with room to
 * be a person, rather than a handle and a 16px avatar squeezed above the title.
 * The byline drops to a bare "KIT" / "SKILL" eyebrow, and Follow comes with
 * them, since a follow control next to a type label and nothing else reads as
 * unattached.
 *
 * It leads the About block rather than sitting among the object facts. Who made
 * this is not the same class of thing as a token count, and the order says so.
 *
 * Matches AboutRow's 20px icon gutter so the avatar lines up with the glyph
 * column of every row beneath it.
 */
export function AuthorAboutRow({
  handle,
  displayName,
  avatarUrl,
  isTeam,
  follow,
  inline,
}: {
  handle: string
  displayName?: string | null
  avatarUrl?: string | null
  isTeam?: boolean
  /** Follow control, rendered inline after the name. Omitted on your own. */
  follow?: ReactNode
  /**
   * One-line variant: name, handle, and Follow run in a single wrapping row
   * with no icon gutter, so a caller can put the object's facts on the same
   * line after them. The phone kit hero uses it; the desktop rail keeps the
   * stacked default, where the 20px gutter aligns the avatar with the glyph
   * column of every row beneath.
   */
  inline?: boolean
}) {
  // With a real name, the link is the name and the handle sits under it. With
  // no name there is nothing to put on two lines, so the link IS the handle,
  // written the way a handle is written.
  const name = displayName?.trim()
  const label = name || `@${handle}`

  if (inline) {
    return (
      <span className="flex min-w-0 items-center gap-x-2">
        {/* The whole identity is the hover target — face, name, and handle are
            one thing to a reader, and having only the name open the card meant
            pointing at someone's avatar did nothing. Follow stays OUTSIDE it:
            it is a control, and a card opening under the cursor on the way to
            pressing it is in the way. */}
        <PersonHoverName handle={handle}>
          <Link
            href={`/${handle}`}
            className="flex min-w-0 items-center gap-x-2 transition-colors hover:text-(--accent)"
          >
            <Avatar
              name={label}
              src={avatarUrl}
              colorKey={handle}
              kind={isTeam ? 'team' : 'person'}
              size="xs"
              className="h-5 w-5 shrink-0"
              aria-hidden="true"
            />
            <span className="min-w-0 truncate font-medium text-(--ink)">{label}</span>
            {/* The handle drops a step: the NAME is the identity, and two things
                at one size read as two equal claims on the line. */}
            {name && <span className="shrink-0 text-sm text-(--ink-2)">@{handle}</span>}
          </Link>
        </PersonHoverName>
        {follow}
      </span>
    )
  }

  return (
    <span className="grid min-w-0 grid-cols-[20px_minmax(0,1fr)] items-start gap-x-2.5">
      <span className="inline-flex h-5 w-5 items-center justify-center">
        <Avatar
          name={label}
          src={avatarUrl}
          colorKey={handle}
          kind={isTeam ? 'team' : 'person'}
          size="xs"
          aria-hidden="true"
        />
      </span>
      <span className="min-w-0 leading-5">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2">
          <PersonHoverName handle={handle}>
            <Link
              href={`/${handle}`}
              className="min-w-0 truncate font-medium text-(--ink) transition-colors hover:text-(--accent)"
            >
              {label}
            </Link>
          </PersonHoverName>
          {follow}
        </span>
        {name && <span className="block truncate text-(--ink-2)">@{handle}</span>}
      </span>
    </span>
  )
}
