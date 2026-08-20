/**
 * The compact in-app page header (skills, feed, docs, library, settings) — a
 * 26px title with an optional right-aligned action on the same row, and an
 * optional muted subtitle below. No eyebrow: the nav/sidebar already says where
 * you are. The big editorial eyebrow+title+lede header is {@link
 * import('./page-intro').PageIntro}.
 */
export function PageHeader({
  title,
  lede,
  action,
}: {
  title: string
  lede?: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-(--ink)">{title}</h1>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {lede && (
        <p className="mt-1.5 max-w-[60ch] text-base leading-relaxed text-(--ink-2)">{lede}</p>
      )}
    </div>
  )
}
