'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export interface SectionNavTab {
  href: string
  label: string
}

/**
 * Reusable secondary navigation: an optional section eyebrow + a row of tabs.
 *
 * One pattern for every sub-navigated surface (design tooling, author profile,
 * settings, …) instead of the ~6 bespoke tab/segmented implementations. On
 * mobile the tab row scrolls horizontally rather than wrapping or cramming —
 * the active tab stays underlined and the strip never breaks to two lines.
 *
 * Active state is derived from the current path (exact match, or a prefix match
 * so nested routes keep their parent tab lit). Pass `active` to override.
 */
export function SectionNav({
  eyebrow,
  tabs,
  active,
  className = '',
}: {
  eyebrow?: string
  tabs: SectionNavTab[]
  active?: string
  className?: string
}) {
  const pathname = usePathname()
  // Longest-match wins so a parent-index tab (e.g. /browse) doesn't also light up
  // on a child route (/browse/all) that has its own, more specific tab.
  const bestHref =
    active ??
    tabs
      .filter((t) => pathname === t.href || (t.href !== '/' && pathname.startsWith(`${t.href}/`)))
      .reduce<string | null>((best, t) => (best && best.length >= t.href.length ? best : t.href), null)
  const isActive = (href: string) => href === bestHref

  return (
    <div className={`border-b border-(--line) bg-(--surface) ${className}`}>
      {/* hide-scrollbar: the strip scrolls on overflow (mobile) without a visible bar.
          px-3 matches the /browse + /feed bars so every secondary nav lines up. */}
      <div className="mx-auto flex max-w-[1320px] items-center gap-4 overflow-x-auto px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {eyebrow ? (
          <span className="shrink-0 py-3 text-xs font-bold uppercase tracking-[0.06em] text-(--ink)">
            {eyebrow}
          </span>
        ) : null}
        <nav aria-label={eyebrow ?? 'Section'} className="flex items-center gap-1">
          {tabs.map((t) => {
            const on = isActive(t.href)
            return (
              <Link
                key={t.href}
                href={t.href}
                aria-current={on ? 'page' : undefined}
                className={`shrink-0 whitespace-nowrap border-b-2 px-3 py-3 text-sm transition-colors ${
                  on
                    ? 'border-(--ink) font-semibold text-(--ink)'
                    : 'border-transparent text-(--ink-2) hover:text-(--ink)'
                }`}
              >
                {t.label}
              </Link>
            )
          })}
        </nav>
      </div>
    </div>
  )
}
