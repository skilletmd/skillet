'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { buttonClasses } from '@/components/ui/button'

type OS = 'mac' | 'windows' | null

function AppleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M17.05 12.54c-.03-2.6 2.12-3.85 2.22-3.91-1.21-1.77-3.1-2.02-3.78-2.04-1.6-.16-3.13.94-3.94.94-.81 0-2.07-.92-3.4-.9-1.75.03-3.36 1.02-4.26 2.58-1.82 3.17-.47 7.85 1.31 10.42.87 1.26 1.9 2.67 3.26 2.62 1.31-.05 1.8-.85 3.39-.85 1.58 0 2.03.85 3.41.82 1.41-.02 2.3-1.28 3.16-2.55.99-1.46 1.4-2.87 1.42-2.94-.03-.01-2.72-1.05-2.75-4.15zM14.47 5.17c.72-.87 1.2-2.08 1.07-3.28-1.03.04-2.28.69-3.02 1.55-.66.77-1.24 2-1.08 3.18 1.15.09 2.32-.58 3.03-1.45z" />
    </svg>
  )
}

function WindowsMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M3 5.4 10.4 4.4v6.9H3V5.4zM11.3 4.3 21 3v8.3h-9.7V4.3zM3 12.2h7.4v6.9L3 18.1v-5.9zM11.3 12.2H21V21l-9.7-1.3v-7.5z" />
    </svg>
  )
}

/**
 * "Get the app" CTA that shows the viewer's platform mark (Apple / Windows).
 * OS is a client-only signal, so the server (and first client render) paints the
 * label alone; the mark swaps in after mount. No mark on Linux/unknown.
 */
export function GetAppButton({
  href,
  label,
  className,
}: {
  href: string
  label: string
  className?: string
}) {
  const [os, setOs] = useState<OS>(null)
  useEffect(() => {
    const ua = navigator.userAgent
    if (/Mac|iPhone|iPad|iPod/.test(ua)) setOs('mac')
    else if (/Win/.test(ua)) setOs('windows')
  }, [])

  return (
    <Link
      href={href}
      className={`group ${className ?? ''} ${buttonClasses('secondary', { size: 'md' })}`}
    >
      {os === 'mac' && <AppleMark className="h-4 w-4" />}
      {os === 'windows' && <WindowsMark className="h-[15px] w-[15px]" />}
      {label}
      <span
        aria-hidden="true"
        className="transition-transform duration-200 [@media(hover:hover)]:group-hover:translate-x-0.5"
      >
        &rarr;
      </span>
    </Link>
  )
}
