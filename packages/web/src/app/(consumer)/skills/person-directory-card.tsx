import Link from 'next/link'
import { FollowButton } from '@/components/follow-button'
import { PersonCard } from '@/components/person-card'
import { Avatar } from '@/components/ui/avatar'
import { CardXs } from '@/components/card/shells'
import { CategoryIcon } from '@/components/category-icons'
import { CATEGORY_BY_KEY, isCategoryKey } from '@/lib/categories'

// Big counts read as "17K", not "17,030" — abbreviated keeps the stat line quiet.
const compactNumber = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

// A count + its noun, singularized at 1 ("1 follower", "2 followers").
function stat(n: number, one: string): string {
  return `${compactNumber.format(n)} ${n === 1 ? one : `${one}s`}`
}

/** The data a rich person card needs — satisfied by both the Browse catalog
 *  entry and a feed follow-target, so both render the identical card. */
export interface PersonCardData {
  handle: string
  name: string
  avatarUrl: string | null
  categories: string[]
  totalInstalls: number
  followers: number
  publicSkills: number
  /** Authors this person follows. Optional — lighter sources (the directory
   *  catalog) don't carry it, so the card omits it rather than show a fake 0. */
  following?: number
  /** Public kits this person curates. Optional, like `following`. */
  kits?: number
  viewerFollows: boolean
}

/**
 * The rich person card — a Follow action and the "what they do" category row over
 * the shared {@link PersonCard}. Used on Browse AND in the feed's follow events,
 * so a person reads the same everywhere.
 */
export function PersonDirectoryCard({
  person,
  isAuthed,
  size,
}: {
  person: PersonCardData
  isAuthed: boolean
  /** `xs` renders the named pill (avatar + name); default is the rich card. */
  size?: 'xs'
}) {
  if (size === 'xs') {
    return (
      <CardXs
        href={`/${person.handle}`}
        title={person.name || `@${person.handle}`}
        shape="round"
        mark={
          <Avatar
            src={person.avatarUrl}
            name={person.name || person.handle}
            colorKey={person.handle}
            className="h-full w-full"
          />
        }
      />
    )
  }

  const categories = person.categories
    .filter(isCategoryKey)
    .map((key) => CATEGORY_BY_KEY[key])
    .slice(0, 3)

  // A person's identity stats: followers · following · skills · kits. Followers
  // and skills are the always-on core; following and kits are shown only when
  // non-zero, so a card never carries dead "0 following · 0 kits" noise. The
  // whole line hides when we know nothing (a feed/notification actor known only
  // by handle), so a minimal card never shows "0 followers" for someone who has
  // them.
  const stats = [
    stat(person.followers, 'follower'),
    (person.following ?? 0) > 0 ? `${compactNumber.format(person.following!)} following` : null,
    stat(person.publicSkills, 'skill'),
    (person.kits ?? 0) > 0 ? stat(person.kits!, 'kit') : null,
  ].filter((s): s is string => s != null)
  const hasStats =
    person.followers > 0 ||
    person.publicSkills > 0 ||
    (person.following ?? 0) > 0 ||
    (person.kits ?? 0) > 0

  return (
    <PersonCard
      handle={person.handle}
      name={person.name}
      avatarUrl={person.avatarUrl}
      growChildren
      footerBordered
      flat
      stats={hasStats ? stats : undefined}
      action={
        <FollowButton
          author={person.handle}
          initialFollowing={person.viewerFollows}
          isAuthed={isAuthed}
          appearance="card"
        />
      }
    >
      {categories.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {categories.map((c) => (
            <Link
              key={c.key}
              href={`/browse/${c.key}`}
              className="relative z-10 inline-flex items-center gap-1.5 rounded-full border border-(--line) bg-(--card-pop) py-1 pl-2 pr-2.5 text-xs text-(--ink) transition-colors hover:border-(--accent)"
            >
              {/* The category GLYPH, not the section shape — chips name a
                  category, and glyphs are how categories are identified
                  (shapes belong to sections and kit marks). Tinted with the
                  category's own swatch. */}
              <span
                className="grid shrink-0 place-items-center text-sm"
                style={{ color: `hsl(${c.hue} ${c.sat}% ${Math.min(c.light, 42)}%)` }}
              >
                <CategoryIcon cat={c.key} />
              </span>
              {c.label}
            </Link>
          ))}
        </div>
      )}
    </PersonCard>
  )
}

/** Minimal person data when only handle/name/avatar are known — a feed or
 *  notification actor. Stats are zero, so the rich card hides its stat line
 *  rather than show misleading 0s. */
export function minimalPerson(
  handle: string,
  name: string,
  avatarUrl: string | null,
): PersonCardData {
  return {
    handle,
    name,
    avatarUrl,
    categories: [],
    totalInstalls: 0,
    followers: 0,
    publicSkills: 0,
    viewerFollows: false,
  }
}
