import Link from 'next/link'
import { NetworkIcon, NETWORK_NAME, type Network } from '@/components/network-icon'

/**
 * The attachment strip for a skill someone named that the registry does not
 * carry yet.
 *
 * Sits inside the post card's border, below a hairline, in the same row shape as
 * a resolved skill. Availability reads through the hollow mark and the trailing
 * state rather than a differently coloured block: a second surface stacked under
 * the quote reads as two objects, and on a warm ground it reads as a smear.
 *
 * When the post linked a GitHub repo, the row ends in **Import** rather than a
 * flat "not in the registry". `/github.com/owner/repo` already redirects into
 * the importer, so the shortest path from reading about a skill to having it is
 * one click, and the feed stops dead-ending on the thing it just recommended.
 */
export function PendingSkillAttachment({
  slug,
  network,
  spottedBy,
  repo,
}: {
  /** The skill name as written, e.g. `scandinavian-design`. */
  slug: string
  network: Network
  /** Handle of the person whose post named it. */
  spottedBy: string
  /** `owner/repo` the post linked, when it linked one. */
  repo?: string | null
}) {
  const owner = repo?.split('/')[0]
  return (
    <div className="flex items-center gap-3 border-t border-(--line) px-4 py-3">
      {/* Hollow, because there is no cover: we do not have this skill. */}
      <span
        aria-hidden="true"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-dashed border-(--line) font-mono text-xs text-(--ink-2)"
      >
        {slug.slice(0, 1).toUpperCase()}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-(--ink)">
          {owner ? <span className="font-normal text-(--ink-2)">{owner}/</span> : null}
          {slug}
        </span>
        <span className="flex items-center gap-1.5 truncate font-mono text-2xs text-(--ink-2)">
          <NetworkIcon network={network} />
          <span className="truncate">
            via @{spottedBy} on {NETWORK_NAME[network]}
          </span>
        </span>
      </span>

      {repo ? (
        <Link
          href={`/github.com/${repo}`}
          className="shrink-0 rounded-md border border-(--line) bg-(--surface) px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors hover:border-(--ink) hover:bg-(--card-pop)"
        >
          Import
        </Link>
      ) : (
        <span className="shrink-0 font-mono text-2xs whitespace-nowrap text-(--ink-2)">
          not in the registry
        </span>
      )}
    </div>
  )
}
