import type { Metadata } from 'next'
import { Suspense } from 'react'
import Link from 'next/link'
import { markDynamicRoute } from '@/lib/mark-dynamic-route'
import { PageHeader } from '@/components/page-header'
import { SettingsSection } from '@/components/ui/setting-section'
import { SettingsList } from '@/components/ui/settings-list'
import { ChevronRight } from '@/components/ui/icons'
import { fetchAdminCounts } from './admin-counts'

export const metadata: Metadata = {
  title: 'Admin · Skillet',
  robots: { index: false, follow: false },
}

const SURFACES = [
  { href: '/admin/log', label: 'Activity', desc: 'Recent signups and new skills' },
  { href: '/admin/mirror', label: 'Mirror queue', desc: 'Review mirrored-skill candidates from discovery' },
  { href: '/admin/reports', label: 'Reports', desc: 'Triage reported skills; quarantine or unlist' },
  { href: '/admin/moderation', label: 'Moderation', desc: 'Hide a skill, kit, or whole user from browse' },
  { href: '/admin/featured', label: 'Featured', desc: 'Feature skills and kits at the top of browse' },
  { href: '/admin/blog', label: 'Blog', desc: 'Write and manage blog posts' },
]

function CountRow({ href, label, count }: { href: string; label: string; count: number | null }) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-(--accent-bg)"
      >
        <span className="min-w-0 truncate text-sm font-medium text-(--ink)">{label}</span>
        <span className="flex shrink-0 items-center gap-2 text-sm text-(--ink-2)">
          {count === null ? '—' : count}
          <ChevronRight className="h-4 w-4" />
        </span>
      </Link>
    </li>
  )
}

async function AdminOverviewContent() {
  await markDynamicRoute()
  const counts = await fetchAdminCounts()

  return (
    <div>
      <PageHeader title="Admin" lede="Operational tooling: queues, moderation, and content." />

      <div className="space-y-10">
        <SettingsSection
          title="Needs attention"
          description="Open operational work across the queues."
        >
          <SettingsList>
            <CountRow
              href="/admin/mirror"
              label="Mirror candidates awaiting review"
              count={counts.pendingMirror}
            />
            <CountRow
              href="/admin/reports"
              label="Skills with open reports"
              count={counts.openReports}
            />
          </SettingsList>
        </SettingsSection>

        <SettingsSection title="Surfaces" description="Everything under the admin area.">
          <SettingsList>
            {SURFACES.map((s) => (
              <li key={s.href}>
                <Link
                  href={s.href}
                  className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-(--accent-bg)"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-(--ink)">{s.label}</span>
                    <span className="block truncate text-xs text-(--ink-2)">{s.desc}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-(--ink-2)" />
                </Link>
              </li>
            ))}
          </SettingsList>
        </SettingsSection>
      </div>
    </div>
  )
}

export default function AdminOverviewPage() {
  return (
    <Suspense fallback={null}>
      <AdminOverviewContent />
    </Suspense>
  )
}
