import { Shimmer } from '@/components/ui/shimmer'
import { Panel } from '@/components/ui/panel'

/**
 * Grid skeleton while ExploreSurface catalog fetches stream in. Mirrors the real
 * DIRECTORY_GRID (2-up at lg, gap-x-6/gap-y-6) and the CardMd anatomy — h-11 mark
 * (matching the top-ten rows), title/subtitle column, a fixed-height description
 * slot, and an edge-to-edge footer divider — so cards don't reflow when results
 * arrive (no layout shift).
 */
export function BrowseGridSkeleton({ cards = 6 }: { cards?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading catalog">
      {/* The people strip that tops category/all views — avatar circles with a
          handle under each — so results don't push the grid down when they
          stream in. */}
      <div className="mb-8 flex items-start gap-8 overflow-hidden">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="flex shrink-0 flex-col items-center gap-2">
            <Shimmer className="h-16 w-16 rounded-full" />
            <Shimmer className="h-3 w-16" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-x-6 gap-y-6 md:grid-cols-2">
      {Array.from({ length: cards }).map((_, i) => (
        <Panel
          key={i}
          padding="sm"
          className="flex flex-col"
        >
          <div className="flex items-center gap-3">
            <Shimmer className="h-11 w-11 shrink-0 rounded-lg" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Shimmer className="h-4 w-1/2" />
              <Shimmer className="h-3 w-1/3" />
            </div>
          </div>
          <div className="mb-5 mt-3.5 flex h-[2.625rem] flex-col justify-center gap-2">
            <Shimmer className="h-3 w-full" />
            <Shimmer className="h-3 w-4/5" />
          </div>
          <div className="-mx-4 mt-auto flex items-center gap-2 border-t border-(--line) px-4 pt-4">
            <Shimmer className="h-4 w-4 rounded-full" />
            <Shimmer className="h-3 w-24" />
          </div>
        </Panel>
      ))}
      </div>
    </div>
  )
}
