'use client'

import { signOut } from 'next-auth/react'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import {
  ensureAttentionStream,
  registerAttentionCountsApplier,
  releaseAttentionStream,
  setAttentionStreamTabVisible,
} from '@/lib/attention-stream'
import { registryAuthApi } from '@/lib/registry-proxy'
import { loginHref } from '@/lib/urls'

// One shared source for the unread-attention counts. The top-nav bell, the Feed
// nav badge, and the Feed Notifications/Updates tab labels all read it, so without
// this they'd each fire their own fetch on every navigation. A module-level store
// dedupes concurrent fetches and fans the result out to every subscriber. Stays
// silent (counts unchanged) on any fetch failure.
//
// The count has two independently-cleared halves:
//   - social  → unseen social events (follows, subscribes). Cleared optimistically
//               when the viewer opens the Notifications tab (markSocialSeen).
//   - updates → pending skill/kit updates. A real decision queue; cleared only when
//               the viewer approves/skips an item (decrementPendingUpdates), never
//               just by viewing the tab.
//
// `total` is the ATTENTION count (what the bell shows): social + updates the viewer
// hasn't looked at yet. A badge clears when you've seen the thing; a queue clears
// when you've done the thing. Summing the raw queue into the bell produced the
// dead-end where the bell said 3, Notifications was empty, and the 3 lived one tab
// down. So updates contribute to `total` only until the viewer sees them — on the
// Notifications tab (its pinned pending-updates row) or the Updates tab itself
// (markUpdatesSeen); the queue (`updates`, the tab badge) persists until acted on.
// The seen watermark is the queue size at last sighting, kept in localStorage so a
// reload doesn't re-ring the bell for updates already seen.

// A `/me` call returning 401 means the registry no longer accepts our session: the
// web's next-auth cookie is still alive, but the registry session behind it is
// dead. That mismatch is exactly what produces the "logged-in but wrong avatar /
// 404 pages" Frankenstein state. We can't silently re-mint (the OAuth identity
// needed to mint a registry session is only available at sign-in, not persisted),
// so we do the standard thing: treat 401 as session-dead, sign out cleanly, and
// send the user to /login (signing back in re-mints). This poll runs on every
// navigation in the signed-in chrome, so a dead session is caught promptly. Guarded
// to fire exactly once.
let sessionEnded = false
function endDeadSession() {
  if (sessionEnded || typeof window === 'undefined') return
  sessionEnded = true
  const returnTo = window.location.pathname + window.location.search
  void signOut({ redirectTo: loginHref(returnTo) })
}

export type UnreadCounts = { social: number; updates: number; total: number }

const UPDATES_SEEN_KEY = 'skillet.updatesSeenCount'

function readUpdatesSeen(): number {
  if (typeof window === 'undefined') return 0
  try {
    const n = Number(window.localStorage.getItem(UPDATES_SEEN_KEY))
    return Number.isFinite(n) && n > 0 ? n : 0
  } catch {
    return 0
  }
}

function persistUpdatesSeen(n: number) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(UPDATES_SEEN_KEY, String(n))
  } catch {
    /* private mode etc. — the watermark just won't survive a reload */
  }
}

let social = 0
let updates = 0
// Queue size at the viewer's last visit to the Updates tab. Only the excess above
// this rings the bell. Never allowed to exceed the live queue size — when the
// queue shrinks (approve/skip here or on another device) the watermark follows it
// down, so the next arrival counts as new instead of being swallowed by a stale
// high-water mark.
let updatesSeen = readUpdatesSeen()
let inflight: Promise<void> | null = null
// Bumped whenever a half is cleared optimistically. A refresh that started before
// the clear ignores that half's now-stale result, so the optimistic value wins the
// race. The two halves clear independently, so each carries its own token.
let socialSeenToken = 0
let updatesSeenToken = 0
const listeners = new Set<(c: UnreadCounts) => void>()

function setUpdates(n: number) {
  updates = n
  if (updatesSeen > updates) {
    updatesSeen = updates
    persistUpdatesSeen(updatesSeen)
  }
}

function snapshot(): UnreadCounts {
  return { social, updates, total: social + Math.max(0, updates - updatesSeen) }
}

function emit() {
  const c = snapshot()
  for (const l of listeners) l(c)
}

const POLL_MS = 15_000
let pollTimer: ReturnType<typeof setInterval> | undefined
let visibilityHandler: (() => void) | null = null

function syncVisibleTabPoll() {
  if (typeof document === 'undefined') return
  if (document.visibilityState === 'visible') {
    setAttentionStreamTabVisible(true)
    void refreshUnreadNotifications()
    if (!pollTimer) {
      pollTimer = setInterval(() => {
        if (document.visibilityState === 'visible') void refreshUnreadNotifications()
      }, POLL_MS)
    }
  } else {
    setAttentionStreamTabVisible(false)
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = undefined
    }
  }
}

function startVisibleTabPoll() {
  if (typeof document === 'undefined' || visibilityHandler) return
  visibilityHandler = syncVisibleTabPoll
  document.addEventListener('visibilitychange', visibilityHandler)
  syncVisibleTabPoll()
}

function stopVisibleTabPoll() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = undefined
  }
  if (visibilityHandler && typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', visibilityHandler)
    visibilityHandler = null
  }
}

export function refreshUnreadNotifications(): Promise<void> {
  if (inflight) return inflight
  const sTok = socialSeenToken
  const uTok = updatesSeenToken
  inflight = fetch(registryAuthApi('me/notifications/unread-count'), {
    credentials: 'include',
    headers: { accept: 'application/json' },
  })
    .then((res) => {
      // Authoritative "your session is invalid" — log out instead of soft-failing
      // into a half-authenticated state. Other statuses just leave the counts as-is.
      if (res.status === 401) {
        endDeadSession()
        return null
      }
      return res.ok ? res.json() : null
    })
    .then((body: { unread_count?: number; pending_updates_count?: number } | null) => {
      if (!body) return
      let changed = false
      // Each half only accepts the server value if it hasn't been cleared
      // optimistically since this fetch began.
      if (sTok === socialSeenToken) {
        social = body.unread_count ?? 0
        changed = true
      }
      if (uTok === updatesSeenToken) {
        setUpdates(body.pending_updates_count ?? 0)
        changed = true
      }
      if (changed) emit()
    })
    .catch(() => {})
    .finally(() => {
      inflight = null
    })
  return inflight
}

/** Optimistically clear the social half after the viewer opens the Notifications
 *  tab. Leaves the pending-updates half intact — those persist until acted on. */
export function markSocialSeen() {
  socialSeenToken += 1
  social = 0
  emit()
}

/** Mark the current updates queue as seen (the viewer is looking at the Updates
 *  tab). Drops the updates contribution from the bell's attention count without
 *  touching the queue itself — `updates` still badges the tab until acted on. */
export function markUpdatesSeen() {
  if (updatesSeen === updates) return
  updatesSeen = updates
  persistUpdatesSeen(updatesSeen)
  emit()
}

/** Optimistically reduce the pending-updates half after the viewer approves or
 *  skips an update. */
export function decrementPendingUpdates(n = 1) {
  updatesSeenToken += 1
  setUpdates(Math.max(0, updates - n))
  emit()
}

/** Apply authoritative counts from the live SSE attention channel. */
export function applyAttentionCounts(nextSocial: number, nextUpdates: number) {
  social = nextSocial
  setUpdates(nextUpdates)
  emit()
}

registerAttentionCountsApplier(applyAttentionCounts)

/** The current attention counts, refreshed on mount, route change, and every 15s
 *  while the tab is visible. */
export function useUnreadNotifications(): UnreadCounts {
  const pathname = usePathname()
  const [value, setValue] = useState<UnreadCounts>(snapshot())
  useEffect(() => {
    listeners.add(setValue)
    setValue(snapshot())
    if (listeners.size === 1) {
      startVisibleTabPoll()
      ensureAttentionStream()
    } else void refreshUnreadNotifications()
    return () => {
      listeners.delete(setValue)
      if (listeners.size === 0) {
        stopVisibleTabPoll()
        releaseAttentionStream()
      }
    }
  }, [pathname])
  return value
}
