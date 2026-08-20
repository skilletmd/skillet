'use client'

// Choose-your-username card for Account settings. Web-first users
// without a handle pick one here — no CLI. On success we refresh the NextAuth
// session (update()) so session.handle propagates, then router.refresh()
// re-renders the server page with the new identity.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { claimHandle, validateHandle } from '@/lib/claim-handle'
import { updateProfile } from '@/lib/profile-update'
import { Button } from '@/components/ui/button'
import { Panel } from '@/components/ui/panel'
import { FieldLabel } from '@/components/ui/input'
import { SettingsSection } from '@/components/ui/setting-section'

function normalize(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9-]/g, '')
}

export function ChooseUsername({
  brandClaimEligible = [],
}: {
  brandClaimEligible?: readonly string[]
} = {}) {
  const router = useRouter()
  const { data: session, update } = useSession()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'claiming'>('idle')

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const invalid = validateHandle(value, { brandEligible: brandClaimEligible })
    if (invalid) {
      setError(invalid)
      return
    }
    setStatus('claiming')
    setError(null)
    try {
      await claimHandle(value, { brandEligible: brandClaimEligible })
      const idpName = session?.user?.name?.trim()
      const idpAvatar = session?.user?.image?.trim()
      if (idpName || idpAvatar) {
        try {
          await updateProfile(value, {
            name: idpName || value,
            avatarUrl: idpAvatar ?? '',
          })
        } catch {
          // Best-effort; a later sign-in still syncs IdP fields server-side.
        }
      }
      await update()
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not claim that username.')
    } finally {
      // We reset here even on success so the button never stays stuck on
      // "Claiming…". The parent re-render usually unmounts us once
      // session.handle propagates, but if there is any cookie/cache lag the
      // user can retry instead of being trapped.
      setStatus('idle')
    }
  }

  return (
    <SettingsSection
      title="Choose a username"
      description={
        <>
          Pick a public username to publish skills and get your author profile. This is a one-time
          choice. Usernames are permanent.
          {brandClaimEligible.includes('skillet') && (
            <>
              {' '}
              Your account may claim <span className="font-mono">@skillet</span> for the official
              brand profile.
            </>
          )}
        </>
      }
    >
      <Panel padding="md">
        <form onSubmit={onSubmit}>
        <FieldLabel className="mb-1.5 block">Username</FieldLabel>
        <div className="ui-input-shell font-mono">
          <span className="text-(--ink-2)" aria-hidden>
            @
          </span>
          <input
            id="username"
            name="username"
            aria-label="Username"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={value}
            onChange={(e) => {
              setValue(normalize(e.target.value))
              if (error) setError(null)
            }}
            disabled={status === 'claiming'}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'username-error' : undefined}
            className="min-w-0 flex-1 bg-transparent px-2 text-(--ink) outline-none placeholder:text-(--ink-2)/60 disabled:opacity-60"
            placeholder="your-name"
          />
        </div>
        <Button
          type="submit"
          disabled={status === 'claiming' || value.trim().length === 0}
          variant="primary"
          block
          className="mt-4"
        >
          {status === 'claiming' ? 'Claiming…' : 'Claim username'}
        </Button>
          {error && (
            <p
              id="username-error"
              role="alert"
              className="mt-3 text-sm leading-relaxed text-(--danger)"
            >
              {error}
            </p>
          )}
        </form>
      </Panel>
    </SettingsSection>
  )
}
