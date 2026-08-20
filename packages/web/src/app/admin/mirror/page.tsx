import type { Metadata } from 'next'
import { Suspense } from 'react'
import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { requireSession } from '@/lib/require-session'
import { readSessionCookie } from '@/lib/session-cookie'
import { REGISTRY_API } from '@/lib/registry-prefix'
import { markDynamicRoute } from '@/lib/mark-dynamic-route'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/page-header'
import { SettingsSection } from '@/components/ui/setting-section'
import { Notice } from '@/components/ui/notice'

export const metadata: Metadata = {
  title: 'Mirror Queue - Skillet',
  robots: { index: false, follow: false },
}

interface Candidate {
  id: string
  source_repo: string
  derived_handle: string | null
  owner_type: string | null
  license: string | null
  status: string
  screen_notes: string | null
  decided_at: number | null
  created_at: number
}

function registryUrl(): string {
  return process.env.REGISTRY_URL ?? process.env.NEXT_PUBLIC_REGISTRY_URL ?? 'http://127.0.0.1:3481'
}

type QueueResult =
  | { ok: true; pending: Candidate[]; recent: Candidate[] }
  | { ok: false; status: number }

async function fetchQueue(sessionToken: string): Promise<QueueResult> {
  const res = await fetch(`${registryUrl()}${REGISTRY_API}/admin/mirror-queue`, {
    headers: { authorization: `Bearer ${sessionToken}`, accept: 'application/json' },
    cache: 'no-store',
  })
  // A non-OK response is an error to surface, NOT an empty queue — collapsing the
  // two is what let a 403 masquerade as "Nothing pending."
  if (!res.ok) return { ok: false, status: res.status }
  const body = (await res.json().catch(() => null)) as {
    pending?: Candidate[]
    recent?: Candidate[]
  } | null
  return { ok: true, pending: body?.pending ?? [], recent: body?.recent ?? [] }
}

/** Forward an admin decision to the registry, then refresh the view. */
async function decide(id: string, decision: 'approve' | 'reject'): Promise<void> {
  'use server'
  const jar = await cookies()
  const sessionToken = readSessionCookie(jar)
  if (!sessionToken) return
  const res = await fetch(`${registryUrl()}${REGISTRY_API}/admin/mirror-queue/${id}/decide`, {
    method: 'POST',
    headers: { authorization: `Bearer ${sessionToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ decision }),
  })
  // Surface a failed decision (403/404/5xx) instead of silently looking successful.
  if (!res.ok) {
    throw new Error(`mirror decision failed for ${id} (${decision}): ${res.status}`)
  }
  revalidatePath('/admin/mirror')
}

function GithubSource({ repo }: { repo: string }) {
  return (
    <a
      href={`https://github.com/${repo}`}
      target="_blank"
      rel="noopener"
      className="underline-offset-2 hover:underline"
    >
      {repo}
    </a>
  )
}

/** Outcome badge for a decided row: what actually happened, at a glance. */
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    live: { label: 'Live mirror', cls: 'bg-(--success-bg) text-(--success)' },
    rejected: { label: 'Rejected', cls: 'bg-(--line) text-(--ink-2)' },
    rejected_screen: { label: 'Screen failed', cls: 'bg-(--danger-bg) text-(--danger)' },
  }
  const { label, cls } = map[status] ?? { label: status, cls: 'bg-(--line) text-(--ink-2)' }
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${cls}`}>{label}</span>
  )
}

function decidedWhen(ts: number | null): string {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleString()
}

async function MirrorQueueContent() {
  await markDynamicRoute()
  // Page access is gated at the edge by proxy.ts → adminProxyGate (staff handle
  // allowlist); this just ensures a session is present for the token read below.
  await requireSession('/admin/mirror')
  const jar = await cookies()
  const sessionToken = readSessionCookie(jar)
  const result = sessionToken
    ? await fetchQueue(sessionToken)
    : ({ ok: false, status: 401 } as QueueResult)

  if (!result.ok) {
    return (
      <div>
        <PageHeader
          title="Mirror queue"
          lede="Review mirrored-skill candidates from discovery."
        />
        <Notice tone="danger">
          Couldn’t load the review queue (registry responded {result.status}). This is a fetch
          error, not an empty queue. Try again.
        </Notice>
      </div>
    )
  }

  const { pending, recent } = result

  return (
    <div>
      <PageHeader
        title="Mirror queue"
        lede="Approving re-screens the live source and publishes a reserved, claimable mirror; the real owner still claims it via GitHub."
      />

      <div className="space-y-10">
        <SettingsSection
          title="Pending"
          description={`${pending.length} awaiting review.`}
        >
          {/* The drain list with actions. */}
          {pending.length === 0 ? (
            <p className="text-sm text-(--ink-2)">Nothing pending.</p>
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-(--line) text-left text-(--ink-2)">
              <th className="pb-2 font-medium">Handle</th>
              <th className="pb-2 font-medium">Source</th>
              <th className="pb-2 font-medium">Type</th>
              <th className="pb-2 font-medium">License</th>
              <th className="pb-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {pending.map((c) => (
              <tr key={c.id} className="border-b border-(--line)">
                <td className="py-3 pr-4 font-medium">@{c.derived_handle ?? '—'}</td>
                <td className="py-3 pr-4 text-(--ink-2)">
                  <GithubSource repo={c.source_repo} />
                </td>
                <td className="py-3 pr-4 text-(--ink-2)">{c.owner_type ?? '—'}</td>
                <td className="py-3 pr-4 text-(--ink-2)">{c.license ?? '—'}</td>
                <td className="py-3">
                  <div className="flex items-center gap-3">
                    <form action={decide.bind(null, c.id, 'approve')}>
                      <Button type="submit" variant="primary">
                        Approve
                      </Button>
                    </form>
                    <form action={decide.bind(null, c.id, 'reject')}>
                      <Button type="submit" variant="tertiary">
                        Reject
                      </Button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
            </div>
      )}
        </SettingsSection>

        {/* Recent decisions — the outcome of every approve/reject, so a decision is
            never a black box (live vs rejected, with the reason). */}
        <SettingsSection title="Recent decisions">
      {recent.length === 0 ? (
        <p className="text-sm text-(--ink-2)">No decisions yet.</p>
      ) : (
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-(--line) text-left text-(--ink-2)">
              <th className="pb-2 font-medium">Handle</th>
              <th className="pb-2 font-medium">Source</th>
              <th className="pb-2 font-medium">Outcome</th>
              <th className="pb-2 font-medium">Reason</th>
              <th className="pb-2 font-medium">Decided</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((c) => (
              <tr key={c.id} className="border-b border-(--line) align-top">
                <td className="py-3 pr-4 font-medium">@{c.derived_handle ?? '—'}</td>
                <td className="py-3 pr-4 text-(--ink-2)">
                  <GithubSource repo={c.source_repo} />
                </td>
                <td className="py-3 pr-4">
                  <StatusBadge status={c.status} />
                </td>
                <td className="py-3 pr-4 text-(--ink-2)">{c.screen_notes ?? '—'}</td>
                <td className="py-3 pr-4 whitespace-nowrap text-(--ink-2)">
                  {decidedWhen(c.decided_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
        </SettingsSection>
      </div>
    </div>
  )
}

export default function MirrorQueuePage() {
  return (
    <Suspense fallback={null}>
      <MirrorQueueContent />
    </Suspense>
  )
}
