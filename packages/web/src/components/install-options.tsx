import Link from 'next/link'
import { buttonClasses } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import { NPX_SKILLET_COMMAND } from '@/config'
import { AppleLogo, WindowsLogo } from '@/components/os-logos'

// App-first install affordance, shared so install looks the same wherever it
// appears (docs overview, marketing surfaces). The Mac/Windows app is the lead
// path; the terminal is a quiet developer backup. Every option routes to
// /install — the one canonical, trust-forward download destination — and never
// cold-downloads a binary from here.
const APP_OPTIONS = [
  {
    label: 'macOS',
    title: 'Mac app',
    body: 'Menu bar app. Sync, publish, and add skills without a terminal.',
    action: 'Download for Mac',
    icon: 'macos',
  },
  {
    label: 'Windows',
    title: 'Windows app',
    body: 'Tray app with the same one-click sync and publish.',
    action: 'Download for Windows',
    icon: 'windows',
  },
] as const

function StartIcon({ type }: { type: string }) {
  if (type === 'macos') return <AppleLogo />
  if (type === 'windows') return <WindowsLogo />
  return null
}

/** App-first install tiles (Mac / Windows) plus a quiet terminal backup. All
 * roads lead to /install. */
export function InstallOptions() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 min-[640px]:grid-cols-2">
        {APP_OPTIONS.map((option) => (
          <Link key={option.label} href="/install" className="onboarding-option has-cta">
            <span className="onboarding-icon">
              <StartIcon type={option.icon} />
            </span>
            <span className="onboarding-copy">
              <span>{option.label}</span>
              <strong>{option.title}</strong>
              <small>{option.body}</small>
            </span>
            <span className={cn(buttonClasses('primary', { size: 'sm' }), 'col-start-2 justify-self-start')}>
              {option.action}
            </span>
          </Link>
        ))}
      </div>
      <p className="text-sm text-(--ink-2)">
        Prefer the terminal?{' '}
        <Link
          href="/install"
          className="font-medium underline decoration-(--line) underline-offset-2 hover:text-(--ink)"
        >
          Run <code className="font-mono text-(--ink)">{NPX_SKILLET_COMMAND}</code>
        </Link>
        {'. '}The CLI is the developer backup.
      </p>
    </div>
  )
}
