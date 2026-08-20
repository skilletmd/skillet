import type { Metadata, Viewport } from 'next'
import { Suspense } from 'react'
import { Figtree } from 'next/font/google'
import { GeistMono } from 'geist/font/mono'
import './globals.css'

// App sans — swap this one line to try another under --font-app-sans.
const appSans = Figtree({ subsets: ['latin'], variable: '--font-app-sans' })
import { SiteChrome } from '@/components/site-chrome'
import { SiteFooter } from '@/components/site-footer'
import { PaletteProvider } from '@/components/palette-context'
import { ToastProvider } from '@/components/ui/toast'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthSessionProvider } from '@/components/auth-session-provider'
import { getSession } from '@/lib/get-session'
import { THEME_STORAGE_KEY } from '@/lib/events'

// One title and one description, reused across page metadata, Open Graph, and
// Twitter. They used to be three near-identical sync lines that drifted apart;
// sharing the consts is what keeps a shared link saying one thing.
const SITE_TITLE = "Summon anyone's genius · Skillet"
const SITE_DESCRIPTION =
  "Type a name and borrow their brain. Run anyone's public skills in your agent, and keep your own current everywhere."

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://skillet.md'),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    siteName: 'Skillet',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

// Resolve theme before first paint: explicit choice wins, otherwise use the computer setting.
// This runs as an inline <script> before the JS bundle, so it can't import the
// module — instead the key from THEME_STORAGE_KEY is interpolated into the plain
// string at build time (JSON.stringify quotes it as a JS string literal).
const themeScript = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});var m=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.dataset.theme=t==="light"||t==="dark"?t:m?"dark":"light";}catch(e){}})()`

async function AuthenticatedChrome({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await getSession()
  return (
    <AuthSessionProvider session={session}>
      <ToastProvider>
        <SiteChrome footer={<SiteFooter />}>{children}</SiteChrome>
      </ToastProvider>
    </AuthSessionProvider>
  )
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${appSans.variable} ${GeistMono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      {/* suppressHydrationWarning: browser extensions (e.g. data-gptw) mutate body before React hydrates */}
      <body suppressHydrationWarning>
        {/* AuthenticatedChrome is dynamic: it awaits the session (cookies) and mounts
            next-auth's SessionProvider, which reads Date.now(). Both must stay out of
            the prerendered static shell, so this Suspense holds them with a static
            (null) fallback — the chrome + session-backed tree stream in at request
            time. A fallback that rendered `children` here would either crash on
            useSession (no provider) or pull Date.now() into the static shell. */}
        <PaletteProvider>
          {/* One shared tooltip provider so adjacent tooltips skip the open
              delay (Radix skipDelayDuration). Context-only, renders no DOM. */}
          <TooltipProvider>
            <Suspense fallback={null}>
              <AuthenticatedChrome>{children}</AuthenticatedChrome>
            </Suspense>
          </TooltipProvider>
        </PaletteProvider>
      </body>
    </html>
  )
}
