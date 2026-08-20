import { SectionNav } from '@/components/ui/section-nav'
import { AdminNav } from '@/components/admin/admin-nav'
import { ADMIN_NAV_ITEMS } from '@/components/admin/admin-nav-items'

const ADMIN_TABS = ADMIN_NAV_ITEMS.map(({ href, label }) => ({ href, label }))

/**
 * One shell + sidebar for the whole /admin area — the same two-column frame as
 * the settings AccountDashboardShell, so admin reads as part of the same app.
 * Rendered once in app/admin/layout.tsx so the rail stays mounted across
 * Overview → Mirror → Reports → Blog navigation. Admin is always gated (no
 * pre-claim branch), so the rail always renders. The inner column is a touch
 * wider than settings' 600px because admin surfaces carry data tables.
 */
export function AdminDashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="marketing-home consumer-theme mx-auto max-w-[1120px] px-[clamp(16px,4vw,32px)] pt-2 pb-12 sm:pt-4 sm:pb-16 lg:pt-10">
      {/* Mobile: the same white-band bar as Feed/Browse/Settings, flush under the
          global header. Desktop hides this and shows the vertical rail instead. */}
      <div className="-mx-[clamp(16px,4vw,32px)] -mt-2 mb-6 sm:-mt-4 lg:hidden">
        <SectionNav tabs={ADMIN_TABS} />
      </div>
      <div className="mx-auto max-w-[1120px]">
        <div className="account-dashboard-shell">
          <aside className="account-dashboard-sidebar settings-rail">
            <AdminNav />
          </aside>
          <div className="account-dashboard-main">
            <div className="account-dashboard-main-inner max-w-[860px]">{children}</div>
          </div>
        </div>
      </div>
    </main>
  )
}
