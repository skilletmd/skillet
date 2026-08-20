import type { Metadata } from 'next'
import { Suspense } from 'react'
import { cookies } from 'next/headers'
import { requireSession } from '@/lib/require-session'
import { readSessionCookie } from '@/lib/session-cookie'
import { REGISTRY_API } from '@/lib/registry-prefix'
import { markDynamicRoute } from '@/lib/mark-dynamic-route'
import { PageHeader } from '@/components/page-header'
import { Notice } from '@/components/ui/notice'
import { ActivityFeed, type ActivityEvent } from './activity-feed'

export const metadata: Metadata = {
  title: 'Activity - Skillet',
  robots: { index: false, follow: false },
}

function registryUrl(): string {
  return process.env.REGISTRY_URL ?? process.env.NEXT_PUBLIC_REGISTRY_URL ?? 'http://127.0.0.1:3481'
}

type Result = { ok: true; events: ActivityEvent[] } | { ok: false; status: number }

async function fetchActivity(sessionToken: string): Promise<Result> {
  const res = await fetch(`${registryUrl()}${REGISTRY_API}/admin/activity`, {
    headers: { authorization: `Bearer ${sessionToken}`, accept: 'application/json' },
    cache: 'no-store',
  })
  if (!res.ok) return { ok: false, status: res.status }
  const body = (await res.json().catch(() => null)) as { events?: ActivityEvent[] } | null
  return { ok: true, events: body?.events ?? [] }
}

async function ActivityContent() {
  await markDynamicRoute()
  // Edge-gated by proxy.ts → adminProxyGate; this ensures a session for the token read.
  await requireSession('/admin/log')
  const jar = await cookies()
  const sessionToken = readSessionCookie(jar)
  const result = sessionToken
    ? await fetchActivity(sessionToken)
    : ({ ok: false, status: 401 } as Result)

  if (!result.ok) {
    return (
      <div>
        <PageHeader title="Activity" lede="Recent signups and new skills." />
        <Notice tone="danger">
          Couldn’t load activity (registry responded {result.status}). This is a fetch error. Try
          again.
        </Notice>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Activity"
        lede="Recent account signups and new skills. Private skills show their author for abuse monitoring, but never the skill itself."
      />
      <ActivityFeed events={result.events} />
    </div>
  )
}

export default function ActivityPage() {
  return (
    <Suspense fallback={null}>
      <ActivityContent />
    </Suspense>
  )
}
