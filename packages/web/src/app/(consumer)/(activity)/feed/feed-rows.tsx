'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { NetworkIcon, NETWORK_NAME } from '@/components/network-icon'
import { PendingSkillAttachment } from '@/components/pending-skill-card'
import type {
  FeedEvent,
  FeedSignalEvent,
  FeedStoryEvent,
  FeedSkillEvent,
  FeedSubscribeEvent,
} from '@/lib/registry'
import { SkillCard } from '@/components/skill-card'
import { SkillIcon } from '@/components/directory-card'
import { Avatar } from '@/components/ui/avatar'
import { KitCard } from '@/components/kit-card'
import { SubscribeKitButton } from '@/components/kits/subscribe-kit-button'
import { EntityHoverCard } from '@/components/entity-hover-card'
import { FeedAvatar } from '@/components/discovery-rail'
import { ActorHoverName } from '@/components/person-hover-card'
import { Button } from '@/components/ui/button'
import {
  PersonDirectoryCard,
  minimalPerson,
} from '@/app/(consumer)/skills/person-directory-card'
import { timeAgo } from '@/lib/feed-format'
import type { FeedSurfaceView } from './feed-lens'
import { feedEventKey, mergeFeedHead } from './feed-head-merge'
import { storyKicker } from '@/lib/story-kind.mjs'

const HEAD_POLL_MS = 30_000

function SkillEventRow({ event, isAuthed }: { event: FeedSkillEvent; isAuthed: boolean }) {
  const verb = event.type === 'updated' ? 'updated a skill' : 'published a skill'
  return (
    <li className="feed-item">
      <FeedAvatar handle={event.actor} avatarUrl={event.actorAvatarUrl} className="feed-avatar" />
      <div className="min-w-0 flex-1">
        <p className="feed-line">
          <ActorHoverName handle={event.actor} avatarUrl={event.actorAvatarUrl} isAuthed={isAuthed} />
          <span className="feed-verb"> {verb}</span>
          <span className="feed-sep" aria-hidden="true">
            ·
          </span>
          <time className="feed-time" dateTime={new Date(event.at * 1000).toISOString()}>
            {timeAgo(event.at)}
          </time>
        </p>
        <div className="mt-2">
          <SkillCard
            author={event.skill.author}
            slug={event.skill.slug}
            description={event.skill.description}
            category={event.skill.category}
            installCount={event.skill.installs}
            // The row already carries the actor's avatar; on a publish/update
            // the actor is the author, so the card byline can reuse it instead
            // of falling back to the drawn default face.
            makerAvatarUrl={event.actor === event.skill.author ? event.actorAvatarUrl : null}
          />
        </div>
      </div>
    </li>
  )
}

function compactCount(n: number | null): string | null {
  if (!n) return null
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return String(n)
}

/** Engagement in each network's own words. Flattening HN points into "likes"
 *  reads as a mistake to anyone who uses either site. */
function signalScore(event: FeedSignalEvent): string | null {
  const n = compactCount(event.score)
  if (!n) return null
  if (event.network === 'hn') return `${n} points`
  if (event.network === 'reddit') return `${n} upvotes`
  return `${n} likes`
}

/**
 * Quoted text, trimmed to length but not to one line.
 *
 * Link furniture goes — a trailing `https://t.co/…` means nothing to a reader
 * and the card already links the post — but line breaks stay. The posts most
 * worth quoting are often structured (a decision tree, a checklist), and
 * flattening them to a paragraph destroys the thing that made them readable.
 * The card renders with `whitespace-pre-line` to honour what survives here.
 */
function readableQuote(text: string, max = 320): string {
  const stripped = text
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[^\S\n]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (stripped.length <= max) return stripped
  const cut = stripped.lastIndexOf(' ', max)
  return `${stripped.slice(0, cut > 0 ? cut : max)}…`
}

/**
 * The attachment strip inside a post card: what the post points at.
 *
 * Lives INSIDE the quote's border rather than as a block beneath it. Two stacked
 * surfaces read as two objects and, on a warm ground, as a brown smear; one card
 * with a hairline divider reads as a quote with an unfurl, which is what it is.
 */
function SignalAttachment({ event }: { event: FeedSignalEvent }) {
  if (event.skills.length > 0) {
    return (
      <div className="divide-y divide-(--line) border-t border-(--line)">
        {event.skills.map((sk) => (
          <Link
            key={`${sk.author}/${sk.slug}`}
            href={`/${sk.author}/${sk.slug}`}
            className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-(--accent-bg)"
          >
            <span className="relative h-8 w-8 shrink-0">
              <SkillIcon seed={`${sk.author}/${sk.slug}`} radius="rounded-lg" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold group-hover:text-(--accent)">
                {sk.slug}
              </span>
              <span className="block truncate font-mono text-2xs text-(--ink-2)">
                @{sk.author}
              </span>
            </span>
            <span className="shrink-0 font-mono text-2xs text-(--ink-2)">in the registry</span>
          </Link>
        ))}
      </div>
    )
  }

  const collections = event.collections?.length
    ? event.collections
    : event.collection
      ? [event.collection]
      : []

  if (collections.length > 1) {
    // A roundup. Naming one library from a post that listed forty is both a
    // miss and an arbitrary pick, so the strip says what the post is and lists
    // the ones we actually carry.
    const carried = collections.reduce((n, c) => n + c.count, 0)
    return (
      <div className="border-t border-(--line)">
        <p className="px-4 pt-3 font-mono text-2xs tracking-[0.08em] uppercase text-(--ink-2)">
          {event.repoCount ? `${event.repoCount} repos mentioned · ` : ''}
          {collections.length} in the registry, {carried} skills
        </p>
        <div className="flex flex-wrap gap-1.5 px-4 pt-2 pb-3">
          {collections.slice(0, 8).map((c) => (
            <Link
              key={c.repo ?? c.author}
              href={`/${c.author}`}
              className="rounded-pill border border-(--line) bg-(--card-soft) px-2.5 py-1 font-mono text-2xs hover:border-(--ink-2)"
            >
              @{c.repoOwner ?? c.author}
              <span className="text-(--ink-2)"> · {c.count}</span>
            </Link>
          ))}
          {collections.length > 8 ? (
            <span className="self-center font-mono text-2xs text-(--ink-2)">
              +{collections.length - 8} more
            </span>
          ) : null}
        </div>
      </div>
    )
  }

  if (collections.length === 1) {
    const only = collections[0]!
    const owner = only.repoOwner ?? only.author
    return (
      <Link
        href={`/${only.author}`}
        className="group flex items-center gap-3 border-t border-(--line) px-4 py-3 transition-colors hover:bg-(--accent-bg)"
      >
        <Avatar src={null} name={owner} colorKey={owner} size="xs" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold group-hover:text-(--accent)">
            @{owner}
          </span>
          <span className="block truncate font-mono text-2xs text-(--ink-2)">
            {only.count} skills in the registry
          </span>
        </span>
      </Link>
    )
  }

  if (event.unknownSkill) {
    return (
      <PendingSkillAttachment
        slug={event.unknownSkill}
        network={event.network}
        spottedBy={event.actor}
        repo={event.repo ?? null}
      />
    )
  }

  return null
}

/**
 * Age, pushed to the right edge of a byline.
 *
 * Renders nothing when the timestamp is missing. Several sources give no usable
 * date, and "just now" on a post from last week is worse than no date at all —
 * a wrong timestamp quietly discredits everything around it.
 */
function RelativeTime({ at }: { at: number }) {
  if (!at) return null
  return (
    <time
      className="feed-time ml-auto shrink-0 tabular-nums"
      dateTime={new Date(at * 1000).toISOString()}
    >
      {timeAgo(at)}
    </time>
  )
}

/**
 * A written story with the posts it was drawn from listed underneath.
 *
 * The sources block is the point. A summary of what people are saying, with no
 * way to check it, is the thing this feed exists to be better than; a summary
 * with five named posts under it is reporting. Sources stay visible rather than
 * collapsing behind a "show sources" toggle for the same reason.
 */
function StoryEventRow({ event }: { event: FeedStoryEvent }) {
  return (
    <li className="feed-item">
      <span className="feed-avatar grid shrink-0 place-items-center overflow-hidden rounded-full border border-(--line) bg-(--card-soft)">
        {/* The mascot, masked so it takes the ink colour and stays legible in
            both themes rather than shipping a light-mode-only raster. */}
        <span
          aria-hidden="true"
          className="h-6 w-6 bg-(--ink)"
          style={{
            maskImage: 'url(/brand/skillet-mascot-logo.svg)',
            WebkitMaskImage: 'url(/brand/skillet-mascot-logo.svg)',
            maskSize: 'contain',
            WebkitMaskSize: 'contain',
            maskRepeat: 'no-repeat',
            WebkitMaskRepeat: 'no-repeat',
            maskPosition: 'center',
            WebkitMaskPosition: 'center',
          }}
        />
      </span>
      <div className="min-w-0 flex-1">
        <p className="feed-line flex items-baseline gap-1.5">
          <span className="font-semibold">Skillet Daily</span>
          {/* A pill, not a word in the byline: this is the one label that says
              which of the two things the card is, and it has to be findable
              while scrolling rather than read. */}
          <span className="rounded-pill border border-(--line) bg-(--card-soft) px-2 py-0.5 font-mono text-2xs font-medium tracking-[0.08em] uppercase text-(--ink-2)">
            {storyKicker(event.storyKind)}
          </span>
          <RelativeTime at={event.at} />
        </p>

        <div className="mt-2 overflow-hidden rounded-xl border border-(--line) bg-(--surface)">
          {/* The headline is the permalink. A story nobody can link to is a
              story nobody forwards, which is the whole point of writing one. */}
          <Link href={`/news/${event.id}`} className="group block px-4 pt-4 pb-3">
            <h3 className="text-base leading-snug font-semibold tracking-tight text-pretty text-(--ink) group-hover:text-(--accent)">
              {event.headline}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-(--ink-2)">{event.summary}</p>
          </Link>

          <div className="px-4 pb-4">
            <p className="font-mono text-2xs tracking-[0.08em] uppercase text-(--ink-2)">
              {event.sources.length} {event.sources.length === 1 ? 'source' : 'sources'}
            </p>
            <ul className="pt-1">
              {event.sources.map((src) => (
                <li key={src.url}>
                  <a
                    href={src.url}
                    className="group flex items-center gap-2 py-1.5 text-xs hover:text-(--accent)"
                  >
                    {/* Face only. A network badge pinned to a 20px avatar
                        never sat cleanly on the circle, and the mark reads
                        better as its own column on the right. */}
                    <Avatar
                      src={src.avatarUrl ?? null}
                      name={src.label || src.handle}
                      colorKey={src.handle}
                      size="xxs"
                    />
                    <span className="truncate font-medium">@{src.handle}</span>
                    <span className="truncate text-(--ink-2)">{src.label}</span>
                    <span className="ml-auto flex shrink-0 items-center gap-2">
                      {src.detail ? (
                        <span className="font-mono text-2xs whitespace-nowrap text-(--ink-2)">
                          {src.detail}
                        </span>
                      ) : null}
                      <span className="text-(--ink-2)">
                        {src.network === 'web' ? (
                          <span
                            aria-hidden="true"
                            className="grid h-3.5 w-3.5 place-items-center rounded-sm border border-(--line) font-mono text-2xs"
                          >
                            W
                          </span>
                        ) : (
                          <NetworkIcon network={src.network} />
                        )}
                      </span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* A skills card that describes a skill and offers no way to get it
              is a dead end: the reader we just convinced has nowhere to go.
              The only division on the card, because it is the only thing on it
              that is an action rather than reading. */}
          {event.subject?.slug || event.subject?.repo ? (
            <PendingSkillAttachment
              slug={event.subject.slug ?? event.subject.repo!.split('/')[1]!}
              // No "via @handle on X": the sources sit directly above in the
              // same card, so this row spends its one line on the repo instead.
              repo={event.subject.repo}
              category={event.subject.category}
              name={event.subject.name}
            />
          ) : null}
        </div>
      </div>
    </li>
  )
}


/**
 * Two row shapes, chosen by whether the post resolved to something we carry.
 *
 * Resolved: the skill leads and the quote becomes the reason it is here. That is
 * a discovery item, and it matches the shape of every other feed row where a
 * small actor line sits above a card.
 *
 * Unresolved: the quote leads, because it IS the item. Most posts are like this
 * today (61% name no skill at all), and featuring an empty card above them would
 * be a worse feed, not a more consistent one.
 */
function SignalEventRow({ event }: { event: FeedSignalEvent }) {
  const score = signalScore(event)

  const byline = (
    <p className="feed-line flex items-baseline gap-1.5">
      <span className="font-semibold">{event.actorName ?? event.actor}</span>
      <span className="ml-1.5 inline-flex translate-y-[2px] text-(--ink-2)">
        <NetworkIcon network={event.network} />
      </span>
      <span className="sr-only">on {NETWORK_NAME[event.network]}</span>
      {event.context ? (
        <>
          <span className="feed-sep" aria-hidden="true">
            ·
          </span>
          <span className="feed-verb">{event.context}</span>
        </>
      ) : null}
      {score ? (
        <>
          <span className="feed-sep" aria-hidden="true">
            ·
          </span>
          <span className="feed-time">{score}</span>
        </>
      ) : null}
      <RelativeTime at={event.at} />
    </p>
  )

  return (
    <li className="feed-item">
      <FeedAvatar handle={event.actor} avatarUrl={event.actorAvatarUrl} className="feed-avatar" />
      <div className="min-w-0 flex-1">
        {byline}
        {/* One shape, always. Leading with the skill when we happened to
            resolve it and with the quote when we did not made placement encode
            our own match state — invisible to a reader, and inconsistent for no
            reason they can see. The quote is why the item is in the feed;
            whatever it points at is the payoff underneath. */}
        <div className="mt-2 overflow-hidden rounded-xl border border-(--line) bg-(--surface)">
          <a
            href={event.url}
            className="block p-4 text-sm leading-normal whitespace-pre-line hover:underline"
          >
            “{readableQuote(event.text)}”
          </a>
          <SignalAttachment event={event} />
        </div>
      </div>
    </li>
  )
}


/** A kit's full md discovery card (cover, description, Used-by, Add) — shown
 *  inline for a small add and as the hover preview behind a chip. */
function KitDiscoveryCard({
  target,
  viewerHandle,
}: {
  target: FeedSubscribeEvent['target']
  viewerHandle: string | null
}) {
  return (
    <KitCard
      size="md"
      kitId={target.kitId}
      href={target.href}
      name={target.name}
      owner={target.owner}
      makerAvatarUrl={target.ownerAvatarUrl}
      skillCount={target.skillCount}
      skillCategories={target.skillCategories ?? []}
      subscriberCount={target.subscriberCount}
      description={target.description}
      action={
        target.kitId ? (
          <SubscribeKitButton
            kitId={target.kitId}
            owner={target.owner}
            viewerHandle={viewerHandle}
            initialSubscribed={false}
          />
        ) : undefined
      }
    />
  )
}

/**
 * Adds from one actor. Tier-2, signal-weighted: a person you follow adopting a
 * kit is strong discovery, so a small add (1–2 kits) renders as a full card —
 * the Add works inline, including on mobile. Larger bursts compress to chips
 * (still hover-expandable). Author-skill adds stay chips at any count.
 */
function GroupedSubscribeRow({
  subKind,
  events,
  isAuthed,
  viewerHandle,
}: {
  subKind: 'kit' | 'author'
  events: FeedSubscribeEvent[]
  isAuthed: boolean
  viewerHandle: string | null
}) {
  const isKit = subKind === 'kit'
  const asCards = isKit && events.length <= 2
  const shown = events.slice(0, isKit ? 6 : 8)
  return (
    <li className={`feed-item ${asCards ? '' : 'feed-item--slim !items-start'}`}>
      <FeedAvatar
        handle={events[0].actor}
        avatarUrl={events[0].actorAvatarUrl}
        className={asCards ? 'feed-avatar' : 'feed-avatar feed-avatar--sm'}
      />
      <div className="min-w-0 flex-1">
        <p className={asCards ? 'feed-line' : 'feed-line feed-line--slim'}>
          <ActorHoverName
            handle={events[0].actor}
            avatarUrl={events[0].actorAvatarUrl}
            isAuthed={isAuthed}
          />
          <span className="feed-verb">
            {isKit
              ? events.length === 1
                ? ' added a kit'
                : ` added ${events.length} kits`
              : events.length === 1
                ? ` added @${events[0].target.owner}'s skills`
                : ` added skills from ${events.length} people`}
          </span>
          <span className="feed-sep" aria-hidden="true">
            ·
          </span>
          <time className="feed-time" dateTime={new Date(events[0].at * 1000).toISOString()}>
            {timeAgo(events[0].at)}
          </time>
        </p>
        {asCards ? (
          <div className="mt-2 flex flex-col gap-2.5">
            {events.map((e) => (
              <KitDiscoveryCard key={e.target.href} target={e.target} viewerHandle={viewerHandle} />
            ))}
          </div>
        ) : (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {shown.map((e) =>
              isKit ? (
                e.target.kitId ? (
                  <EntityHoverCard
                    key={e.target.href}
                    content={<KitDiscoveryCard target={e.target} viewerHandle={viewerHandle} />}
                  >
                    <KitCard
                      size="xs"
                      kitId={e.target.kitId}
                      href={e.target.href}
                      name={e.target.name}
                      owner={e.target.owner}
                      makerAvatarUrl={e.target.ownerAvatarUrl}
                      skillCount={e.target.skillCount}
                      skillCategories={e.target.skillCategories ?? []}
                    />
                  </EntityHoverCard>
                ) : (
                  <KitCard
                    key={e.target.href}
                    size="xs"
                    href={e.target.href}
                    name={e.target.name}
                    owner={e.target.owner}
                    makerAvatarUrl={e.target.ownerAvatarUrl}
                    skillCount={e.target.skillCount}
                    skillCategories={e.target.skillCategories ?? []}
                  />
                )
              ) : (
                <EntityHoverCard
                  key={e.target.href}
                  content={
                    <PersonDirectoryCard
                      person={minimalPerson(e.target.owner, e.target.name, e.target.ownerAvatarUrl)}
                      isAuthed={isAuthed}
                    />
                  }
                >
                  <PersonDirectoryCard
                    size="xs"
                    isAuthed={isAuthed}
                    person={minimalPerson(e.target.owner, e.target.name, e.target.ownerAvatarUrl)}
                  />
                </EntityHoverCard>
              ),
            )}
            {events.length > shown.length && (
              <span className="feed-time">+{events.length - shown.length} more</span>
            )}
          </div>
        )}
      </div>
    </li>
  )
}

// --- Burst grouping -------------------------------------------------------
// One actor subscribing to many kits in a window floods the feed. Collapse
// same-actor, same-kind subscribes into one summary entry. Skills stay
// individual. Grouping is per-page, so a burst spanning a page boundary may
// split — acceptable at a normal page size.
type SubscribeGroup = { type: 'subscribe'; subKind: 'kit' | 'author'; events: FeedSubscribeEvent[] }
type FeedEntry = { type: 'single'; event: FeedEvent } | SubscribeGroup
const GROUP_WINDOW_SECONDS = 24 * 60 * 60

function groupKey(event: FeedEvent): string | null {
  if (event.kind === 'subscribe') return `${event.actor}:subscribe:${event.target.kind}`
  return null
}

function groupFeedEntries(events: FeedEvent[]): FeedEntry[] {
  const entries: FeedEntry[] = []
  const open = new Map<string, SubscribeGroup>()
  for (const event of events) {
    const key = groupKey(event)
    if (!key || event.kind !== 'subscribe') {
      entries.push({ type: 'single', event })
      continue
    }
    const existing = open.get(key)
    const newestAt = existing ? existing.events[0].at : 0
    if (existing && newestAt - event.at <= GROUP_WINDOW_SECONDS) {
      existing.events.push(event)
      continue
    }
    const group: SubscribeGroup = { type: 'subscribe', subKind: event.target.kind, events: [event] }
    open.set(key, group)
    entries.push(group)
  }
  return entries.map((e) =>
    e.type !== 'single' && e.events.length === 1 ? { type: 'single', event: e.events[0] } : e,
  )
}

const eventKey = feedEventKey

function renderFeedEntries(events: FeedEvent[], isAuthed: boolean, viewerHandle: string | null) {
  return groupFeedEntries(events).map((entry) => {
    if (entry.type === 'single') {
      if (entry.event.kind === 'follow') return null
      return (
        <EventRowSingle
          key={eventKey(entry.event)}
          event={entry.event}
          isAuthed={isAuthed}
          viewerHandle={viewerHandle}
        />
      )
    }
    return (
      <GroupedSubscribeRow
        key={eventKey(entry.events[0])}
        subKind={entry.subKind}
        events={entry.events}
        isAuthed={isAuthed}
        viewerHandle={viewerHandle}
      />
    )
  })
}

function EventRowSingle({
  event,
  isAuthed,
  viewerHandle,
}: {
  event: FeedEvent
  isAuthed: boolean
  viewerHandle: string | null
}) {
  if (event.kind === 'follow') return null
  if (event.kind === 'signal') return <SignalEventRow event={event} />
  if (event.kind === 'story') return <StoryEventRow event={event} />
  if (event.kind === 'subscribe')
    return (
      <GroupedSubscribeRow
        subKind={event.target.kind}
        events={[event]}
        isAuthed={isAuthed}
        viewerHandle={viewerHandle}
      />
    )
  return <SkillEventRow event={event} isAuthed={isAuthed} />
}

function restoreKey(view: string, team: string | null, type: string | null) {
  return `feed:${view}:${team ?? ''}:${type ?? ''}`
}

/**
 * The feed list + client-side infinite scroll. The first page is server-fetched
 * and handed in as `initial`; more pages are fetched from the `/api/feed` route
 * handler as plain JSON and accumulated into one list — so grouping spans page
 * boundaries (a kit burst straddling a page stays "added N kits"), paging never
 * triggers a route refresh (scroll is preserved), incoming dupes are filtered,
 * and a return navigation restores the loaded pages + scroll position. A real
 * "Load more" button keeps it keyboard- and screen-reader-reachable.
 */
export function FeedRows({
  initial,
  isAuthed,
  viewerHandle,
  view,
  team,
  type,
  pageSize,
  nextOffset,
}: {
  initial: FeedEvent[]
  isAuthed: boolean
  viewerHandle: string | null
  view: FeedSurfaceView
  team: string | null
  type: string | null
  pageSize: number
  nextOffset: number | null
}) {
  const [events, setEvents] = useState<FeedEvent[]>(initial)
  const [offset, setOffset] = useState<number | null>(nextOffset)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const sentinel = useRef<HTMLDivElement | null>(null)
  const inFlight = useRef(false)
  const seen = useRef(new Set(initial.map(eventKey)))
  const restored = useRef(false)

  // Head poll: prepend new activity while the viewer stays on the feed (mirrors
  // ActivityRail on the homepage). Pauses while the tab is hidden.
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    async function pollHead() {
      if (document.visibilityState !== 'visible') return
      try {
        const params = new URLSearchParams({ view, offset: '0', limit: String(pageSize) })
        if (team) params.set('team', team)
        if (type) params.set('type', type)
        const res = await fetch(`/api/feed?${params.toString()}`, { cache: 'no-store' })
        if (!res.ok || cancelled) return
        const data = (await res.json()) as { events: FeedEvent[] }
        setEvents((prev) => {
          const { merged } = mergeFeedHead(prev, data.events ?? [], seen.current)
          return merged === prev ? prev : merged
        })
      } catch {
        // Network hiccup — try again on the next tick.
      }
    }

    function schedule() {
      timer = setTimeout(async () => {
        await pollHead()
        if (!cancelled) schedule()
      }, HEAD_POLL_MS)
    }
    schedule()

    function onVisible() {
      if (document.visibilityState === 'visible') void pollHead()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [view, team, type, pageSize])

  // Restore loaded pages + scroll position on a return navigation (once).
  useEffect(() => {
    if (restored.current) return
    restored.current = true
    try {
      const raw = sessionStorage.getItem(restoreKey(view, team, type))
      if (!raw) return
      const saved = JSON.parse(raw) as {
        events: FeedEvent[]
        offset: number | null
        scrollY: number
      }
      if (saved.events && saved.events.length > initial.length) {
        seen.current = new Set(saved.events.map(eventKey))
        setEvents(saved.events)
        setOffset(saved.offset)
        requestAnimationFrame(() => window.scrollTo(0, saved.scrollY ?? 0))
      }
    } catch {
      // corrupt / oversized storage — ignore and start fresh
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Persist scroll + loaded pages so the return navigation above can restore.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined
    const save = () => {
      try {
        sessionStorage.setItem(
          restoreKey(view, team, type),
          JSON.stringify({ events, offset, scrollY: window.scrollY }),
        )
      } catch {
        // storage full — non-fatal, restoration just won't be available
      }
    }
    const onScroll = () => {
      clearTimeout(t)
      t = setTimeout(save, 200)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      clearTimeout(t)
      save()
    }
  }, [events, offset, view, team, type])

  const loadMore = useCallback(async () => {
    if (inFlight.current || offset == null) return
    inFlight.current = true
    setLoading(true)
    setError(false)
    try {
      const params = new URLSearchParams({ view, offset: String(offset), limit: String(pageSize) })
      if (team) params.set('team', team)
      if (type) params.set('type', type)
      const res = await fetch(`/api/feed?${params.toString()}`)
      if (!res.ok) throw new Error(String(res.status))
      const data = (await res.json()) as { events: FeedEvent[]; nextOffset: number | null }
      // Dedup against everything seen — offset paging can re-surface an event if
      // new activity arrived since the previous page.
      const fresh = (data.events ?? []).filter((e) => {
        const k = eventKey(e)
        if (seen.current.has(k)) return false
        seen.current.add(k)
        return true
      })
      setEvents((prev) => [...prev, ...fresh])
      setOffset(data.nextOffset)
    } catch {
      setError(true)
    } finally {
      inFlight.current = false
      setLoading(false)
    }
  }, [offset, view, team, type, pageSize])

  useEffect(() => {
    const el = sentinel.current
    if (!el || offset == null || error) return
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore()
      },
      { rootMargin: '800px' },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [loadMore, offset, error])

  return (
    <>
      <ul className="feed-list">{renderFeedEntries(events, isAuthed, viewerHandle)}</ul>
      {offset != null && !error && (
        <div className="flex flex-col items-center py-6">
          {/* The button keeps load-more keyboard- and screen-reader-reachable;
              the zero-size sentinel below auto-loads for pointer scrolling. */}
          <Button type="button" variant="secondary" onClick={() => void loadMore()} disabled={loading}>
            {loading ? 'Loading…' : 'Load more'}
          </Button>
          <div ref={sentinel} aria-hidden="true" className="h-px w-px" />
        </div>
      )}
      {error && (
        <p className="py-6 text-center text-sm text-(--ink-2)">
          Couldn&rsquo;t load more.{' '}
          <Button type="button" variant="accent" onClick={() => void loadMore()}>
            Retry
          </Button>
        </p>
      )}
      {offset == null && events.length > initial.length && (
        <p className="py-6 text-center text-sm text-(--ink-2)">You&rsquo;re all caught up.</p>
      )}
    </>
  )
}
