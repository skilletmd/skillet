/**
 * What a mirror candidate actually contains, on the queue page.
 *
 * The row used to say "84/100 across 24 skills" and every decision still
 * started by opening GitHub. These render the three things the decision turns
 * on: what the skills are, where they land in the catalog, and whether we
 * already have them.
 *
 * A server component on purpose. Native `<details>` gives the expander with no
 * client bundle, and 57 skill names cannot live in a table cell.
 */

export interface CandidateSkill {
  slug: string
  name: string | null
  description: string | null
  category: string | null
  overlap_ref: string | null
  overlap_score: number | null
}

/**
 * Categories the catalog is thin in: fewer than half the median category size.
 *
 * A fixed floor cannot work here. All 17 categories are populated and the
 * spread is 27x (quality 189, sales 7), so a floor low enough to spare sales
 * would call nothing thin. Half the median (34.5 on 2026-08-25) names the five
 * lanes that are genuinely short and leaves the rest alone. Computed from live
 * counts, so it moves as the catalog fills in.
 */
export function thinCategories(counts: Record<string, number>): Set<string> {
  const values = Object.values(counts).sort((a, b) => a - b)
  if (values.length === 0) return new Set()
  const mid = Math.floor(values.length / 2)
  const median = values.length % 2 ? values[mid]! : (values[mid - 1]! + values[mid]!) / 2
  const floor = median / 2
  return new Set(Object.keys(counts).filter((k) => counts[k]! < floor))
}

function leaf(slug: string): string {
  return slug.split('/').filter(Boolean).pop() ?? slug
}

/** Category-to-count for one candidate, thin lanes called out. */
export function CategorySummary({
  summary,
  thin,
}: {
  summary: Record<string, number> | null
  thin: Set<string>
}) {
  if (!summary) return null
  const entries = Object.entries(summary).sort((a, b) => b[1] - a[1])
  if (entries.length === 0) return null
  return (
    <span className="mt-0.5 block text-xs text-(--ink-2)">
      {entries.slice(0, 3).map(([key, count], i) => (
        <span key={key}>
          {i > 0 && ' · '}
          <span className={thin.has(key) ? 'font-semibold text-(--ink)' : undefined}>
            {key} {count}
          </span>
          {thin.has(key) && <span className="text-(--ink-2)"> (thin)</span>}
        </span>
      ))}
      {entries.length > 3 && ` · +${entries.length - 3}`}
    </span>
  )
}

/** The expandable skill list: one line per skill, with its overlap if any. */
export function CandidateSkills({
  skills,
  thin,
  threshold,
}: {
  skills: CandidateSkill[]
  thin: Set<string>
  threshold: number
}) {
  if (skills.length === 0) {
    return (
      <p className="text-xs text-(--ink-2)">
        No skills captured for this candidate. It was queued before the queue
        recorded them, or GitHub was unreachable at screen time.
      </p>
    )
  }
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-xs text-(--ink-2) select-none">
        {skills.length === 1 ? 'Show the skill' : `Show all ${skills.length} skills`}
      </summary>
      <ul className="mt-3 space-y-2">
        {skills.map((s) => {
          const overlaps = s.overlap_score != null && s.overlap_score >= threshold
          return (
            <li key={s.slug} className="border-l-2 border-(--line) pl-3">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{s.name ?? leaf(s.slug)}</span>
                {s.category && (
                  <span className="text-xs text-(--ink-2)">
                    {s.category}
                    {thin.has(s.category) && ' (thin)'}
                  </span>
                )}
                {overlaps && s.overlap_ref && (
                  <a
                    href={`/${s.overlap_ref}`}
                    target="_blank"
                    rel="noopener"
                    className="text-xs text-(--ink-2) underline underline-offset-2"
                    title={`Similarity ${s.overlap_score?.toFixed(2)}`}
                  >
                    close to {s.overlap_ref}
                  </a>
                )}
              </div>
              {s.description && (
                <p className="mt-0.5 line-clamp-2 text-xs text-(--ink-2)">{s.description}</p>
              )}
            </li>
          )
        })}
      </ul>
    </details>
  )
}
