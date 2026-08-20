'use client'

import Link from 'next/link'
import { Suspense } from 'react'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { SiteAuthNav } from '@/components/site-auth-nav'
import { Button } from '@/components/ui/button'
import { FinishSetupPill } from '@/components/finish-setup-pill'
import { UniversalSearch } from '@/components/search/search-lazy'
import { browseHref } from '@/lib/urls'

// Feed is no longer a top-nav item — the Skillet wordmark is the home/Feed entry
// (logged-in `/` redirects to Feed) and the bell carries the attention count.
const PRIMARY_LINKS = [{ href: browseHref(), label: 'Browse' }]

export function SiteNav({ transparentAtTop = false }: { transparentAtTop?: boolean }) {
  const pathname = usePathname()
  const [atTop, setAtTop] = useState(true)
  const headerRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const update = () => setAtTop(window.scrollY <= 8)
    update()
    window.addEventListener('scroll', update, { passive: true })
    return () => window.removeEventListener('scroll', update)
  }, [])

  // Publish the real header height as --site-header-h so anything pinned beneath
  // it (the docs context bar, the docs sidebar) lines up exactly, at any
  // breakpoint, without a hardcoded guess.
  useEffect(() => {
    const el = headerRef.current
    if (!el) return
    const setVar = () =>
      document.documentElement.style.setProperty('--site-header-h', `${el.offsetHeight}px`)
    setVar()
    const ro = new ResizeObserver(setVar)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const headerClassName = transparentAtTop && atTop ? 'site-header is-home-top' : 'site-header'
  // The wordmark is the home entry; show it active (accent) on the home surfaces —
  // the landing (/) and Feed (where logged-in home lands).
  const onHome = pathname === '/' || pathname === '/feed' || pathname.startsWith('/feed/')

  return (
    <header ref={headerRef} className={headerClassName}>
      <div className="mx-auto flex max-w-[1120px] items-center gap-3 px-[clamp(16px,4vw,32px)] py-2 sm:gap-4 sm:py-3">
        <Link
          href="/"
          aria-current={onHome ? 'page' : undefined}
          className="site-brand-link shrink-0 font-mono text-base font-semibold"
        >
          <span className="site-logo-mark" aria-hidden="true" />
          Skillet
        </Link>
        <nav className="flex min-w-0 shrink-0 items-center gap-5 text-sm md:gap-6">
          {PRIMARY_LINKS.map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`)
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? 'page' : undefined}
                className="site-nav-link"
              >
                {link.label}
              </Link>
            )
          })}
        </nav>
        {/* Onboarding nudge grouped with the primary nav (not the right tray), so it
            reads as intentional and — sitting left of the flex-1 spacer — its late
            appearance extends into the gap instead of shifting the search. */}
        <FinishSetupPill />
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2 pr-1 md:gap-3 md:pr-2">
          <UniversalSearch />
          <Suspense
            fallback={
              <Button href="/login" variant="tertiary" size="sm" className="shrink-0">
                Sign in
              </Button>
            }
          >
            <SiteAuthNav />
          </Suspense>
        </div>
      </div>
    </header>
  )
}
