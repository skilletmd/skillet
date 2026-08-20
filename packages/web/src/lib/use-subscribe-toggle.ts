'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { registryAuthApi } from '@/lib/registry-proxy'
import { emitUsed } from '@/components/kits/used-by-live'
import { loginHref } from '@/lib/urls'

/**
 * The shared optimistic subscribe/unsubscribe toggle behind the kit "Add", the
 * kit-card coin, and the author-kit "Add" buttons. Owns the flip → POST/DELETE →
 * 401-redirect → revert-on-failure → context+router refresh contract so each
 * button only supplies its endpoint and presentation.
 *
 * `base` is the caller's server/context-derived subscribed state; the hook layers
 * the just-clicked `override` on top for instant feedback. Pass `kitId` to bump
 * the live subscriber count, `onError` to surface a failure message, and
 * `onUnsubscribed` to react to a successful unsubscribe (e.g. an Undo toast — it
 * receives a `resubscribe` callback that re-runs the toggle silently).
 */
export function useSubscribeToggle({
  base,
  endpoint,
  owner,
  kitId,
  refresh,
  onError,
  onUnsubscribed,
  addRequest,
}: {
  base: boolean
  endpoint: string
  owner: string
  kitId?: string | null
  refresh?: () => Promise<unknown> | void
  onError?: (message: string | null) => void
  onUnsubscribed?: (resubscribe: () => void) => void
  /** Override for the "turn it on" POST (e.g. add-intent's subscribeToKit, the
   *  single source of truth the logged-out funnel also replays). The off/DELETE
   *  path always uses `endpoint`. */
  addRequest?: () => Promise<Response>
}) {
  const router = useRouter()
  const [override, setOverride] = useState<boolean | null>(null)
  const [pending, setPending] = useState(false)
  const subscribed = override ?? base

  function bumpCount(delta: number) {
    if (kitId) emitUsed(kitId, delta)
  }

  async function setSubscribed(next: boolean, opts: { silent?: boolean } = {}) {
    setPending(true)
    onError?.(null)
    // Optimistic: flip the button (and the subscriber count) instantly.
    setOverride(next)
    bumpCount(next ? 1 : -1)
    try {
      const res =
        next && addRequest
          ? await addRequest()
          : await fetch(registryAuthApi(endpoint), {
              method: next ? 'POST' : 'DELETE',
              headers: { accept: 'application/json' },
            })
      if (res.status === 401) {
        window.location.href = loginHref(`/${owner}`)
        return
      }
      if (!res.ok) {
        // Revert the optimistic flip + count bump.
        setOverride(!next)
        bumpCount(next ? -1 : 1)
        if (onError) {
          const payload = (await res.json().catch(() => null)) as { message?: string } | null
          onError(payload?.message ?? 'Could not update subscription')
        }
        return
      }
      await refresh?.()
      router.refresh()
      if (!next && !opts.silent) {
        onUnsubscribed?.(() => setSubscribed(true, { silent: true }))
      }
    } finally {
      setPending(false)
    }
  }

  return {
    subscribed,
    pending,
    toggle: () => setSubscribed(!subscribed),
    setSubscribed,
  }
}
