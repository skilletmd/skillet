import { Suspense } from 'react'
import { headers } from 'next/headers'
import { KitsMembershipShell } from '@/components/kits/kits-membership-shell'
import { ConnectActivation } from '@/components/connect-activation'
import { getMeBootstrap } from '@/lib/me-bootstrap'
import { getSession } from '@/lib/get-session'
import { isBrowsePathname } from '@/lib/browse-pathname'
import {
  BROWSE_SSR_RID_HEADER,
  browseSsrLog,
  browseSsrSpan,
  withBrowseSsrProbe,
} from '@/lib/browse-ssr-probe'

async function ConsumerMembership({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const h = await headers()
  const rid = h.get(BROWSE_SSR_RID_HEADER) ?? undefined

  return withBrowseSsrProbe(async () => {
    const pathname = h.get('x-pathname') ?? ''
    const deferBootstrap = isBrowsePathname(pathname)
    browseSsrLog('layout_enter', { pathname: pathname || '(none)', deferBootstrap })

    const session = await browseSsrSpan('layout_session', () => getSession())
    browseSsrLog('layout_session_shape', {
      has_handle: Boolean(session?.handle),
      deferBootstrap,
    })

    // Browse skips membership bootstrap await — KitsMembershipShell lazy-loads
    // kits/follows after paint (shell-first). Other consumer routes keep SSR seed.
    let bootstrap = null
    if (!deferBootstrap && session?.handle) {
      bootstrap = await browseSsrSpan('layout_bootstrap', () =>
        getMeBootstrap(session.handle!),
      )
    } else {
      browseSsrLog('layout_bootstrap_skip', {
        reason: deferBootstrap ? 'browse_path' : 'anon',
      })
    }

    browseSsrLog('layout_done', { deferBootstrap, bootstrapped: Boolean(bootstrap) })
    return <KitsMembershipShell bootstrap={bootstrap}>{children}</KitsMembershipShell>
  }, rid)
}

// We scope the home marketing palette (navy ink, #635bff accent) to consumer
// routes via body:has(.marketing-home) in globals.css. The kits membership
// provider is mounted here so the add-to-kit control works on every consumer
// page a skill card shows up on (directory, studio, profile).
export default function ConsumerLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="marketing-home min-h-full">
      <Suspense fallback={children}>
        <ConsumerMembership>{children}</ConsumerMembership>
      </Suspense>
      {/* Inert until an add/pill/`?connect=1` opens it; its own checks keep the
          real prompt logged-in-only, so it's safe to always mount. */}
      <Suspense fallback={null}>
        <ConnectActivation />
      </Suspense>
    </div>
  )
}
