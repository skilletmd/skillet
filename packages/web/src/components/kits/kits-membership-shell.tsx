'use client'

import type { ReactNode } from 'react'
import { useSession } from 'next-auth/react'
import type { MeBootstrap } from '@/lib/me-bootstrap'
import { MyKitsProvider } from '@/components/kits/my-kits-context'
import { FollowedCurationsProvider } from '@/components/kits/followed-curations-context'
import { FollowsProvider } from '@/components/follows-context'
import { AddIntentHandler } from '@/components/add-intent-handler'

export function KitsMembershipShell({
  children,
  bootstrap,
}: {
  children: ReactNode
  bootstrap?: MeBootstrap | null
}) {
  const { data: session } = useSession()
  if (!session?.handle) return children

  return (
    <MyKitsProvider
      initial={bootstrap ? { viewerHandle: bootstrap.viewerHandle, kits: bootstrap.kits } : null}
    >
      <FollowedCurationsProvider initialCurations={bootstrap?.curations}>
        <FollowsProvider initial={bootstrap?.following}>
          {/* Replays a logged-out "Add" once the user returns authenticated. */}
          <AddIntentHandler />
          {children}
        </FollowsProvider>
      </FollowedCurationsProvider>
    </MyKitsProvider>
  )
}
