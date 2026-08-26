/**
 * Skillet Daily chrome — the masthead and section kickers.
 *
 * The grammar is carried over from the print brief (`spec/competition/_brief-template.html`):
 * an uppercase masthead over a heavy rule, and section kickers built from a mono
 * label, a mono sub, and a hairline that runs to the right edge. The palette is
 * *not* carried over — the print brief is burnt-orange on white paper, which
 * fights the product's near-black accent. Grammar travels, color does not.
 */

export function NewsMasthead({
  dateLabel,
  standfirst,
}: {
  /** The edition's date. Null when there is no edition to date — see
   *  `editionDate` in ../news/page.tsx; the slot collapses rather than printing
   *  today's date over an empty page. */
  dateLabel?: string | null
  standfirst: string
}) {
  return (
    <header>
      <div className="flex flex-wrap items-baseline justify-between gap-4 border-b-2 border-(--ink) pb-3">
        <h1 className="text-xl font-bold tracking-[0.03em] uppercase">Skillet Daily</h1>
        <div className="flex items-baseline gap-4">
          {dateLabel && (
            <span className="font-mono text-xs text-(--ink-2) tabular-nums">{dateLabel}</span>
          )}
          <a
            href="/news/rss.xml"
            className="border-b border-(--line) pb-px font-mono text-xs tracking-[0.1em] uppercase text-(--ink-2) hover:border-(--ink-2) hover:text-(--ink)"
          >
            RSS
          </a>
        </div>
      </div>
      <p className="mt-4 max-w-[65ch] text-base leading-relaxed text-(--ink-2)">{standfirst}</p>
    </header>
  )
}

export function NewsKicker({ label, sub }: { label: string; sub?: string }) {
  return (
    <div className="mt-10 mb-3 flex items-baseline gap-3">
      <span className="font-mono text-xs font-semibold tracking-[0.16em] whitespace-nowrap uppercase text-(--ink)">
        {label}
      </span>
      {sub ? (
        <span className="font-mono text-2xs tracking-[0.08em] whitespace-nowrap uppercase text-(--ink-2)">
          {sub}
        </span>
      ) : null}
      <span aria-hidden className="h-px flex-1 bg-(--line)" />
    </div>
  )
}
