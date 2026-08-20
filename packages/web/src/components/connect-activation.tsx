'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useCopyToClipboard } from '@/lib/use-copy-to-clipboard'
import { SKILLET_EVENTS } from '@/lib/events'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { DialogFooter } from '@/components/ui/dialog-footer'
import { Button } from '@/components/ui/button'
import { ArrowRight } from '@/components/ui/icons'
import { NPX_SKILLET_COMMAND } from '@/config'
import { detectInstallPlatform, type InstallPlatform } from '@/lib/install-platform'

function AppleGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="h-[18px] w-[18px]" aria-hidden="true">
      <path
        d="M11.182.008C11.148-.03 9.923.023 8.857 1.18c-1.066 1.156-.902 2.482-.878 2.516.024.034 1.52.087 2.475-1.258.954-1.345.762-2.391.728-2.43Zm3.314 11.733c-.048-.096-2.325-1.234-2.113-3.422.212-2.189 1.675-2.789 1.698-2.854.023-.065-.597-.79-1.254-1.157a3.7 3.7 0 0 0-1.563-.434c-.108-.003-.483-.095-1.254.116-.508.139-1.653.589-1.968.607-.316.018-1.256-.522-2.267-.665-.647-.125-1.333.131-1.824.328-.49.196-1.422.754-2.074 2.237-.652 1.482-.311 3.83-.067 4.56.244.729.625 1.924 1.273 2.796.576.984 1.34 1.667 1.659 1.899.319.232 1.219.386 1.843.067.502-.308 1.408-.485 1.766-.472.357.013 1.061.154 1.782.539.571.197 1.111.115 1.652-.105.541-.221 1.324-1.059 2.238-2.758.347-.79.521-1.607.473-1.702Z"
        fill="currentColor"
      />
    </svg>
  )
}

function WindowsGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-[17px] w-[17px]" aria-hidden="true">
      <path
        d="M3 5.2 10.7 4v7.3H3V5.2Zm9.3-1.4L21 2.5v8.8h-8.7V3.8ZM3 12.7h7.7V20L3 18.8v-6.1Zm9.3 0H21v8.8l-8.7-1.3v-7.5Z"
        fill="currentColor"
      />
    </svg>
  )
}

const OS_LABEL: Partial<Record<InstallPlatform, string>> = { mac: 'macOS', windows: 'Windows' }

/**
 * Connect-your-agent prompt. Adding a skill puts it in your library, but it only
 * reaches your agent once a device is connected. This is now an explicit,
 * on-request step (it no longer auto-opens on add). Opens on:
 *   - `skillet:open-connect` (the profile "Connect an agent" CTA)
 *   - `?connect=1` (manual preview)
 */
export function ConnectActivation() {
  const [open, setOpen] = useState(false)
  const [platform, setPlatform] = useState<InstallPlatform>('mac')
  const { copied, copy } = useCopyToClipboard()
  const params = useSearchParams()

  useEffect(() => {
    setPlatform(detectInstallPlatform(navigator.userAgent, navigator.platform))
  }, [])

  useEffect(() => {
    if (params.get('connect')) setOpen(true)
  }, [params])

  useEffect(() => {
    function onOpen() {
      setOpen(true)
    }
    window.addEventListener(SKILLET_EVENTS.openConnect, onOpen)
    return () => {
      window.removeEventListener(SKILLET_EVENTS.openConnect, onOpen)
    }
  }, [])

  const hasNativeApp = platform === 'mac' || platform === 'windows'
  const osLabel = OS_LABEL[platform] ?? ''

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="w-[min(94vw,480px)] max-h-[88vh] overflow-y-auto">
        <DialogTitle className="text-lg font-semibold tracking-tight text-(--ink)">
          Connect your agent to sync
        </DialogTitle>
        <p className="mt-1.5 text-sm leading-relaxed text-(--ink-2)">
          That skill is in your library now. Connect a device so it syncs straight into your agent.
        </p>

        {hasNativeApp && (
          <Link
            href="/install"
            className="group mt-5 flex items-center gap-4 surface-card p-4 transition-colors hover:border-(--accent)"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-(--ink) text-(--bg)">
              {platform === 'mac' ? <AppleGlyph /> : <WindowsGlyph />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-(--ink)">Skillet for {osLabel}</span>
              <span className="block text-sm leading-snug text-(--ink-2)">
                Menu-bar app. Keeps your skills in sync automatically.
              </span>
            </span>
            <span className="shrink-0 rounded-full bg-(--accent) px-4 py-2 text-sm font-semibold text-(--bg)">
              Download
            </span>
          </Link>
        )}

        <div className="mt-4">
          <p className="text-xs font-medium text-(--ink-2)">
            {hasNativeApp ? 'Or run it in your terminal' : 'Run it in your terminal'}
          </p>
          <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-(--line) bg-(--bg) py-2 pl-3 pr-2">
            <code className="min-w-0 flex-1 truncate font-mono text-sm text-(--ink)">
              <span className="text-(--ink-2)">$ </span>
              {NPX_SKILLET_COMMAND}
            </code>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => void copy(NPX_SKILLET_COMMAND)}
              className="shrink-0"
            >
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </div>

        <DialogFooter layout="between" className="items-center">
          <Link
            href="/install"
            className="inline-flex items-center gap-1 text-sm font-medium text-(--accent) hover:underline"
          >
            {hasNativeApp ? 'Other platforms' : 'Desktop apps'} <ArrowRight />
          </Link>
          <DialogClose className="rounded-lg px-3 py-1.5 text-sm font-medium text-(--ink-2) transition-colors hover:text-(--ink)">
            Maybe later
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
