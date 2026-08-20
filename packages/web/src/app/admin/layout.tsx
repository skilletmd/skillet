import { redirect } from 'next/navigation'
import { isAdmin } from '@/lib/admin'
import { AdminDashboardShell } from '@/components/admin/admin-dashboard-shell'

// One shell + rail for the whole /admin area, mounted once so the rail stays put
// across Overview → Mirror → Reports → Blog. Access is gated at the edge by
// proxy.ts → adminProxyGate; this re-checks at the render boundary (defense in
// depth) and redirects any non-admin that reaches server rendering.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await isAdmin())) redirect('/')
  return <AdminDashboardShell>{children}</AdminDashboardShell>
}
