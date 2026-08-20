import { Suspense, type ReactNode } from 'react'
import { FeedControls, FeedTeamTabs } from './feed-tabs'
import { ScrollTopOnEnter } from './scroll-top-on-enter'
import { loadLensProps } from '../activity-shell'

// Feed center chrome. The section nav (Feed / Notifications / Updates) lives in the
// shared activity left rail, so the center needs no title header — it's just the
// Feed (activity) section's lens tabs + type filter, then the body ({children}),
// which is the only part that re-streams when switching sections.

// Only the team lenses need the orgs fetch; For you / Global render immediately, so
// just the team tabs stream into the controls row. `loadLensProps` is cache()-backed,
// so streaming both the mobile and desktop variants costs a single orgs fetch.
async function FeedTeamTabsLoader({ variant }: { variant: 'desktop' | 'mobile' }) {
  const { teams } = await loadLensProps()
  return <FeedTeamTabs teams={teams} variant={variant} />
}

export default function FeedLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ScrollTopOnEnter />
      {/* Desktop: lens tabs + type filter (sections live in the left rail).
          Mobile: one flush full-bleed bar carrying both axes — see FeedControls. */}
      <FeedControls
        teamTabsMobile={
          <Suspense fallback={null}>
            <FeedTeamTabsLoader variant="mobile" />
          </Suspense>
        }
        teamTabsDesktop={
          <Suspense fallback={null}>
            <FeedTeamTabsLoader variant="desktop" />
          </Suspense>
        }
      />
      {/* Spacing below the Feed controls lives on the controls (mb-6); on the
          Notifications/Updates sections those controls are absent, so the body
          sits at the top with no dead gap. */}
      {children}
    </>
  )
}
