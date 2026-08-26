import Link from 'next/link'
import { GitHubIcon } from '@/components/auth-provider-icons'
import { SkillIcon } from '@/components/directory-card'
import { humanizeSlug } from '@skillet/protocol/humanize'
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
  category,
  name,
}: {
  /** The skill name as written, e.g. `scandinavian-design`. */
  slug: string
  /** Where it was spotted. Omit on a card that already lists its sources: the
   *  attribution is right above, and repeating it spends the one line this row
   *  has on something the reader just read. */
  network?: Network | null
  /** Handle of the person whose post named it. Omit alongside `network`. */
  spottedBy?: string | null
  /** `owner/repo` the post linked, when it linked one. */
  repo?: string | null
  /** Prefilled category, when we could guess one. Draws the cover the skill
   *  will actually get once imported, instead of a placeholder initial. */
  category?: string | null
  /** Display name from the skill's own frontmatter, when we read it. Falls
   *  back to humanizing the slug. */
  name?: string | null
}) {
  const owner = repo?.split('/')[0]
  return (
    <div className="flex items-center gap-3 border-t border-(--line) px-4 py-3">
      {/* With a category we can draw the real cover, since the registry
          prefills from the same signals at import: what the reader sees here is
          what they get. Without one, hollow, because we do not have this skill.
          SkillIcon paints into `absolute inset-0`, so it needs a sized
          positioned parent or it covers the whole row. */}
      {category ? (
        <span className="relative h-8 w-8 shrink-0">
          <SkillIcon seed={repo ?? slug} category={category} radius="rounded-lg" />
        </span>
      ) : (
        <span
          aria-hidden="true"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-dashed border-(--line) font-mono text-xs text-(--ink-2)"
        >
          {slug.slice(0, 1).toUpperCase()}
        </span>
      )}

      <span className="min-w-0 flex-1">
        {/* The skill's name leads, the way it would on its own page. The repo
            path is provenance and belongs underneath: a reader recognises
            "Scandinavian Design" and has to parse owner/slug. */}
        <span className="block truncate text-sm font-semibold text-(--ink)">
          {name ?? humanizeSlug(slug)}
        </span>
        <span className="flex items-center gap-1.5 truncate font-mono text-2xs text-(--ink-2)">
          {network && spottedBy ? (
            <>
              <NetworkIcon network={network} />
              <span className="truncate">
                via @{spottedBy} on {NETWORK_NAME[network]}
              </span>
            </>
          ) : repo ? (
            <>
              <GitHubIcon className="h-3 w-3 shrink-0" />
              <span className="truncate">
                <span className="text-(--ink-2)">{owner}/</span>
                {repo.split('/')[1]}
              </span>
            </>
          ) : null}
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
