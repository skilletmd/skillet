import type { Metadata } from 'next'
import { Suspense } from 'react'
import { REGISTRY_API } from '@/lib/registry-prefix'
import { markDynamicRoute } from '@/lib/mark-dynamic-route'

export const metadata: Metadata = {
  title: 'Moderation log - Skillet',
  description: 'Skills currently under an enforcement action, and why.',
}

interface ModerationEntry {
  author: string
  slug: string
  status: string
  public_reason: string | null
  acted_at: number | null
}

function registryUrl(): string {
  return process.env.REGISTRY_URL ?? process.env.NEXT_PUBLIC_REGISTRY_URL ?? 'http://127.0.0.1:3481'
}

type LogResult = { ok: true; entries: ModerationEntry[] } | { ok: false; status: number }

async function fetchLog(): Promise<LogResult> {
  const res = await fetch(`${registryUrl()}${REGISTRY_API}/moderation`, {
    headers: { accept: 'application/json' },
    cache: 'no-store',
  })
  if (!res.ok) return { ok: false, status: res.status }
  const body = (await res.json().catch(() => null)) as { entries?: ModerationEntry[] } | null
  return { ok: true, entries: body?.entries ?? [] }
}

function statusLabel(status: string): { label: string; cls: string } {
  switch (status) {
    case 'quarantined':
      return { label: 'Quarantined', cls: 'bg-(--danger-bg) text-(--danger)' }
    case 'unlisted':
      return { label: 'Unlisted', cls: 'bg-(--line) text-(--ink-2)' }
    default:
      return { label: status, cls: 'bg-(--line) text-(--ink-2)' }
  }
}

function actedWhen(ts: number | null): string {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleDateString()
}

async function ModerationLogContent() {
  await markDynamicRoute()
  const result = await fetchLog()
  return <ModerationLogView result={result} />
}

/** Pure presentational view — exported so tests can drive every state (error,
 *  empty, populated) without mocking fetch or the registry. */
export function ModerationLogView({ result }: { result: LogResult }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-2xl font-bold tracking-tight">Moderation log</h1>
      <p className="mt-1 text-sm text-(--ink-2)">
        We build in the open. This lists every skill currently under an enforcement action. When an
        action is reversed, the skill drops off this list.
      </p>

      {!result.ok ? (
        <p className="mt-8 text-sm text-(--danger)">
          Couldn’t load the moderation log (registry responded {result.status}). Try again.
        </p>
      ) : result.entries.length === 0 ? (
        <p className="mt-8 text-sm text-(--ink-2)">No active enforcement actions.</p>
      ) : (
        <ul className="mt-8 space-y-4">
          {result.entries.map((e) => {
            const { label, cls } = statusLabel(e.status)
            return (
              <li
                key={`${e.author}/${e.slug}`}
                className="flex flex-wrap items-baseline justify-between gap-2 border-b border-(--line) pb-4"
              >
                <div>
                  <a href={`/${e.author}/${e.slug}`} className="font-medium hover:underline">
                    {e.author}/{e.slug}
                  </a>
                  {e.public_reason ? (
                    <p className="mt-1 text-sm text-(--ink-2)">{e.public_reason}</p>
                  ) : null}
                </div>
                <div className="flex items-center gap-3 text-sm text-(--ink-3)">
                  <span className={`rounded px-2 py-0.5 text-xs font-semibold ${cls}`}>{label}</span>
                  <span className="whitespace-nowrap">{actedWhen(e.acted_at)}</span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}

export default function ModerationLogPage() {
  return (
    <Suspense fallback={null}>
      <ModerationLogContent />
    </Suspense>
  )
}
