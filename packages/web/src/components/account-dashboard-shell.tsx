import { SectionNav } from '@/components/ui/section-nav'
import { SettingsNav } from '@/components/settings/settings-nav'
import { SETTINGS_NAV_ITEMS } from '@/components/settings/settings-nav-items'

const SETTINGS_TABS = SETTINGS_NAV_ITEMS.map(({ href, label }) => ({ href, label }))

export function AccountDashboardShell({
  handle,
  children,
}: {
  handle?: string | null
  children: React.ReactNode
}) {
  // Pre-claim users (no handle yet) have no SettingsNav to anchor the rail
  // column, so we drop the two-column grid entirely. Otherwise the lone main
  // child lands in the rail's 224px slot and the page reads as squished to the
  // left. Once a handle is claimed the grid renders normally.
  // Tighter top padding below lg — matching the activity (feed) layout — so the
  // settings subnav tabs ride at the same height as the Feed tabs instead of
  // sitting ~32px lower under dead space. At lg the rail becomes a vertical sidebar
  // (no top subnav), so restore the standard pt-10 breathing room or the whole
  // layout hugs the header. lg (1024px) matches the Feed/Browse rail breakpoint.
  return (
    <main className="marketing-home consumer-theme mx-auto max-w-[1120px] px-[clamp(16px,4vw,32px)] pt-2 pb-12 sm:pt-4 sm:pb-16 lg:pt-10">
      {/* Mobile: the same white-band bar as Feed/Browse, flush under the global
          header (negative margins cancel the main's px/pt). Desktop hides this and
          shows the vertical rail instead. Only with a claimed handle is there a nav. */}
      {handle ? (
        <div className="-mx-[clamp(16px,4vw,32px)] -mt-2 mb-6 sm:-mt-4 lg:hidden">
          <SectionNav tabs={SETTINGS_TABS} />
        </div>
      ) : null}
      <div className="mx-auto max-w-[1120px]">
        {handle ? (
          <div className="account-dashboard-shell">
            <aside className="account-dashboard-sidebar settings-rail">
              <SettingsNav />
            </aside>
            <div className="account-dashboard-main">
              <div className="account-dashboard-main-inner max-w-[600px]">{children}</div>
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-[600px]">{children}</div>
        )}
      </div>
    </main>
  )
}
