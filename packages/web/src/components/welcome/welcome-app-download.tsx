'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { AppleLogo, WindowsLogo } from '@/components/os-logos'
import { buttonClasses } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import { detectInstallPlatform, type InstallPlatform } from '@/lib/install-platform'
import {
  SKILLET_DMG_URL,
  SKILLET_WINDOWS_INSTALLER_URL,
  NPX_SKILLET_COMMAND,
} from '@/config'

const textLink = 'font-medium text-(--ink) underline-offset-2 hover:underline'

/**
 * OS-detected app-download block for the welcome chat. Leads with the one app the
 * visitor can run (Mac or Windows); the other desktop OS and the CLI sit on a
 * single quiet line beneath. Linux/mobile lead with the CLI instead. Kept
 * deliberately terse — the greeting already says what the app is for, so this is
 * button + three short lines, not a paragraph. `initialPlatform` comes from the
 * server (UA header) to avoid a flash; the client refines it on mount.
 */
export function WelcomeAppDownload({
  initialPlatform,
  onDownload,
}: {
  initialPlatform: InstallPlatform
  /** Fired when the visitor takes the grab-the-app action (download or CLI), so
   *  the flow can advance to the connect step. */
  onDownload?: () => void
}) {
  const [platform, setPlatform] = useState<InstallPlatform>(initialPlatform)
  useEffect(() => {
    setPlatform(detectInstallPlatform(navigator.userAgent || '', navigator.platform || ''))
  }, [])

  const isWindows = platform === 'windows'
  const hasDesktopApp = platform === 'mac' || platform === 'windows'

  if (!hasDesktopApp) {
    return (
      <div>
        <Link
          href="/install"
          onClick={onDownload}
          className={cn(buttonClasses('primary', { size: 'md' }), 'w-full')}
        >
          {NPX_SKILLET_COMMAND}
        </Link>
        <p className="mt-2 text-center text-xs text-(--ink-2)">
          Runs the setup wizard ·{' '}
          <Link href="/install" className={textLink}>
            Get the Mac or Windows app
          </Link>
        </p>
      </div>
    )
  }

  const primary = isWindows
    ? { href: SKILLET_WINDOWS_INSTALLER_URL, label: 'Download for Windows', os: 'Windows 10 or later', Logo: WindowsLogo }
    : { href: SKILLET_DMG_URL, label: 'Download for Mac', os: 'macOS 13 or later', Logo: AppleLogo }

  return (
    <div>
      <Link
        href={primary.href}
        onClick={onDownload}
        className={cn(buttonClasses('primary', { size: 'lg' }), 'w-full gap-2')}
      >
        <primary.Logo className="h-4 w-4" />
        {primary.label}
      </Link>
      <p className="mt-2.5 text-center text-xs text-(--ink-2)">
        {`Free · ${primary.os}`}
      </p>
      <p className="mt-1.5 text-center text-xs text-(--ink-2)">
        Also for{' '}
        <Link href={isWindows ? SKILLET_DMG_URL : SKILLET_WINDOWS_INSTALLER_URL} className={textLink}>
          {isWindows ? 'Mac' : 'Windows'}
        </Link>{' '}
        and the{' '}
        <Link href="/install" className={textLink}>
          terminal
        </Link>
      </p>
    </div>
  )
}
