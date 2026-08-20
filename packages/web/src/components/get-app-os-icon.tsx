'use client'

import { useEffect, useState } from 'react'
import { AppleLogo, WindowsLogo } from '@/components/os-logos'

// Shows the visitor's own OS mark next to a "Get the app" link. Client-only
// (renders nothing on the server / until detected) so there's no hydration
// mismatch; falls back to no icon on Linux/mobile/unknown.
export function GetAppOsIcon({ className }: { className?: string }) {
  const [os, setOs] = useState<'mac' | 'win' | null>(null)
  useEffect(() => {
    const ua = navigator.userAgent
    if (/Mac|iPhone|iPad|iPod/.test(ua)) setOs('mac')
    else if (/Win/.test(ua)) setOs('win')
  }, [])
  if (!os) return null
  const Icon = os === 'mac' ? AppleLogo : WindowsLogo
  return <Icon className={className} />
}
