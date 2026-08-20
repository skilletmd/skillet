import { Suspense, type ReactNode } from 'react'
import { ActivityLeftRail, ActivityWhoToFollowRail } from './activity-shell'
import { DiscoveryRailColumn } from './discovery-rail-column'
import { WhoToFollowSkeleton } from '@/components/home/shelf-skeleton'

// The shared activity shell — viewer card, Feed/Notifications section nav, and the
// who-to-follow rail. Wrapping BOTH /feed and /notifications in one layout keeps
// the rails mounted when you flick between them: only the center column re-streams,
// so there's no whole-page refresh. Route group `(activity)` adds no URL segment.

export default function ActivityLayout({ children }: { children: ReactNode }) {
  return (
    // Tighter top padding than the standard page shell: the activity sections have
    // no page title, so the full pt-8/pt-10 reads as dead space above the tabs.
    <main className="marketing-home consumer-theme mx-auto max-w-[1120px] px-[clamp(16px,4vw,32px)] pt-2 pb-12 sm:pt-4 sm:pb-16">
      {/* min-height so a short surface (e.g. Notifications with one item) still
          gives the sticky rail enough column to pin at `top-24`. A sticky element
          is bounded by its containing block, so on a short page the aside is too
          short to reach the pin point and the rail floats higher — which read as
          the left nav "shifting up" on Notifications vs the taller Feed/Updates.
          6rem ≈ the top-24 offset, so the content area is ~one viewport tall. */}
      <div className="flex min-h-[calc(100vh-6rem)] gap-8">
        {/* Left: viewer mini-profile + section nav + (Feed-only) type filter.
            Full-height column with a sticky inner block — matching the right
            rail — so the nav stays pinned the whole scroll instead of releasing
            near the bottom. */}
        <aside className="hidden w-(--rail-nav) shrink-0 pr-4 md:block">
          <div className="sticky top-24">
            {/* ActivityLeftRail renders synchronously: the section nav paints as
                text on first load (it reads the known session client-side) and only
                the viewer card streams behind its own skeleton. */}
            <ActivityLeftRail />
          </div>
        </aside>

        {/* Center: each surface owns its header + body */}
        <div className="min-w-0 flex-1">{children}</div>

        {/* Right: who to follow (discovery) — dropped on Notifications/Updates,
            which are focused triage surfaces (see DiscoveryRailColumn). */}
        <DiscoveryRailColumn>
          <Suspense
            fallback={
              <div className="surface-aside-stack">
                <WhoToFollowSkeleton />
              </div>
            }
          >
            <ActivityWhoToFollowRail />
          </Suspense>
        </DiscoveryRailColumn>
      </div>
    </main>
  )
}
