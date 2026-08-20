import type { ReactNode } from 'react'

/**
 * The trust reassurance shown at the install moment — three short, plain-language
 * promises, not a wall of bullets or jargon. Installing an app that syncs your
 * skills is a Dropbox-level trust decision; this earns it in words a normal
 * person reads in two seconds. Depth lives in the docs, not here.
 *
 * Keep it true and keep it human. No "signed & notarized", no claim we can't
 * back today (e.g. Windows signing, scanning) — see the security-hardening plan.
 */

type Pillar = { icon: ReactNode; title: string; line: string }

const PILLARS: Pillar[] = [
  {
    icon: <LockIcon />,
    title: 'Private by default',
    line: 'Your skills are yours. Nothing is public until you publish it.',
  },
  {
    icon: <ShieldIcon />,
    title: 'Never deletes your work',
    line: 'It only writes into your AI tools, and every update waits for your OK.',
  },
  {
    icon: <BoxIcon />,
    title: 'Yours to keep',
    line: 'Open-source, plain files you own. No lock-in, ever.',
  },
]

export function TrustPanel() {
  return (
    <div className="grid grid-cols-1 gap-8 sm:grid-cols-3 sm:gap-10">
      {PILLARS.map((p) => (
        <div key={p.title} className="flex flex-col items-start gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-(--accent-bg) text-(--accent)">
            {p.icon}
          </span>
          <h3 className="text-base font-semibold text-(--ink)">{p.title}</h3>
          <p className="max-w-[34ch] text-sm leading-[1.5] text-(--ink-2)">{p.line}</p>
        </div>
      ))}
    </div>
  )
}

function LockIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="3.5" y="8" width="11" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.5 8V6a3.5 3.5 0 0 1 7 0v2" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function ShieldIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M9 2.5 14 4.3v4.2c0 3.1-2 5.4-5 6.8-3-1.4-5-3.7-5-6.8V4.3L9 2.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="m6.8 8.7 1.6 1.6 3-3.2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function BoxIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M9 2.6 14.5 5.5v7L9 15.4 3.5 12.5v-7L9 2.6Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M3.6 5.6 9 8.5l5.4-2.9M9 8.5v6.7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  )
}
