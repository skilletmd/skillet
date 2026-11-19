import type { Metadata } from 'next'
import { isMapSessionId } from '@/app/api/map-sessions/map-session-guard'
import { ChooseUsername } from '@/components/choose-username'
import { SaveFlow, SaveTab, type SaveTabView } from '@/components/map/save-flow'
import type { MapSaveResult } from '@/components/map/save-types'
import { getSession } from '@/lib/get-session'

// skillet.md/map/save: the tab Save opens from the framed map on a computer that
// isn't connected yet (kit map onboarding, KTD6). The render reads no binding:
// that cookie is Strict and scoped to /api/map-sessions/<id>, so it never rides
// this request, and the tab asks the binding route itself once it loads.
// proxy.ts keeps this page's X-Frame-Options DENY and frame-ancestors 'none', so
// the confirm can't be framed.

export const metadata: Metadata = {
  title: 'Save your map · Skillet',
  robots: { index: false, follow: false },
}

export default async function MapSavePage({
  searchParams,
}: {
  searchParams: Promise<{ s?: string | string[]; demo?: string | string[] }>
}) {
  const sp = await searchParams
  const session = typeof sp.s === 'string' && isMapSessionId(sp.s) ? sp.s : null

  // `?demo=<state>` draws one state with fixtures for visual checks: dev only,
  // and only with no session id, so it can never stand in for a real save.
  if (session === null && process.env.NODE_ENV !== 'production' && typeof sp.demo === 'string') {
    const view = demoView(sp.demo)
    if (view) return <SaveTab view={view} usernameStep={<ChooseUsername />} />
  }

  const auth = await getSession()
  return (
    <SaveFlow
      session={session}
      viewer={{ signedIn: Boolean(auth?.user), handle: auth?.handle ?? null }}
      usernameStep={<ChooseUsername />}
    />
  )
}

const LABEL = 'test-machine'
const COUNTS = { backups: 21, removals: 2, fills: 3, merges: 1 }
const DONE: MapSaveResult = {
  result: 'applied',
  counts: COUNTS,
  left: null,
  notBackedUp: [{ name: 'Deploy Notes', reason: 'secret', file: '.env.local' }],
}

function demoView(state: string): SaveTabView | null {
  switch (state) {
    case 'loading':
    case 'unbound':
    case 'signing-in':
    case 'username':
    case 'error':
      return { kind: state }
    case 'confirm':
    case 'approving':
      return { kind: 'confirm', label: LABEL, handle: 'sample', counts: COUNTS, busy: state === 'approving', error: null }
    case 'approve-error':
      return {
        kind: 'confirm',
        label: LABEL,
        handle: 'sample',
        counts: COUNTS,
        busy: false,
        error: "Couldn't reach Skillet. Nothing was saved. Try again.",
      }
    case 'approved':
    case 'slow':
    case 'connected':
    case 'stalled':
      return { kind: 'saving', label: LABEL, step: state }
    case 'saved':
      return { kind: 'saved', result: DONE }
    case 'partial':
      return {
        kind: 'partial',
        result: { result: 'partial', counts: { ...COUNTS, removals: 0 }, left: { backups: 0, removals: 2, fills: 0, merges: 0 }, notBackedUp: [] },
      }
    case 'failed':
      return { kind: 'failed', result: { result: 'failed', counts: null, left: COUNTS, notBackedUp: [] } }
    case 'expired':
      return { kind: 'expired', reason: 'not-approved' }
    case 'code-unused':
      return { kind: 'expired', reason: 'code-unused' }
    default:
      return null
  }
}
