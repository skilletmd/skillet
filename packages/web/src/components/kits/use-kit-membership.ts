'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { emitUsed } from '@/components/kits/used-by-live'
import { addSkillToKit } from '@/lib/add-intent'
import { registryAuthApi } from '@/lib/registry-proxy'
import { useMyKitsOptional } from '@/components/kits/my-kits-context'
import { useCopyToClipboard } from '@/lib/use-copy-to-clipboard'
import { skillInstallCommand } from '@/lib/cli-install-commands'
import { loginHref } from '@/lib/urls'
import { SKILLET_EVENTS } from '@/lib/events'

// Display label for the auto one-click kit (kind: 'saved'). Overridden in the UI
// so the rename is instant for existing users without a data migration.
export const SAVED_KIT_LABEL = 'Saved'

/**
 * The data layer behind SkillKitControl: the four kit-membership mutations
 * (toggle the auto Library kit, add to / remove from a named kit, create-and-add)
 * plus the CLI-copy path, the shared pending/error state, and the optimistic
 * "used by" count bookkeeping. The view owns its own UI state (open menu, create
 * form, remove confirmation) and passes `onCreated`/`onRemoved` so this hook
 * clears that state at exactly the same moment the originals did, without
 * reaching into the component.
 */
export function useKitMembership(author: string, slug: string) {
  const kitsCtx = useMyKitsOptional()
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { copied: cliCopied, copy: copyCli } = useCopyToClipboard()

  const memberships = kitsCtx?.membershipsFor(author, slug) ?? []

  // "Used by" reflects whether the viewer has the skill in ANY kit (Library or
  // named). These helpers predict the before/after so an add/remove bumps the
  // shared count instantly — adding a skill to a kit *is* using it.
  const usedRef = `${author}/${slug}`
  const isUsedNow = () =>
    !!kitsCtx &&
    (kitsCtx.isSaved(author, slug) ||
      kitsCtx.membershipsFor(author, slug).some((m) => m.kitId !== kitsCtx.savedKit?.id))

  // The CLI path, folded into the get-control: copy the same npx one-liner as the sidebar card.
  async function copyCliCommand() {
    setError(null)
    await copyCli(skillInstallCommand(`@${author}/${slug}`))
  }

  // One-click Save: toggle this skill in your auto "Saved" kit (Liked Songs).
  async function toggleSaved() {
    if (!kitsCtx) return
    const savedKit = kitsCtx.savedKit
    if (!savedKit) {
      setError(`${SAVED_KIT_LABEL} is not ready yet. Try again in a moment.`)
      return
    }
    setError(null)
    setPending(true)
    // Optimistic: toggling Library only changes "used" if it isn't in a named kit.
    const inNamed = memberships.some((m) => m.kitId !== savedKit.id)
    const wasSaved = kitsCtx.isSaved(author, slug)
    if (!inNamed) emitUsed(usedRef, wasSaved ? -1 : 1)
    try {
      if (wasSaved) {
        const res = await fetch(
          registryAuthApi(
            `kits/${savedKit.id}/skills/${encodeURIComponent(author)}/${encodeURIComponent(slug)}`,
          ),
          { method: 'DELETE', headers: { accept: 'application/json' } },
        )
        if (!res.ok) {
          setError(`Could not remove from ${SAVED_KIT_LABEL}`)
          return
        }
      } else {
        const res = await addSkillToKit(savedKit.id, author, slug)
        if (res.status === 401) {
          window.location.href = loginHref(window.location.pathname)
          return
        }
        if (!res.ok) {
          setError('Could not save')
          return
        }
        // Drives the first-add "connect your agent" prompt (ConnectActivation)
        // and the /welcome reveal. detail carries the ref so listeners can match
        // the specific skill; existing listeners ignore it (backward-compatible).
        window.dispatchEvent(new CustomEvent(SKILLET_EVENTS.skillAdded, { detail: { author, slug } }))
      }
      await kitsCtx.refresh()
      // Also invalidate the Router Cache so server-rendered surfaces on other
      // routes (used-by counts, "in your kits" badges) aren't stale on return.
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  async function addToKit(targetKitId: string) {
    if (!kitsCtx) return
    setError(null)
    setPending(true)
    if (!isUsedNow()) emitUsed(usedRef, 1) // first kit → now used
    try {
      const res = await addSkillToKit(targetKitId, author, slug)
      if (res.status === 401) {
        window.location.href = loginHref(window.location.pathname)
        return
      }
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as {
          message?: string
          error?: string
        } | null
        setError(payload?.message ?? payload?.error ?? 'Could not add to kit')
        return
      }
      await kitsCtx.refresh()
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  /** Create a private kit and add the skill. `onCreated` fires once the kit
   *  exists (to reset the inline create form), matching the original timing —
   *  it runs even if the follow-up add fails, but not if creation itself fails.
   *  `owner` scopes the kit to a team you administer; omit it for a personal kit
   *  (the server defaults the owner to your handle). */
  async function createKitAndAdd(name: string, onCreated?: () => void, owner?: string) {
    if (!kitsCtx) return
    const trimmed = name.trim()
    if (!trimmed) return
    setError(null)
    setPending(true)
    if (!isUsedNow()) emitUsed(usedRef, 1) // new kit + add → now used
    try {
      const res = await fetch(registryAuthApi('kits'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ name: trimmed, visibility: 'private', ...(owner ? { owner } : {}) }),
      })
      if (res.status === 401) {
        window.location.href = loginHref(window.location.pathname)
        return
      }
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as {
          message?: string
          error?: string
        } | null
        setError(payload?.message ?? payload?.error ?? 'Could not create kit')
        return
      }
      const kit = (await res.json()) as { id: string }
      const addRes = await addSkillToKit(kit.id, author, slug)
      if (!addRes.ok) {
        setError('Kit created, but could not add the skill.')
      }
      onCreated?.()
      await kitsCtx.refresh()
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  /** Remove from a named kit. `onRemoved` fires on success (to clear the panel's
   *  remove-confirmation state), matching the original. */
  async function removeFromKit(targetKitId: string, onRemoved?: () => void) {
    if (!kitsCtx) return
    setError(null)
    setPending(true)
    // Optimistic: if this was the only place it lived, it's no longer used.
    const stillUsed =
      kitsCtx.isSaved(author, slug) ||
      memberships.some((m) => m.kitId !== targetKitId && m.kitId !== kitsCtx.savedKit?.id)
    if (!stillUsed) emitUsed(usedRef, -1)
    try {
      const res = await fetch(
        registryAuthApi(
          `kits/${targetKitId}/skills/${encodeURIComponent(author)}/${encodeURIComponent(slug)}`,
        ),
        { method: 'DELETE', headers: { accept: 'application/json' } },
      )
      if (!res.ok) {
        setError('Could not remove from kit')
        return
      }
      onRemoved?.()
      await kitsCtx.refresh()
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  return {
    kitsCtx,
    pending,
    error,
    setError,
    cliCopied,
    copyCliCommand,
    toggleSaved,
    addToKit,
    createKitAndAdd,
    removeFromKit,
  }
}
