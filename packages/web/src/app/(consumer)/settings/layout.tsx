import { auth } from '@/auth'
import { AccountDashboardShell } from '@/components/account-dashboard-shell'

// One shell + sidebar for the whole settings area. Rendered once here (not per
// page) so the rail stays mounted across Account → Devices → GitHub → Teams
// navigation instead of remounting and flickering. The redirect stubs and the
// kit-edit redirect under /settings short-circuit before this renders anything.
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  return <AccountDashboardShell handle={session?.handle ?? null}>{children}</AccountDashboardShell>
}
