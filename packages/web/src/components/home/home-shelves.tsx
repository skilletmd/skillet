import {
  getDiscoverFeed,
  getKitCatalog,
  getPeopleCatalog,
  getSkillCatalog,
} from '@/lib/registry'
import type { FeedResult } from '@/lib/registry'
import { getAllPosts } from '@/lib/blog'
import { KitCard } from '@/components/kit-card'
import { KitCardMenu } from '@/components/kits/kit-card-menu'
import { kitCardMenu } from '@/lib/kit-card-menu'
import {
  CHART_SIZE,
  ChartsRow,
  FromTheBlog,
  KITS_GRID_CLASS,
  Shelf,
  SkillEventGrid,
  avatarMapFromPeople,
  recentSkills,
  safe,
} from '@/components/home/home-shared'
import { feedGlobalHref, kitHref } from '@/lib/urls'
import { ActivityRail } from '@/components/home/activity-rail'
import { getFollowedAuthorHandles, withViewerFollows } from '@/lib/follows-server'
import { browseSsrLog, browseSsrProbeClock, browseSsrSpan } from '@/lib/browse-ssr-probe'

/**
 * Cached catalog shelves — kits, charts, discover feed. Shared by the logged-out
 * homepage landing (smaller teaser: kitCount=4, chartSize=5) and Browse Featured
 * (fuller: defaults to 6 kits / top-10 charts).
 */
export async function HomeCatalogShelves({
  viewerHandle,
  kitCount = 6,
  chartSize = CHART_SIZE,
  seeAll = true,
  showNewlyPublished = true,
  // Browse Featured skips SSR /me/following — client follow context paints after.
  ssrViewerFollows = true,
}: {
  viewerHandle: string | null
  kitCount?: number
  chartSize?: number
  /** Show the per-shelf "See all" links. Off on /browse, which already is the
   *  full catalog landing. */
  seeAll?: boolean
  /** Show the "New on Skillet" freshness shelf. Off on the logged-out homepage,
   *  where the right-rail activity feed already carries recent publishes. */
  showNewlyPublished?: boolean
  /** When false, skip SSR follow overlay (Browse shell-first). Default true keeps
   *  homepage Top creators personalized on first paint. */
  ssrViewerFollows?: boolean
}) {
  // Kits feed both the featured grid (kitCount) and the charts (sliced to
  // chartSize), so fetch enough for whichever is larger.
  const kitsLimit = Math.max(kitCount, chartSize)
  // Fetch the catalog and (optionally) the viewer's followed-author set together —
  // the follow overlay needs both, but neither fetch depends on the other.
  const shelvesStarted = browseSsrProbeClock()
  browseSsrLog('shelves_enter', {
    ssrViewerFollows,
    kitCount,
    chartSize,
  })
  const [kits, popular, people, discover, followed] = await Promise.all([
    browseSsrSpan('shelves_kits', () =>
      safe(getKitCatalog({ limit: kitsLimit }), {
        items: [],
        total: 0,
        limit: kitsLimit,
        offset: 0,
      }),
    ),
    browseSsrSpan('shelves_skills', () =>
      safe(getSkillCatalog({ limit: chartSize }), {
        skills: [],
        total: 0,
        limit: chartSize,
        offset: 0,
      }),
    ),
    browseSsrSpan('shelves_people', () =>
      safe(getPeopleCatalog({ limit: chartSize }), {
        items: [],
        total: 0,
        limit: chartSize,
        offset: 0,
      }),
    ),
    browseSsrSpan('shelves_discover', () => getDiscoverFeed()),
    ssrViewerFollows
      ? browseSsrSpan('shelves_follows', () => getFollowedAuthorHandles())
      : Promise.resolve(new Set<string>()),
  ])
  browseSsrLog('shelves_fanout_done', {
    ms: shelvesStarted ? browseSsrProbeClock() - shelvesStarted : undefined,
    ssrViewerFollows,
  })

  // Stamp each creator with the viewer's live follow state so the Top creators
  // list shows "Following" for people they already follow (the catalog itself
  // defaults viewerFollows to false). Browse skips this on SSR; client context
  // fills Following after paint.
  const creators = withViewerFollows(people.items, followed)

  const featuredKits = kits.items.slice(0, kitCount)
  const avatarByHandle = avatarMapFromPeople(people.items)
  const newlyPublished = recentSkills(discover, 4)

  const shelves = (
    <>
      <ChartsRow
        skills={popular.skills}
        kits={kits.items}
        creators={creators}
        viewerHandle={viewerHandle}
        chartSize={chartSize}
        seeAll={seeAll}
      />

      {featuredKits.length > 0 && (
        // On /browse (seeAll=false) the page's own "Featured" h1 already labels
        // this, so the shelf title would double up — drop it there.
        <Shelf
          title={seeAll ? 'Featured kits' : undefined}
          seeAllHref={seeAll ? '/browse/kits' : undefined}
        >
          {/* Responsive grid: fits the handful of featured kits today, wraps to a
              second row if more get featured. No scroll. */}
          <div className={KITS_GRID_CLASS}>
            {featuredKits.map((kit) => (
              <KitCard
                key={kit.id}
                kitId={kit.id}
                href={kitHref(kit.owner, kit.slug)}
                name={kit.name}
                owner={kit.owner}
                skillCount={kit.skillCount}
                subscriberCount={kit.subscriberCount}
                skillRefs={kit.skillRefs ?? []}
                skillCategories={kit.skillCategories ?? []}
                category={kit.category}
                makerAvatarUrl={avatarByHandle.get(kit.owner) ?? null}
                menu={
                  <KitCardMenu
                    {...kitCardMenu({ kitId: kit.id, owner: kit.owner, viewerHandle })}
                  />
                }
              />
            ))}
          </div>
        </Shelf>
      )}



      {showNewlyPublished && newlyPublished.length > 0 && (
        <Shelf
          title="New on Skillet"
          blurb="Just published across the registry."
          seeAllHref={seeAll ? feedGlobalHref() : undefined}
        >
          <SkillEventGrid skills={newlyPublished} avatarByHandle={avatarByHandle} />
        </Shelf>
      )}
    </>
  )

  return shelves
}

/** Blog shelf — full-width 3-up at the bottom of the homepage main column. */
export function HomeBlogShelf() {
  return <FromTheBlog posts={getAllPosts().slice(0, 3)} />
}

/** Live registry activity for the logged-out homepage right rail — first page is
 *  server-rendered, then the client rail polls the discover feed for new events. */
export async function HomeActivityRail() {
  const feed = await safe(getDiscoverFeed(), null as FeedResult | null)
  return <ActivityRail initial={feed?.events ?? []} />
}
