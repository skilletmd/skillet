import type { Metadata } from 'next'
import { Suspense } from 'react'
import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { requireSession } from '@/lib/require-session'
import { readSessionCookie } from '@/lib/session-cookie'
import { REGISTRY_API } from '@/lib/registry-prefix'
import { markDynamicRoute } from '@/lib/mark-dynamic-route'
import { AddMirrorForm } from './add-mirror-form'
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

/**
 * Pull the numbers out of the screening note discovery already wrote.
 *
 * The note is machine-generated with a stable prefix
 * ("quality 84/100 across 24 skills — ..."), so parsing it is safe enough to
 * sort and rank by. It was being rendered only in Recent decisions, which meant
 * the page showed its reasoning AFTER a decision and hid it on Pending, where
 * every row read "User, MIT" and there was nothing to choose on.
 *
 * Returns nulls rather than throwing: a hand-submitted row, or a note whose
 * shape changes later, still lists — it just sorts last.
 */
function screenSummary(notes: string | null): {
  score: number | null
  skills: number | null
  stars: number | null
  weakest: string | null
} {
  if (!notes) return { score: null, skills: null, stars: null, weakest: null }
  const head = /^quality (\d+)\/100 across (\d+) skills/.exec(notes)
  const stars = /stars ([\d,]+):/.exec(notes)
  // The lowest-scoring component is the reason to look closer, so surface that
  // one rather than making the reviewer read six clauses.
  let weakest: string | null = null
  let worstRatio = 1.1
  for (const m of notes.matchAll(/([^;—]+?):\s*(\d+)\/(\d+)/g)) {
    const got = Number(m[2])
    const max = Number(m[3])
    if (!max) continue
    const ratio = got / max
    if (ratio < worstRatio) {
      worstRatio = ratio
      // Strip the value the label carries, or the line reads as two numbers
      // with no separator: the note says "stars 5: 0/5", meaning 5 stars scoring
      // 0 of 5 points, which rendered as "stars 5 0/5". The parenthetical goes
      // for the same reason ("provenance (User, 237d old, pushed 0d ago)" wrapped
      // to three lines). Both values are already on the row or in the full
      // breakdown on hover; this line only needs to name the component and its score.
      const label = m[1]
          .trim()
          .replace(/\s*\([^)]*\)/, '')
          .replace(/\s+[\d,]+$/, '')
      weakest = `${label} ${got}/${max}`
    }
  }
  return {
    score: head ? Number(head[1]) : null,
    skills: head ? Number(head[2]) : null,
    stars: stars ? Number(stars[1].replace(/,/g, '')) : null,
    weakest: worstRatio < 0.75 ? weakest : null,
  }
}

function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) return <span className="text-(--ink-2)">—</span>
  // Bands, not a gradient: the number is a screen, not a verdict, and three
  // buckets is all a reviewer acts on.
  const cls =
    score >= 85
      ? 'bg-(--success-bg) text-(--success)'
      : score >= 70
        ? 'bg-(--accent-bg) text-(--ink)'
        : 'bg-(--line) text-(--ink-2)'
  return (
    <span className={`inline-flex rounded-md px-1.5 py-0.5 font-mono text-xs font-semibold ${cls}`}>
      {score}
    </span>
  )
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
/**
 * Queue a repo by URL.
 *
 * The alternative was editing mirror-sources.json (up to 11 fields, most of
 * them answerable from the GitHub API), committing, deploying, and waiting for
 * the nightly. This runs the same screen discovery runs, so the row lands in
 * the same list with the same notes and still needs an explicit approve.
 *
 * Errors come back as text rather than a thrown 500: "already queued as live"
 * and "no permissive license" are answers, not faults.
 */
async function submitUrl(_prev: string | null, form: FormData): Promise<string | null> {
  'use server'
  const url = String(form.get('url') ?? '').trim()
  if (!url) return null
  const jar = await cookies()
  const sessionToken = readSessionCookie(jar)
  if (!sessionToken) return 'Not signed in.'
  const res = await fetch(`${registryUrl()}${REGISTRY_API}/admin/mirror-queue`, {
    method: 'POST',
    headers: { authorization: `Bearer ${sessionToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
  })
  const body = (await res.json().catch(() => null)) as
    | { repo?: string; status?: string; message?: string }
    | null
  if (!res.ok) return body?.message ?? `Could not add it (registry responded ${res.status}).`
  revalidatePath('/admin/mirror')
  return body?.status === 'rejected_screen'
    ? `${body?.repo} failed the screen and was recorded as rejected.`
    : `${body?.repo} added, awaiting review below.`
}

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

  const { pending: unsorted, recent } = result
  // Best first. 64 rows that all read "User, MIT" is a list you scroll past;
  // ranked by the screen discovery already ran, the top of the list is the work
  // and the bottom is the pile you can leave. Unscored rows sort last rather
  // than jumping the queue on a missing value.
  const pending = [...unsorted].sort(
    (a, b) => (screenSummary(b.screen_notes).score ?? -1) - (screenSummary(a.screen_notes).score ?? -1),
  )

  return (
    <div>
      <PageHeader
        title="Mirror queue"
        lede="Approving re-screens the live source and publishes a reserved, claimable mirror; the real owner still claims it via GitHub."
      />

      <div className="space-y-10">
        <SettingsSection
          title="Add a source"
          description="Paste a GitHub repo URL. It runs the same screen discovery runs and lands in the queue below."
        >
          <AddMirrorForm action={submitUrl} />
        </SettingsSection>

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
              <th className="pb-2 font-medium">Quality</th>
              <th className="pb-2 font-medium">Handle</th>
              <th className="pb-2 font-medium">Source</th>
              <th className="pb-2 font-medium">Skills</th>
              <th className="pb-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {pending.map((c) => {
              const s = screenSummary(c.screen_notes)
              return (
              <tr key={c.id} className="border-b border-(--line) align-top">
                <td className="py-3 pr-4" title={c.screen_notes ?? undefined}>
                  <ScoreBadge score={s.score} />
                </td>
                {/* Type under the handle, license beside the stars: both are
                    one short fact per row, and a column each cost more width
                    than they earned. */}
                <td className="py-3 pr-4 font-medium">
                  @{c.derived_handle ?? '—'}
                  <span className="mt-0.5 block text-xs font-normal text-(--ink-2)">
                    {c.owner_type ?? '—'}
                  </span>
                  {/* The lowest component of the screen, so the reason to look
                      closer travels with the row instead of living in a tooltip
                      nobody hovers. */}
                  {s.weakest && (
                    <span className="mt-0.5 block text-xs font-normal text-(--ink-2)">
                      weakest: {s.weakest}
                    </span>
                  )}
                </td>
                <td className="py-3 pr-4 text-(--ink-2)">
                  <GithubSource repo={c.source_repo} />
                  <span className="mt-0.5 block text-xs">
                    {[s.stars != null ? `${s.stars.toLocaleString()} stars` : null, c.license]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </td>
                <td className="py-3 pr-4 text-(--ink-2)">{s.skills ?? '—'}</td>
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
              )
            })}
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
