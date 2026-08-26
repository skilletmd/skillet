import { PAGE_CONTAINER_CLASS } from '@/lib/page-layout'
import { CHART_SIZE, KITS_GRID_CLASS } from '@/components/home/home-shared'
import { Shimmer } from '@/components/ui/shimmer'
import { Panel } from '@/components/ui/panel'

// No blurb line: the real shelves are a title (and maybe "See all") only, so
// reserving a second row here would collapse when the content streams in.
function ShelfHeaderSkeleton({
  titleWidth = 'w-40',
  seeAll = false,
}: {
  titleWidth?: string
  /** Reserve the trailing "See all" link — only shown when the real shelf has one. */
  seeAll?: boolean
}) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-4">
      <Shimmer className={`h-7 ${titleWidth}`} />
      {seeAll ? <Shimmer className="h-4 w-16 shrink-0" /> : null}
    </div>
  )
}

function SkillTileSkeletons({ count }: { count: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="h-[164px] animate-pulse rounded-2xl border border-(--line) bg-(--surface)"
        />
      ))}
    </div>
  )
}

/**
 * Matches Featured kits → charts → New on Skillet in HomeCatalogShelves. Mirror the
 * same props the real shelves get so the skeleton's shape doesn't drift from what
 * streams in: `kitCount` cards, `chartSize` rank rows per column, and — when
 * `seeAll` is off (the /browse landing, which has its own "Featured" h1) — no
 * featured-shelf title and no "See all" links.
 */
export function CatalogShelvesSkeleton({
  kitCount = 3,
  chartSize = CHART_SIZE,
  seeAll = true,
}: {
  kitCount?: number
  chartSize?: number
  seeAll?: boolean
} = {}) {
  return (
    <div aria-busy="true" aria-label="Loading catalog">
      <section className="mt-12 first:mt-0">
        {/* The featured kits shelf only carries a title when seeAll is on. */}
        {seeAll && <ShelfHeaderSkeleton titleWidth="w-36" seeAll />}
        <div className={KITS_GRID_CLASS}>
          {Array.from({ length: kitCount }).map((_, i) => (
            <div key={i}>
              {/* Mirror CardLg: one bordered card — inset 4:3 cover, then title,
                  and byline, so the shelf doesn't reflow when kits stream in. */}
              <Panel padding="none" className="overflow-hidden">
                <div className="aspect-[4/3] w-full animate-pulse bg-(--line)" />
                <div className="px-4 pb-4 pt-3">
                  <Shimmer className="h-4 w-1/2" />
                  <Shimmer className="mt-2 h-3 w-full" />
                  <Shimmer className="mt-4 h-3 w-2/3" />
                </div>
              </Panel>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-12">
        <div className="grid grid-cols-1 gap-x-8 gap-y-10 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i}>
              <ShelfHeaderSkeleton titleWidth="w-44" seeAll={seeAll} />
              <Panel padding="none" className="overflow-hidden">
                {Array.from({ length: chartSize }).map((_, j) => (
                  <div
                    key={j}
                    className="flex items-center gap-3 border-t border-(--line) px-4 py-2.5 first:border-t-0"
                  >
                    <Shimmer className="h-4 w-4 shrink-0" />
                    <Shimmer className="h-11 w-11 shrink-0 rounded-lg" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <Shimmer className="h-3.5 w-32" />
                      <Shimmer className="h-3 w-20" />
                    </div>
                    <Shimmer className="h-8 w-12 shrink-0" />
                  </div>
                ))}
              </Panel>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-12">
        <ShelfHeaderSkeleton titleWidth="w-36" seeAll={seeAll} />
        <SkillTileSkeletons count={4} />
      </section>
    </div>
  )
}

export function FreshShelfSkeleton() {
  return (
    <section className="mt-12" aria-busy="true" aria-label="Loading your feed">
      <ShelfHeaderSkeleton titleWidth="w-56" />
      <SkillTileSkeletons count={2} />
    </section>
  )
}


export function WhoToFollowSkeleton() {
  return (
    <div className="wtf-card animate-pulse" aria-busy="true" aria-label="Loading suggestions">
      <div className="mb-3 h-4 w-28 rounded bg-(--line)" />
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="mb-3 flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-(--line)" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-24 rounded bg-(--line)" />
            <div className="h-3 w-32 rounded bg-(--line)" />
          </div>
        </div>
      ))}
    </div>
  )
}

