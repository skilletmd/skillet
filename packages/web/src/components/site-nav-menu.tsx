'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useEffect, useRef, useState } from 'react'
import { NAV_LINKS } from '@/components/site-auth-nav'

/**
 * The phone-width nav menu. Below `sm` the header can't hold the inline links
 * plus the right tray without wrapping, so Home / Browse / Docs collapse in
 * here, at the end of the tray. Search stays a visible icon — it's the one nav
 * affordance worth a tap, not two.
 *
 * SIGNED-OUT ONLY. A signed-in viewer's avatar menu carries the same links (see
 * AccountMenu) — two phone menus side by side split "where can I go" across
 * both of them. Log in lives in here as well, so the signed-out header carries
 * exactly ONE filled control (Join): two auth entries plus a menu gave a
 * stranger three things to weigh in a 390px bar, and the sign-in path is for
 * people who already decided.
 *
 * The glyph is drawn to the search trigger's spec — 20px box, 1.6 stroke,
 * `--ink-2` — rather than the shared `em`-sized icon set, because these two sit
 * side by side and any difference in weight reads as two different icon kits.
 * Same 36px target, same flat borderless treatment (`.universal-search-trigger`
 * in globals.css is the other half of this pair).
 *
 * Hidden from `sm` up, where the inline links come back.
 */
export function SiteNavMenu({ className = '' }: { className?: string }) {
  const pathname = usePathname()
  const { status } = useSession()
  const ref = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)

  // A tap that navigates should leave the menu closed behind it.
  useEffect(() => setOpen(false), [pathname])

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Signed in, the avatar menu already exists and already holds Profile,
  // Settings, teams, theme, and Sign out — a second phone menu beside it made
  // five controls in a 390px tray and split "where can I go" across two of
  // them. Home / Browse / Docs live in the account menu there instead. This
  // hamburger is the signed-out viewer's only menu, so it stays for them.
  if (status !== 'unauthenticated') return null

  // Same list the account menu shows, so the two menus can't drift. No Home row:
  // the wordmark is the home entry at every width.
  const items = NAV_LINKS.map((link) => ({
    ...link,
    active: pathname === link.href || (pathname?.startsWith(`${link.href}/`) ?? false),
  }))
  return (
    <div ref={ref} className={`relative shrink-0 ${className}`}>
      <button
        type="button"
        aria-label="Menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex h-9 w-9 items-center justify-center rounded-full border-0 bg-transparent transition-colors ${open ? 'bg-(--accent-bg) text-(--ink)' : 'text-(--ink-2) hover:bg-(--accent-bg) hover:text-(--ink)'}`}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path
            d="M3 5.5h14M3 10h14M3 14.5h14"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <div
        className={`absolute right-0 top-full z-50 pt-2 transition-opacity duration-150 ${
          open ? 'visible opacity-100' : 'invisible opacity-0'
        }`}
      >
        <div className="w-52 surface-card p-1.5 shadow-(--shadow-lg)" role="menu">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              role="menuitem"
              aria-current={item.active ? 'page' : undefined}
              className={`flex min-h-11 items-center rounded-lg px-3 text-sm transition-colors hover:bg-(--accent-bg) ${item.active ? 'font-semibold text-(--ink)' : 'text-(--ink)'}`}
            >
              {item.label}
            </Link>
          ))}
          <div className="-mx-1.5 my-1 border-t border-(--line)" />
          <Link
            href="/login"
            role="menuitem"
            className="flex min-h-11 items-center rounded-lg px-3 text-sm text-(--ink) transition-colors hover:bg-(--accent-bg)"
          >
            Log in
          </Link>
        </div>
      </div>
    </div>
  )
}
