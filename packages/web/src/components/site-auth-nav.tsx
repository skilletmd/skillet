'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { signOutFromWeb } from '@/lib/sign-out-action'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { SKILLET_EVENTS } from '@/lib/events'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Plus, Sliders } from '@/components/ui/icons'
import { ThemeToggle } from '@/components/theme-toggle'
import { NotificationBell } from '@/components/notifications/notification-bell'
import { AttentionToast } from '@/components/notifications/attention-toast'
import { registryGetJson } from '@/lib/registry-proxy'
import { browseHref } from '@/lib/urls'
import type { MyOrgEntry } from '@/lib/orgs'

interface ProfileUpdatedEvent extends Event {
  detail?: {
    handle?: string
    avatarUrl?: string
  }
}

// The nav destinations a phone header can't show inline. Signed in they ride in
// the account menu (below); signed out they are the hamburger's whole content.
// No Home row: the wordmark is the home entry at every width, and a menu item
// pointing at the logo two inches away is a row that teaches nothing.
export const NAV_LINKS: { href: string; label: string; icon: ReactNode }[] = [
  { href: browseHref(), label: 'Browse', icon: <BrowseGlyph /> },
  { href: '/docs', label: 'Docs', icon: <DocsGlyph className="h-4 w-4" /> },
]

// Primary action — accent-tinted so it reads as the main verb in the tray. The
// active page gets the same warm-tint pill the rest of the nav uses for "you are here".
function CreateButton() {
  const pathname = usePathname()
  const active = pathname === '/create' || (pathname?.startsWith('/create/') ?? false)
  return (
    <Link
      href="/create"
      aria-label="Create"
      aria-current={active ? 'page' : undefined}
      data-tip="Create"
      // max-sm:hidden — authoring is a desk activity; nobody writes a SKILL.md on
      // a phone, and the glyph was costing a tray slot on the width that has the
      // least of it. It moves into the account menu there.
      className={`nav-tip relative flex h-9 w-9 items-center justify-center rounded-full transition-colors max-sm:hidden ${active ? 'bg-(--accent-bg) text-(--ink)' : 'text-(--ink-2) hover:bg-(--accent-bg) hover:text-(--ink)'}`}
    >
      <Plus className="text-xl" />
    </Link>
  )
}

/** Open book — Docs, in the tray glyph and in the menu row. */
export function DocsGlyph({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M2 3.5h6a3 3 0 0 1 3 3V20a2.5 2.5 0 0 0-2.5-2.5H2z" />
      <path d="M22 3.5h-6a3 3 0 0 0-3 3V20a2.5 2.5 0 0 1 2.5-2.5H22z" />
    </svg>
  )
}

/** Compass — Browse. Deliberately not a magnifier: search is its own control two
 *  slots away, and the two would read as the same door. */
export function BrowseGlyph({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5-5 2 2-5z" />
    </svg>
  )
}

// Utility — muted, sits with the other tray icons. Routes to the docs; the active
// page gets the same warm-tint pill + full-ink icon as the other nav targets.
function HelpLink({ className = '' }: { className?: string }) {
  const pathname = usePathname()
  const active = pathname === '/docs' || (pathname?.startsWith('/docs/') ?? false)
  return (
    <Link
      href="/docs"
      aria-label="Docs"
      aria-current={active ? 'page' : undefined}
      data-tip="Docs"
      className={`nav-tip relative h-9 w-9 items-center justify-center rounded-full transition-colors ${active ? 'bg-(--accent-bg) text-(--ink)' : 'text-(--ink-2) hover:bg-(--accent-bg) hover:text-(--ink)'} ${className || 'flex'}`}
    >
      <DocsGlyph />
    </Link>
  )
}

export function SiteAuthNav() {
  const { data: session, status } = useSession()
  const [profileAvatarUrl, setProfileAvatarUrl] = useState<string | null>(null)
  const handle = session?.handle ?? null

  // The avatar comes from the session (auth.ts seeds it with the registry avatar),
  // so there's no fetch on mount and no flash. We only listen for in-session profile
  // edits to reflect a new avatar immediately, before the session round-trip.
  useEffect(() => {
    if (!handle) {
      setProfileAvatarUrl(null)
      return
    }
    function onProfileUpdated(event: Event) {
      const detail = (event as ProfileUpdatedEvent).detail
      if (detail?.handle === handle) setProfileAvatarUrl(detail.avatarUrl ?? null)
    }
    window.addEventListener(SKILLET_EVENTS.profileUpdated, onProfileUpdated)
    return () => window.removeEventListener(SKILLET_EVENTS.profileUpdated, onProfileUpdated)
  }, [handle])

  if (status === 'loading') {
    return (
      <span className="text-sm text-(--ink-2)/60" aria-hidden>
        ···
      </span>
    )
  }

  if (session?.user) {
    const email = session.user.email ?? null
    const name = session.user.name?.trim() || handle || 'Account'
    const avatarUrl = profileAvatarUrl ?? session.user.image ?? null
    const profileHref = handle ? `/${handle}` : '/settings'
    return (
      <span className="inline-flex items-center gap-1">
        <CreateButton />
        {/* Docs is secondary — below sm it lives in the phone menu, so the authed
            tray (search, create, bell, avatar) fits small-phone widths. */}
        <HelpLink className="hidden sm:flex" />
        <AttentionToast />
        <NotificationBell />
        <AccountMenu
          profileHref={profileHref}
          avatarUrl={avatarUrl}
          name={name}
          handle={handle}
          email={email}
          colorKey={handle ?? name}
        />
      </span>
    )
  }

  return (
    <div className="flex items-center gap-2">
      {/* Below sm, Docs and Log in both live in the phone menu — the header keeps
          exactly one filled control (Join) instead of asking a stranger to weigh
          three. `max-sm:` (not `hidden sm:flex`) because these variants carry
          their own display, and only a media-query variant reliably beats it.
          Join is bumped to the 36px tray target there so search, Join, and the
          menu button share one height. */}
      <HelpLink className="hidden sm:flex" />
      <Button href="/login" variant="tertiary" size="sm" className="px-2 max-sm:hidden">
        Log in
      </Button>
      <Button
        href="/login?mode=signup"
        variant="primary"
        size="sm"
        className="text-sm max-sm:h-9"
      >
        Join
      </Button>
    </div>
  )
}

// The avatar dropdown. Hover devices open it on hover (and keyboard focus), and
// clicking the avatar still navigates to the profile. Touch devices have no
// hover, so a tap opens the menu instead — the Profile item then navigates.
// Theme lives here (its only home) rather than in a settings section.
function AccountMenu({
  profileHref,
  avatarUrl,
  name,
  handle,
  email,
  colorKey,
}: {
  profileHref: string
  avatarUrl: string | null
  name: string
  handle: string | null
  email: string | null
  colorKey: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  // Default to hover for SSR/desktop; corrected on mount for touch devices.
  const [hoverable, setHoverable] = useState(true)
  // Teams the viewer belongs to — quick links to each team's profile. Fetched
  // lazily each time the menu opens so the nav stays light for everyone (no fetch
  // for users who never open it) while a team created this session still shows up
  // without a reload. Only a successful response overwrites the list, so a
  // transient error never blanks a team you already saw.
  const [teams, setTeams] = useState<MyOrgEntry[]>([])

  useEffect(() => {
    setHoverable(window.matchMedia('(hover: hover)').matches)
  }, [])

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    void registryGetJson<{ orgs?: MyOrgEntry[] }>('orgs', { signal: controller.signal }).then(
      (data) => {
        if (data) setTeams(data.orgs ?? [])
      },
    )
    return () => controller.abort()
  }, [open])

  // Tap/click outside and Escape close the menu (the hover path also closes on
  // mouse-leave; this covers touch and keyboard).
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

  return (
    <div
      ref={ref}
      className="relative ml-1 inline-flex items-center"
      onMouseEnter={() => hoverable && setOpen(true)}
      onMouseLeave={() => hoverable && setOpen(false)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false)
      }}
    >
      <Link
        href={profileHref}
        className="site-account-avatar flex"
        aria-label="Your account"
        aria-haspopup="menu"
        aria-expanded={open}
        onFocus={() => hoverable && setOpen(true)}
        onClick={(e) => {
          // Touch: tap opens the menu rather than navigating. Hover/mouse: let
          // the click through to the profile (the menu is already open on hover).
          if (!hoverable) {
            e.preventDefault()
            setOpen((o) => !o)
          }
        }}
      >
        <Avatar src={avatarUrl} name={name} colorKey={colorKey} className="h-full w-full" />
      </Link>
      {/* pt-2 is a transparent bridge so the pointer can cross from the avatar to
          the panel without leaving the container (which would close the menu). */}
      <div
        className={`absolute right-0 top-full z-50 pt-2 transition-opacity duration-150 ${
          open ? 'visible opacity-100' : 'invisible opacity-0'
        }`}
      >
        <div className="w-52 surface-card p-1.5 shadow-(--shadow-lg)">
          {/* Profile bar — avatar + name/handle, links to the profile. */}
          <Link
            href={profileHref}
            className="flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-(--accent-bg)"
          >
            <Avatar
              src={avatarUrl}
              name={name}
              colorKey={colorKey}
              size="md"
              className="h-9 w-9 shrink-0"
            />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-(--ink)">{name}</span>
              <span className="block truncate text-xs text-(--ink-2)">
                {handle ? `@${handle}` : email}
              </span>
            </span>
          </Link>
          {/* Phone only: the nav links the header has no room for. The
              hamburger that used to carry them is signed-out-only now — with an
              avatar menu already in the tray, a second menu beside it split
              "where can I go" across both. Gone from sm up, where the inline
              Browse link and the Docs glyph come back. */}
          <div className="sm:hidden">
            <div className="-mx-1.5 my-1 border-t border-(--line)" />
            {/* Create leads the group — it is the one verb among destinations,
                and it is the tray glyph this menu absorbed. Not in NAV_LINKS:
                that list is also the signed-out hamburger's, where there is
                nothing to create until you have an account. */}
            <Link
              href="/create"
              className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm text-(--ink) transition-colors hover:bg-(--accent-bg)"
            >
              <span className="flex w-9 shrink-0 justify-center text-(--ink-2)">
                <Plus className="h-4 w-4" />
              </span>
              Create
            </Link>
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm text-(--ink) transition-colors hover:bg-(--accent-bg)"
              >
                <span className="flex w-9 shrink-0 justify-center text-(--ink-2)">{link.icon}</span>
                {link.label}
              </Link>
            ))}
            <div className="-mx-1.5 my-1 border-t border-(--line)" />
          </div>
          <Link
            href="/settings"
            className="mt-0.5 flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-(--ink) transition-colors hover:bg-(--accent-bg)"
          >
            <span className="flex w-9 shrink-0 justify-center text-(--ink-2)">
              <Sliders className="h-4 w-4" />
            </span>
            Settings
          </Link>
          {/* Teams you belong to — each links to that team's profile. Hidden when
              you're on no teams, so the default menu is unchanged. */}
          {teams.length > 0 && (
            <>
              <div className="-mx-1.5 my-1 border-t border-(--line)" />
              <p className="px-2 pb-0.5 pt-1 text-xs font-semibold uppercase tracking-[0.06em] text-(--ink-2)">
                Teams
              </p>
              {teams.map((team) => (
                <Link
                  key={team.slug}
                  href={`/${team.slug}`}
                  className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-(--ink) transition-colors hover:bg-(--accent-bg)"
                >
                  <span className="flex w-9 shrink-0 justify-center">
                    <Avatar
                      src={null}
                      name={team.name}
                      colorKey={team.slug}
                      kind="team"
                      size="xs"
                      className="h-6 w-6"
                    />
                  </span>
                  <span className="min-w-0 truncate">{team.name}</span>
                </Link>
              ))}
            </>
          )}
          <div className="-mx-1.5 my-1 border-t border-(--line)" />
          {/* Footer row: appearance controls on the left (first icon shares the
              avatar/Settings column), Sign out on the right. */}
          <div className="flex items-center justify-between gap-2 py-0.5 pl-3 pr-0.5">
            <ThemeToggle />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void signOutFromWeb('/')}
            >
              Sign out
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
