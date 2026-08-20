'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { CommandBlock } from '@/components/command-block'
import { CopyBox } from '@/components/ui/copy-box'
import { Button } from '@/components/ui/button'
import { Apple, Windows } from '@/components/ui/icons'
import {
  NPX_SKILLET_COMMAND,
  SKILLET_APP_SIZE_LABEL,
  SKILLET_DMG_URL,
  SKILLET_WINDOWS_APP_SIZE_LABEL,
  SKILLET_WINDOWS_INSTALLER_URL,
} from '@/config'
import { detectInstallPlatform, type InstallPlatform } from '@/lib/install-platform'
import { registryAuthApi } from '@/lib/registry-proxy'

interface PairCodeResponse {
  code: string
  expires_at: number
  ttl_sec: number
}

async function mintPairCode(signal?: AbortSignal): Promise<PairCodeResponse> {
  const res = await fetch(registryAuthApi('connect/codes'), {
    method: 'POST',
    credentials: 'include',
    headers: { accept: 'application/json' },
    signal,
  })
  if (!res.ok) {
    throw new Error(`Could not create pair code (${res.status})`)
  }
  return (await res.json()) as PairCodeResponse
}

function formatPairCodeDisplay(code: string): string {
  if (code.length !== 8) return code
  return `${code.slice(0, 4)}-${code.slice(4)}`
}

/**
 * Short-lived code for `skillet connect <code>`. Minted only on an explicit click
 * (intent to pair) and NOT auto-rotated — a tab left open never keeps spawning
 * live codes. On expiry it flips to an expired state with a one-click re-mint, so
 * the live-code surface tracks real pairing intent.
 *
 * `onActiveChange` reports whether a live (non-expired) code is on screen, so the
 * parent can poll for the newly-paired device only while pairing is actually in
 * flight, and confirm success the moment it lands.
 */
export function MachinePairCodePanel({
  onActiveChange,
  autoMint = false,
  path,
}: {
  onActiveChange?: (active: boolean) => void
  /** Mint a code as soon as the panel opens. Safe when the panel only appears
   *  after an explicit "Connect a device" click (that click IS the pair intent),
   *  so there's no second "Generate" step. Codes still don't auto-rotate. */
  autoMint?: boolean
  /** Which redemption path to show for the minted code: the desktop app
   *  (computer) or the one-line terminal command (cloud). One code serves
   *  both — the parent can flip this without re-minting. */
  path: 'computer' | 'cloud'
}) {
  const [pair, setPair] = useState<PairCodeResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [expired, setExpired] = useState(false)

  // OS-detected download CTA (same pattern as /install); 'mac' until the
  // client-side detection lands, so the server render is never wrong for long.
  const [platform, setPlatform] = useState<InstallPlatform>('mac')
  useEffect(() => {
    setPlatform(detectInstallPlatform(navigator.userAgent || '', navigator.platform || ''))
  }, [])

  // Surface "a live code is waiting to be redeemed" to the parent. Clearing it on
  // unmount stops any parent polling when the panel goes away.
  const active = pair !== null && !expired
  useEffect(() => {
    onActiveChange?.(active)
    return () => onActiveChange?.(false)
  }, [active, onActiveChange])

  const loadCode = useCallback(async () => {
    setLoading(true)
    setError(null)
    setExpired(false)
    try {
      const next = await mintPairCode()
      setPair(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create a code.')
    } finally {
      setLoading(false)
    }
  }, [])

  // Mint immediately when opened from an explicit connect intent (one click, no
  // "Generate" gate). Runs once — expiry flips to a re-mint, never auto-rotates.
  useEffect(() => {
    if (autoMint) void loadCode()
  }, [autoMint, loadCode])

  // Flip to expired when the TTL lapses — but do NOT auto-mint. A forgotten tab
  // stops holding a live code; an actively-pairing user clicks once for a new one.
  useEffect(() => {
    if (!pair) return
    const tick = () => {
      if (pair.expires_at - Math.floor(Date.now() / 1000) <= 0) setExpired(true)
    }
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [pair])

  if (!pair) {
    // Auto-mint mode: the connect click already expressed intent, so show the
    // minting state (or an error with retry) rather than a second "Generate" button.
    if (autoMint) {
      return (
        <div className="mt-2 text-center text-sm text-(--ink-2)">
          {error ? (
            <span className="text-(--danger)">
              {error}{' '}
              <Button
                type="button"
                variant="tertiary"
                size="sm"
                onClick={() => void loadCode()}
                disabled={loading}
              >
                {loading ? 'Generating…' : 'Try again'}
              </Button>
            </span>
          ) : (
            'Generating a pairing code…'
          )}
        </div>
      )
    }
    return (
      <div className="mt-2 flex flex-col items-center">
        <Button
          type="button"
          variant="primary"
          onClick={() => void loadCode()}
          disabled={loading}
        >
          {loading ? 'Generating…' : 'Generate a pairing code'}
        </Button>
        {error && <p className="mt-2 text-sm text-(--danger)">{error}</p>}
      </div>
    )
  }

  const connectCommand = `${NPX_SKILLET_COMMAND} connect ${pair.code}`

  return (
    <div className="mt-5 flex w-full flex-col gap-3">
      {path === 'computer' ? (
        <>
          <p className="text-center text-sm leading-relaxed text-(--ink-2)">
            A tiny {platform === 'windows' ? 'system-tray' : 'menu bar'} app that keeps your
            skills synced into every agent on your computer.
          </p>
          <Button
            href={
              platform === 'windows'
                ? SKILLET_WINDOWS_INSTALLER_URL
                : platform === 'mac'
                  ? SKILLET_DMG_URL
                  : '/install'
            }
            variant="primary"
            block
          >
            {platform === 'windows' ? (
              <Windows className="h-[18px] w-[18px]" />
            ) : platform === 'mac' ? (
              <Apple className="h-5 w-5" />
            ) : null}
            {platform === 'windows'
              ? 'Download for Windows'
              : platform === 'mac'
                ? 'Download for Mac'
                : 'Get the app'}
          </Button>
          <p className="-mt-1 text-center text-xs text-(--ink-3)">
            {platform === 'windows'
              ? `${SKILLET_WINDOWS_APP_SIZE_LABEL} · `
              : platform === 'mac'
                ? `${SKILLET_APP_SIZE_LABEL} · `
                : null}
            <Link
              href="/install"
              className="text-(--ink-2) underline underline-offset-2 hover:text-(--ink)"
            >
              More install options
            </Link>
          </p>
          <p className="text-center text-sm text-(--ink-2)">Then enter this code:</p>
          {/* The whole code box copies on click; a dead code stops looking
              copyable at all — grayed, struck through, copy affordance gone. */}
          <CopyBox
            value={pair.code}
            disabled={expired}
            ariaLabel={expired ? 'Code expired' : 'Copy code'}
          >
            {/* Mirrors the copy glyph so the code sits dead-center. */}
            <span className="w-4 shrink-0" aria-hidden="true" />
            <code
              data-testid="pair-code-display"
              className={`min-w-0 flex-1 text-center font-mono text-lg font-semibold tracking-[0.18em] ${
                expired ? 'text-(--ink-3) line-through decoration-1' : 'text-(--ink)'
              }`}
            >
              {formatPairCodeDisplay(pair.code)}
            </code>
          </CopyBox>
        </>
      ) : (
        <>
          <p className="text-center text-sm leading-relaxed text-(--ink-2)">
            Sync skills anywhere you have a terminal: devboxes, VMs, cloud coding agents.
          </p>
          <p className="text-center text-sm text-(--ink-2)">Run this in its terminal:</p>
          <div className={expired ? 'pointer-events-none opacity-50' : undefined}>
            {/* py-1: the inner 30px icon button, not text, sets this row's height —
              default padding would push the box past the shared 44px line. */}
          <CommandBlock command={connectCommand} size="sm" className="min-h-11 px-4 py-1" />
          </div>
        </>
      )}
      {expired && (
        <div className="flex flex-col items-center gap-2">
          <p className="text-center text-xs text-(--ink-3)">This code expired</p>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => void loadCode()}
            disabled={loading}
          >
            {loading ? 'Generating…' : 'Get a new code'}
          </Button>
        </div>
      )}
    </div>
  )
}
