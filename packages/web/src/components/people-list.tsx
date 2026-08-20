import Link from 'next/link'
import { Avatar } from '@/components/ui/avatar'
import type { FollowPerson } from '@/lib/registry'

/**
 * A reading-width list of people — a person row is an identity object, so rows
 * cap at 720px rather than stretching the full page column. Shared by the
 * followers/following lists and the installs list.
 */
export function PeopleList({ people, empty }: { people: FollowPerson[]; empty: string }) {
  if (people.length === 0) {
    return <p className="text-sm leading-relaxed text-(--ink-2)">{empty}</p>
  }
  return (
    <ul className="max-w-[720px] space-y-2">
      {people.map((p) => (
        <li key={p.handle}>
          <Link
            href={`/${p.handle}`}
            className="flex items-center gap-3 rounded-2xl border border-(--line) bg-(--surface) px-5 py-4 transition-colors hover:border-(--accent)"
          >
            <Avatar
              src={p.avatarUrl}
              name={p.name}
              colorKey={p.handle}
              size="md"
              aria-hidden="true"
            />
            <span className="min-w-0">
              <span className="block truncate text-base font-semibold text-(--ink)">{p.name}</span>
              <span className="block truncate font-mono text-sm text-(--accent)">@{p.handle}</span>
              {p.bio?.trim() ? (
                <span className="mt-0.5 line-clamp-1 block text-sm text-(--ink-2)">{p.bio}</span>
              ) : null}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
