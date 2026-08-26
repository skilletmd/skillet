'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { type ReactNode } from 'react'
import { TabBar, Tab } from '@/components/ui/tabs'
import { useUnreadNotifications } from '@/components/notifications/use-unread-notifications'
import { CountBadge } from '@/components/ui/count-badge'
import { feedHref, feedGlobalHref, feedNotificationsHref, feedUpdatesHref } from '@/lib/urls'
import { parseLens, parseFeedSection, feedPathState } from './feed-lens'
import { NewsToggle } from './news-toggle'

type FeedTeam = { slug: string; name: string }

const sectionRowClass = (active: boolean) =>
  `flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
    active
      ? 'bg-(--accent-bg) font-medium text-(--accent)'
      : 'text-(--ink-2) hover:bg-(--surface) hover:text-(--ink)'
  }`

// The mobile feed bar mirrors the /browse + /lab SectionNav tab treatment
// exactly — same `text-sm` size, same underlined active state — so the two
// surfaces read as one design. (The desktop center lens row keeps the larger
// `.feed-tab` style; only the mobile bar matches browse.)
const barTabClass = (active: boolean) =>
  `shrink-0 whitespace-nowrap border-b-2 px-3 py-3 text-sm transition-colors ${
    active
      ? 'border-(--ink) font-semibold text-(--ink)'
      : 'border-transparent text-(--ink-2) hover:text-(--ink)'
  }`

/**
 * Left-rail section nav for the unified Feed: Feed (activity) / Notifications /
 * Updates. Notifications is always shown when authed; Updates appears only when
 * the pending queue count is greater than zero.
 * Lives in the activity left rail; reads the pathname for active state.
 *
 * Auth comes from the client session (seeded by the root layout's SessionProvider,
 * so it's known on first render) — that lets the nav render as text immediately
 * without waiting on any server fetch. Authed-only (Notifications/Updates are
 * viewer-specific); logged-out viewers get the sign-in card instead.
 */
export function FeedSectionNav() {
  const pathname = usePathname()
  const section = parseFeedSection(pathname)
  const { social, updates } = useUnreadNotifications()
  const isAuthed = useSession().status === 'authenticated'
  // Notifications/Updates are viewer-specific, so the section nav is authed-only.
  // Logged-out visitors get the sign-in card instead (see ActivityLeftRail).
  if (!isAuthed) return null
  return (
    <nav aria-label="Feed sections" className="flex flex-col gap-0.5">
      <Link href={feedHref()} aria-current={section === 'activity' ? 'page' : undefined} className={sectionRowClass(section === 'activity')}>
        Feed
      </Link>
      <Link
        href={feedNotificationsHref()}
        aria-current={section === 'notifications' ? 'page' : undefined}
        className={sectionRowClass(section === 'notifications')}
      >
        <span>Notifications</span>
        {social > 0 && <CountBadge value={social} />}
      </Link>
      <Link
        href={feedUpdatesHref()}
        aria-current={section === 'updates' ? 'page' : undefined}
        className={sectionRowClass(section === 'updates')}
      >
        <span>Updates</span>
        {updates > 0 && <CountBadge value={updates} />}
      </Link>
    </nav>
  )
}

/**
 * Feed controls, responsive.
 *
 * Desktop keeps the two axes separate by orientation — sections (Feed /
 * Notifications / Updates) in the left rail, lenses (For you / Global / teams)
 * + type filter here in the center, on the activity section only.
 *
 * On mobile the rail is gone, so both axes can't stay separate without stacking
 * two underline bars (redundant). Instead they collapse into ONE flush, full-
 * bleed bar — For you · Global · teams · Notifications · Updates — that sits
 * directly under the global header (negative margins cancel the activity shell's
 * top/side padding) and reaches every section from anywhere. The type filter
 * rides the right of that bar on the activity section.
 */
export function FeedControls({
  teamTabsMobile,
  teamTabsDesktop,
}: {
  teamTabsMobile?: ReactNode
  teamTabsDesktop?: ReactNode
}) {
  const section = parseFeedSection(usePathname())
  return (
    <>
      <FeedMobileBar teamTabs={teamTabsMobile} />
      {section === 'activity' && (
        <div className="mt-2 mb-6 hidden flex-wrap items-center gap-x-3 border-b border-(--line) md:flex">
          <FeedTabs teamTabs={teamTabsDesktop} />
          {/* Right of the lenses, because it is not a lens: it says what goes in
              whichever one you are on. */}
          <NewsToggle />
        </div>
      )}
    </>
  )
}

/**
 * MOBILE feed bar (`md:hidden`). One flush, full-bleed bar carrying both axes —
 * lenses (For you / Global / teams) and sections (Notifications / Updates) — in a
 * single horizontally-scrollable row, type filter pinned right on the activity
 * section. Styled to match the /browse + /lab bar exactly: a white `--surface`
 * band with `text-sm` underlined tabs. The negative margins cancel the activity
 * `<main>`'s `px-[clamp(16px,4vw,32px)]` and `pt-2 sm:pt-4` so the band runs
 * edge-to-edge and butts against the global header. Sections (and "For you") need
 * a session; logged-out viewers get lens-only.
 */
export function FeedMobileBar({ teamTabs }: { teamTabs?: ReactNode }) {
  const pathname = usePathname()
  const section = parseFeedSection(pathname)
  const { lens } = feedPathState(pathname)
  const { social, updates } = useUnreadNotifications()
  const isAuthed = useSession().status === 'authenticated'
  const view = parseLens(lens, isAuthed)
  const onActivity = section === 'activity'
  return (
    <div className="-mx-[clamp(16px,4vw,32px)] -mt-2 mb-6 border-b border-(--line) bg-(--surface) sm:-mt-4 md:hidden">
      {/* px-3 (not the shell's clamp inset) so the first tab's left padding lands
          at the same 24px as the /browse + /lab bar — they read as one bar. */}
      <div className="flex items-center gap-3 px-3">
        <nav
          aria-label="Feed"
          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {isAuthed && (
            <Link
              href={feedHref()}
              aria-current={onActivity && view === 'following' ? 'page' : undefined}
              className={barTabClass(onActivity && view === 'following')}
            >
              For you
            </Link>
          )}
          <Link
            href={feedGlobalHref()}
            aria-current={onActivity && view === 'discover' ? 'page' : undefined}
            className={barTabClass(onActivity && view === 'discover')}
          >
            Global
          </Link>
          {teamTabs}
          {isAuthed && (
            <Link
              href={feedNotificationsHref()}
              aria-current={section === 'notifications' ? 'page' : undefined}
              className={`${barTabClass(section === 'notifications')} inline-flex items-center gap-2`}
            >
              Notifications
              {social > 0 && <CountBadge value={social} className="" />}
            </Link>
          )}
          {isAuthed && (
            <Link
              href={feedUpdatesHref()}
              aria-current={section === 'updates' ? 'page' : undefined}
              className={`${barTabClass(section === 'updates')} inline-flex items-center gap-2`}
            >
              Updates
              {updates > 0 && <CountBadge value={updates} className="" />}
            </Link>
          )}
        </nav>
        <NewsToggle />
      </div>
    </div>
  )
}

/**
 * Feed lens tabs — For you / Global up front, team lenses appended via `teamTabs`.
 * The center-column switcher across all breakpoints. Auth comes from the known
 * client session, so For you / Global paint immediately with no data wait; the
 * team tabs stream in. Reads the pathname for active state.
 */
export function FeedTabs({ teamTabs }: { teamTabs?: ReactNode }) {
  const { lens } = feedPathState(usePathname())
  const isAuthed = useSession().status === 'authenticated'
  const view = parseLens(lens, isAuthed)
  return (
    <TabBar aria-label="Feed" className="!mb-0 !border-b-0 !pt-0">
      {isAuthed && (
        <Tab href={feedHref()} active={view === 'following'}>
          For you
        </Tab>
      )}
      <Tab href={feedGlobalHref()} active={view === 'discover'}>
        Global
      </Tab>
      {teamTabs}
    </TabBar>
  )
}

/** The team lens tabs, appended after Global. Split out so the orgs fetch that
 *  feeds them streams in without blocking For you / Global. `variant` keeps the
 *  desktop center row on the `.feed-tab` style while the mobile bar matches the
 *  browse `text-sm` underlined tab. */
export function FeedTeamTabs({
  teams,
  variant = 'desktop',
}: {
  teams: FeedTeam[]
  variant?: 'desktop' | 'mobile'
}) {
  const { lens, teamSlug } = feedPathState(usePathname())
  const isAuthed = useSession().status === 'authenticated'
  const view = parseLens(lens, isAuthed)
  return (
    <>
      {teams.map((t) => {
        const active = view === 'team' && teamSlug === t.slug
        const href = `/feed/team/${encodeURIComponent(t.slug)}`
        return variant === 'mobile' ? (
          <Link
            key={t.slug}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={barTabClass(active)}
          >
            {t.name}
          </Link>
        ) : (
          <Tab key={t.slug} href={href} active={active}>
            {t.name}
          </Tab>
        )
      })}
    </>
  )
}
