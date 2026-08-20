'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { signOutFromWeb } from '@/lib/sign-out-action'
import { useEffect, useRef, useState } from 'react'
import { SKILLET_EVENTS } from '@/lib/events'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Plus, Sliders } from '@/components/ui/icons'
import { ThemeToggle } from '@/components/theme-toggle'
import { NotificationBell } from '@/components/notifications/notification-bell'
import { AttentionToast } from '@/components/notifications/attention-toast'
import { registryGetJson } from '@/lib/registry-proxy'
import type { MyOrgEntry } from '@/lib/orgs'

interface ProfileUpdatedEvent extends Event {
  detail?: {
    handle?: string
    avatarUrl?: string
  }
}

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
      className={`nav-tip relative flex h-9 w-9 items-center justify-center rounded-full transition-colors ${active ? 'bg-(--accent-bg) text-(--ink)' : 'text-(--ink-2) hover:bg-(--accent-bg) hover:text-(--ink)'}`}
    >
      <Plus className="text-xl" />
    </Link>
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
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
        aria-hidden="true"
      >
        <path d="M2 3.5h6a3 3 0 0 1 3 3V20a2.5 2.5 0 0 0-2.5-2.5H2z" />
        <path d="M22 3.5h-6a3 3 0 0 0-3 3V20a2.5 2.5 0 0 1 2.5-2.5H22z" />
      </svg>
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
        {/* Docs is secondary — hidden below sm so the authed tray (search, create,
            bell, avatar) plus the inline Browse link fit small-phone widths. */}
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
      <HelpLink />
      <Button href="/login" variant="tertiary" size="sm" className="px-2">
        Log in
      </Button>
      <Button href="/login?mode=signup" variant="primary" size="sm" className="text-sm">
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
