export function FeedBodySkeleton() {
  // Timeline rows only — the tab bar and who-to-follow rail live in the feed
  // layout, so they stay put while just the timeline streams.
  return (
    <div aria-busy="true" aria-label="Loading feed" className="space-y-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="flex animate-pulse gap-4 rounded-2xl border border-(--line) bg-(--surface) p-4"
        >
          <div className="h-10 w-10 shrink-0 rounded-full bg-(--line)" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3 w-1/3 rounded bg-(--line)" />
            <div className="h-4 w-2/3 rounded bg-(--line)/80" />
            <div className="h-3 w-1/2 rounded bg-(--line)/60" />
          </div>
        </div>
      ))}
    </div>
  )
}
