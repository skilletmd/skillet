import type { Metadata } from 'next'
import { Suspense } from 'react'
import { headers } from 'next/headers'
import { SKILLET_DEMO_POSTER_URL, SKILLET_DEMO_VIDEO_URL } from '@/config'
import { ogImagePath, OG } from '@/lib/og'
import { detectInstallPlatform } from '@/lib/install-platform'
import { InstallPageBody } from './install-page-body'

const installOg = ogImagePath(OG.install())
const showDemo = SKILLET_DEMO_VIDEO_URL.trim().length > 0

export const metadata: Metadata = {
  title: 'Install Skillet',
  description:
    'Get Skillet on macOS or Windows (tray app) or Linux (CLI wizard). Import, link, and sync your skills.',
  openGraph: {
    title: 'Install Skillet',
    description:
      'Mac or Windows app, or Linux CLI. Import skills, link your account, sync to every agent runtime.',
    siteName: 'Skillet',
    type: 'website',
    images: [{ url: installOg, width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Install Skillet',
    description:
      'Mac or Windows app, or Linux CLI. Import skills, link your account, sync to every agent runtime.',
    images: [installOg],
  },
}

async function InstallPagePlatform() {
  const h = await headers()
  const ua = h.get('user-agent') ?? ''
  const initialPlatform = detectInstallPlatform(ua, '')

  return (
    <InstallPageBody
      initialPlatform={initialPlatform}
      showDemo={showDemo}
      demoPosterUrl={SKILLET_DEMO_POSTER_URL || undefined}
      demoVideoUrl={showDemo ? SKILLET_DEMO_VIDEO_URL : undefined}
    />
  )
}

export default function InstallPage() {
  return (
    <Suspense
      fallback={
        <InstallPageBody
          initialPlatform="mac"
          showDemo={showDemo}
          demoPosterUrl={SKILLET_DEMO_POSTER_URL || undefined}
          demoVideoUrl={showDemo ? SKILLET_DEMO_VIDEO_URL : undefined}
        />
      }
    >
      <InstallPagePlatform />
    </Suspense>
  )
}
