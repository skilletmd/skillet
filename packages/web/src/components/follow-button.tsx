'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { cn } from '@/lib/cn'
import { buttonClasses } from '@/components/ui/button'
import { loginHref } from '@/lib/urls'
import { useFollowsOptional } from '@/components/follows-context'
import { registryAuthApi } from '@/lib/registry-proxy'

interface FollowButtonProps {
  /** Author handle (subject_id) to follow. */
  author: string
  initialFollowing: boolean
  /** Whether a session exists. When false, the button routes to /login. */
  isAuthed: boolean
  /** Compact form (no follower count) for dense lists like the who-to-follow rail. */
  compact?: boolean
  /**
   * 'cta' (default) = the bold profile button. 'card' = mirrors the skill "Add"
   * control so a Follow and an Add read as the same kind of action when they sit
   * on sibling cards. 'inline' = a chromeless accent text action for a byline
   * (no bg/border/min-width), so it reads as part of the metadata line rather
   * than a competing button. The card and inline forms never show the count.
   */
  appearance?: 'cta' | 'card' | 'inline' | 'secondary'
  /** Idle label reads "Follow @author" instead of bare "Follow" — for detail
   *  heroes where the button pairs with a primary Add and needs to name what it
   *  follows. The done-state stays the compact "Following"/"Unfollow" toggle. */
  showHandle?: boolean
}

const FOLLOWS_ENDPOINT = registryAuthApi('follows')

// One standard for the page-level CTA (Follow here, Add on skill/kit pages): the
// `primary` button at lg — one size, one color, one shape across every detail
// hero. Cards and dense rails keep the quieter `secondary` sm. No +/✓ on Follow:
// those are acquisition cues that belong on "Add"; Follow is a social toggle
// where the word IS the state, like Twitter/GitHub. "Following" is the
// accent-tinted "connected" chip (the same system-wide done-state as "Added"),
// and flips to a red "Unfollow" on hover so undoing is discoverable.
const idle = (size: 'sm' | 'lg') =>
  cn(buttonClasses(size === 'lg' ? 'primary' : 'secondary', { size }), 'min-w-[6rem]')
// Secondary pill: an outlined button in both states, so it reads as the quiet
// partner to a filled primary (Add) rather than a second primary.
const secondaryIdle = (size: 'sm' | 'lg') =>
  cn(buttonClasses('secondary', { size }), 'min-w-[6rem]')
const on = (size: 'sm' | 'lg') =>
  cn(
    buttonClasses('secondary', { size }),
    'min-w-[6rem] border-transparent bg-(--accent-bg) [color:var(--accent)] hover:border-(--danger-line) hover:bg-(--surface) hover:[color:var(--danger)]',
  )

// Chromeless byline form (appearance='inline'): no bg/border/min-width, sits in
// the meta line as the one interactive affordance. Idle is the accent word; the
// done-state is muted "Following" that reddens to "Unfollow" on hover, keeping the
// same toggle grammar as the button forms.
const inlineIdle = 'text-sm font-medium [color:var(--accent)] transition-colors hover:opacity-70'
// The done-state reserves a fixed width and left-anchors the label so the
// "Following" → "Unfollow" hover swap (different word lengths) can't reflow the
// text or nudge anything after it. Idle "Follow" keeps its natural width — no
// trailing gap before you've followed.
const inlineOn =
  'inline-block min-w-[4.5rem] text-left text-sm font-medium text-(--ink-2) transition-colors hover:[color:var(--danger)]'

export function FollowButton({
  author,
  initialFollowing,
  isAuthed,
  compact = false,
  appearance = 'cta',
  showHandle = false,
}: FollowButtonProps) {
  const router = useRouter()
  const follows = useFollowsOptional()
  // Prefer the shared follow graph once it's loaded; fall back to the server hint
  // (and a local copy for logged-out, contextless renders) until then.
  const ctxReady = follows != null && !follows.loading
  const [localFollowing, setLocalFollowing] = useState(initialFollowing)
  const [pending, setPending] = useState(false)
  const [hover, setHover] = useState(false)
  const card = appearance === 'card'
  const inline = appearance === 'inline'
  const secondary = appearance === 'secondary'
  // Compact rows and cards use sm; the profile CTA is the standard hero lg.
  const size = card || compact ? 'sm' : 'lg'
  const followWord = showHandle ? `Follow @${author}` : 'Follow'
  const idleClass = secondary ? secondaryIdle(size) : idle(size)
  const following = ctxReady ? follows.isFollowing(author) : localFollowing

  // Update both the shared context (so every FollowButton for this author flips
  // at once, on any surface) and the local fallback.
  function applyFollowing(value: boolean) {
    setLocalFollowing(value)
    follows?.setFollowing(author, value)
  }

  if (!isAuthed) {
    return (
      <Link
        href={loginHref(`/${author}`)}
        className={inline ? inlineIdle : idleClass}
        aria-label={`Sign in to follow @${author}`}
      >
        {followWord}
      </Link>
    )
  }

  async function toggle() {
    if (pending) return
    const next = !following
    // optimistic
    applyFollowing(next)
    setPending(true)
    try {
      const res = await fetch(FOLLOWS_ENDPOINT, {
        method: next ? 'POST' : 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'author', id: author }),
      })
      if (!res.ok) throw new Error(`follow_failed:${res.status}`)
      const data = (await res.json()) as { following: boolean; followers: number }
      applyFollowing(data.following)
      // Invalidate the Router Cache so other surfaces (the home Top-creators
      // list, profile headers) re-render with the new follow state instead of a
      // stale cached RSC payload when navigated back to.
      router.refresh()
    } catch {
      // revert on failure
      applyFollowing(!next)
    } finally {
      setPending(false)
    }
  }

  const label = following ? (hover ? 'Unfollow' : 'Following') : followWord

  return (
    <button
      type="button"
      onClick={toggle}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      disabled={pending}
      aria-pressed={following}
      className={inline ? (following ? inlineOn : inlineIdle) : following ? on(size) : idleClass}
    >
      {label}
    </button>
  )
}
