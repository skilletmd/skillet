'use client'

import Link from 'next/link'
import { useState } from 'react'
import { usePathname } from 'next/navigation'
import type { NavSection } from '@/lib/docs-nav'
import { Button } from '@/components/ui/button'
import { Close } from '@/components/ui/icons'

export function DocNav({ sections }: { sections: NavSection[] }) {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)

  // Current page title for the mobile context bar (where am I + tap to jump).
  const allItems = sections.flatMap((s) => s.items)
  const currentItem =
    allItems.find((i) => pathname === i.href) ??
    allItems.find((i) => pathname.startsWith(`${i.href}/`))
  const currentTitle = currentItem?.title ?? 'Docs'

  const navContent = (
    <div className="flex flex-col gap-1">
      {sections.map((section) => (
        <DocNavSection key={section.title} section={section} pathname={pathname} />
      ))}
    </div>
  )

  return (
    <>
      {/* Mobile: a sticky context bar under the header (the docs-SaaS pattern) —
          shows the current page so you know where you are, and opens the drawer.
          Bleeds full-width via negative margins; pins via --site-header-h. */}
      <div className="sticky top-[var(--site-header-h)] z-(--z-sticky) -mx-[clamp(16px,4vw,32px)] -mt-8 border-b border-(--line) bg-(--bg) sm:hidden">
        <button
          type="button"
          className="flex w-full items-center gap-2.5 px-[clamp(16px,4vw,32px)] py-3 text-left text-sm"
          onClick={() => setMobileOpen(true)}
          aria-expanded={mobileOpen}
          aria-controls="docs-mobile-nav"
        >
          <svg width="15" height="15" fill="none" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0 text-(--ink-2)">
            <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span className="truncate font-semibold text-(--ink)">{currentTitle}</span>
          <svg width="12" height="12" fill="none" viewBox="0 0 12 12" aria-hidden="true" className="ml-auto shrink-0 text-(--ink-2)">
            <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {/* Mobile panel + backdrop — both anchored below the header so the top bar
          stays clear. */}
      {mobileOpen && (
        <div
          className="fixed inset-x-0 bottom-0 top-[var(--site-header-h)] z-(--z-overlay) bg-black/40 sm:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <div
        id="docs-mobile-nav"
        className={`fixed bottom-0 left-0 top-[var(--site-header-h)] z-(--z-overlay) w-72 max-w-[85vw] overflow-y-auto bg-(--bg) p-5 shadow-2xl transition-transform duration-200 ease-[var(--ease)] sm:hidden ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-label="Docs navigation"
        aria-hidden={!mobileOpen}
        // Close on link tap (navigation), but keep open when toggling a section.
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('a')) setMobileOpen(false)
        }}
      >
        <div className="mb-4 flex items-center justify-between">
          <Link href="/docs" className="font-mono text-sm font-semibold">
            docs
          </Link>
          <Button
            variant="icon"
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
          >
            <Close className="text-base" />
          </Button>
        </div>
        {navContent}
      </div>

      {/* Desktop sidebar */}
      {/* pb-12, not just pt-6: the rail scrolls, but with no bottom padding the
          last item sat flush against the viewport edge, which reads as cut off
          rather than scrollable. On a short screen that is the difference between
          "there is more" and "the nav is broken". */}
      <aside className="sticky top-[var(--site-header-h)] hidden h-[calc(100vh-var(--site-header-h))] w-(--rail-nav) shrink-0 overflow-y-auto pb-12 pr-4 pt-6 sm:block">
        {navContent}
      </aside>
    </>
  )
}

function DocNavSection({ section, pathname }: { section: NavSection; pathname: string }) {
  // Collapsed sections still open when you're on one of their pages, so the
  // current page is never hidden behind a closed group.
  const hasActivePage = section.items.some(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  )
  const [expanded, setExpanded] = useState(!section.collapsed || hasActivePage)

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center justify-between rounded px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-(--ink-2) hover:text-(--ink)"
        aria-expanded={expanded}
      >
        {section.title}
        <svg
          width="12"
          height="12"
          fill="none"
          viewBox="0 0 12 12"
          aria-hidden="true"
          className={`transition-transform duration-200 ${expanded ? 'rotate-0' : '-rotate-90'}`}
        >
          <path
            d="M2 4l4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {expanded && (
        <ul className="mt-1 space-y-0.5 pb-2">
          {section.items.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={pathname === item.href ? 'page' : undefined}
                className={`block rounded-md px-3 py-1.5 text-sm transition-colors ${
                  pathname === item.href
                    ? 'bg-(--accent-bg) font-medium text-(--accent)'
                    : 'text-(--ink-2) hover:bg-(--accent-bg) hover:text-(--ink)'
                }`}
              >
                {item.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
