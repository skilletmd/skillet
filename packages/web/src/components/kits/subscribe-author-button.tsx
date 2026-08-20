'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useMyKitsOptional } from '@/components/kits/my-kits-context'
import { useSubscribeToggle } from '@/lib/use-subscribe-toggle'
import { loginHref } from '@/lib/urls'

export function SubscribeAuthorButton({
  author,
  initialSubscribed,
  viewerHandle,
  isTeam = false,
  variant = 'card',
}: {
  author: string
  /** Server's best guess; the live follow graph (context) overrides it once loaded. */
  initialSubscribed: boolean
  viewerHandle: string | null
  isTeam?: boolean
  /** 'card' = full banner; 'inline' = just the subscribe button (for kit rows). */
  variant?: 'card' | 'inline'
}) {
  const ctx = useMyKitsOptional()
  const [error, setError] = useState<string | null>(null)
  // Derive from the live follow graph when it's loaded; fall back to the server
  // hint until then. The shared hook layers the just-clicked state on top and
  // owns the optimistic flip + revert (the card surfaces failures via onError).
  const ctxReady = ctx != null && !ctx.loading && ctx.authed
  const { subscribed, pending, toggle } = useSubscribeToggle({
    base: ctxReady ? ctx.isSubscribedAuthor(author) : initialSubscribed,
    endpoint: `authors/${encodeURIComponent(author)}/subscribe`,
    owner: author,
    refresh: ctx?.refresh,
    onError: variant === 'card' ? setError : undefined,
  })

  if (viewerHandle === author) return null

  if (variant === 'inline') {
    if (!viewerHandle) {
      return (
        <Button href={loginHref(`/${author}`)} variant="secondary">
          Add
        </Button>
      )
    }
    return (
      <Button
        type="button"
        variant={subscribed ? 'secondary' : 'primary'}
        onClick={toggle}
        disabled={pending}
      >
        {pending ? '…' : subscribed ? 'Added' : 'Add'}
      </Button>
    )
  }

  const kitLabel = isTeam ? 'Team kit' : 'Author kit'
  const kitCopy = isTeam
    ? `Add to keep every public skill by @${author} synced: team publishes and future releases.`
    : `Add to keep every public skill by @${author} synced: past publishes and new ones.`
  const subscribeLabel = isTeam ? 'Add team kit' : 'Add kit'

  return (
    <div className="rounded-lg border border-(--line) bg-(--surface) p-5">
      <p className="font-mono text-xs uppercase tracking-[0.06em] text-(--accent)">{kitLabel}</p>
      <p className="mt-2 text-base leading-normal text-(--ink-2)">{kitCopy}</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {viewerHandle ? (
          <Button
            type="button"
            variant={subscribed ? 'secondary' : 'primary'}
            onClick={toggle}
            disabled={pending}
          >
            {pending ? '…' : subscribed ? 'Added' : subscribeLabel}
          </Button>
        ) : (
          <Button href={loginHref(`/${author}`)} variant="primary">
            Sign in to add
          </Button>
        )}
        {viewerHandle && (
          <Link
            href={`/${encodeURIComponent(viewerHandle)}`}
            className="text-sm text-(--accent) hover:underline"
          >
            Manage kits
          </Link>
        )}
      </div>
      {error && <p className="mt-2 text-sm text-(--danger)">{error}</p>}
    </div>
  )
}
