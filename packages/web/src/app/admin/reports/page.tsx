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
import { Notice } from '@/components/ui/notice'

export const metadata: Metadata = {
  title: 'Report Queue - Skillet',
  robots: { index: false, follow: false },
}

interface ReportRow {
  id: string
  category: string
  reason: string | null
  claims_ownership: number | null
  version_hash: string | null
  created_at: number
}

interface ReportGroup {
  skill_id: string
  author: string
  slug: string
  moderation_status: string
  report_count: number
  latest_at: number
  categories: string[]
  reports: ReportRow[]
}

function registryUrl(): string {
  return process.env.REGISTRY_URL ?? process.env.NEXT_PUBLIC_REGISTRY_URL ?? 'http://127.0.0.1:3481'
}

interface ModAction {
  id: string
  skill_id: string
  author: string
  slug: string
  action: string
  public_reason: string | null
  acted_by_handle: string | null
  moderation_status: string
  created_at: number
}

type QueueResult = { ok: true; groups: ReportGroup[] } | { ok: false; status: number }

async function fetchQueue(sessionToken: string): Promise<QueueResult> {
  const res = await fetch(`${registryUrl()}${REGISTRY_API}/admin/reports`, {
    headers: { authorization: `Bearer ${sessionToken}`, accept: 'application/json' },
    cache: 'no-store',
  })
  if (!res.ok) return { ok: false, status: res.status }
  const body = (await res.json().catch(() => null)) as { groups?: ReportGroup[] } | null
  return { ok: true, groups: body?.groups ?? [] }
}

/** Recent enforcement ledger, newest first. Soft-fails to [] — the queue is the
 *  primary surface, so a ledger fetch error shouldn't blank the whole page. */
async function fetchRecent(sessionToken: string): Promise<ModAction[]> {
  const res = await fetch(`${registryUrl()}${REGISTRY_API}/admin/moderation/recent`, {
    headers: { authorization: `Bearer ${sessionToken}`, accept: 'application/json' },
    cache: 'no-store',
  })
  if (!res.ok) return []
  const body = (await res.json().catch(() => null)) as { actions?: ModAction[] } | null
  return body?.actions ?? []
}

/** Resolve a report group: dismiss every report, or enforce (quarantine/unlist)
 *  once for the skill. The public reason is read from the form. */
async function act(
  reportId: string,
  reportIds: string[],
  disposition: 'dismiss' | 'quarantine' | 'unlist',
  formData: FormData,
): Promise<void> {
  'use server'
  const jar = await cookies()
  const sessionToken = readSessionCookie(jar)
  if (!sessionToken) return
  const headers = {
    authorization: `Bearer ${sessionToken}`,
    'content-type': 'application/json',
  }

  if (disposition === 'dismiss') {
    for (const id of reportIds) {
      const res = await fetch(`${registryUrl()}${REGISTRY_API}/admin/reports/${id}/resolve`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ disposition: 'dismiss' }),
      })
      if (!res.ok) throw new Error(`dismiss failed for ${id}: ${res.status}`)
    }
  } else {
    const publicReason = String(formData.get('public_reason') ?? '').trim()
    const res = await fetch(`${registryUrl()}${REGISTRY_API}/admin/reports/${reportId}/resolve`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ disposition, public_reason: publicReason || undefined }),
    })
    if (!res.ok) throw new Error(`${disposition} failed for ${reportId}: ${res.status}`)
  }
  revalidatePath('/admin/reports')
}

/** Reverse an enforcement (unquarantine / relist) straight from the queue. */
async function undo(skillId: string, reverseAction: 'unquarantine' | 'relist'): Promise<void> {
  'use server'
  const jar = await cookies()
  const sessionToken = readSessionCookie(jar)
  if (!sessionToken) return
  const res = await fetch(`${registryUrl()}${REGISTRY_API}/admin/skills/${skillId}/reverse`, {
    method: 'POST',
    headers: { authorization: `Bearer ${sessionToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ action: reverseAction }),
  })
  if (!res.ok) throw new Error(`undo failed for ${skillId}: ${res.status}`)
  revalidatePath('/admin/reports')
}

const ACTION_LABEL: Record<string, string> = {
  quarantine: 'Quarantined',
  unlist: 'Unlisted',
  unquarantine: 'Unquarantined',
  relist: 'Relisted',
}

function reportedWhen(ts: number): string {
  return new Date(ts * 1000).toLocaleString()
}

async function ReportQueueContent() {
  await markDynamicRoute()
  // Edge-gated by proxy.ts → adminProxyGate; this ensures a session for the token read.
  await requireSession('/admin/reports')
  const jar = await cookies()
  const sessionToken = readSessionCookie(jar)
  const [result, recent] = sessionToken
    ? await Promise.all([fetchQueue(sessionToken), fetchRecent(sessionToken)])
    : ([{ ok: false, status: 401 }, []] as [QueueResult, ModAction[]])

  if (!result.ok) {
    return (
      <div>
        <PageHeader title="Reports" lede="Triage reported skills and moderation actions." />
        <Notice tone="danger">
          Couldn’t load the report queue (registry responded {result.status}). This is a fetch
          error, not an empty queue. Try again.
        </Notice>
      </div>
    )
  }

  const { groups } = result

  return (
    <div>
      <PageHeader
        title="Reports"
        lede="Quarantine blocks downloads; unlist hides from discovery. Both show on the public moderation log and are reversible."
        action={
          <Button href="/moderation" variant="secondary">
            Moderation log
          </Button>
        }
      />

      {groups.length === 0 ? (
        <p className="text-sm text-(--ink-2)">No open reports.</p>
      ) : (
      <div className="space-y-6">
        {groups.map((g) => {
          const reportIds = g.reports.map((r) => r.id)
          return (
            <section
              key={g.skill_id}
              className="rounded-2xl border border-(--line) bg-(--surface) p-5"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-lg font-semibold">
                  <a href={`/${g.author}/${g.slug}`} className="hover:underline">
                    {g.author}/{g.slug}
                  </a>
                </h2>
                <span className="text-sm text-(--ink-2)">
                  {g.report_count} report{g.report_count === 1 ? '' : 's'} ·{' '}
                  {g.categories.join(', ')}
                  {g.moderation_status !== 'none' ? ` · ${g.moderation_status}` : ''}
                </span>
              </div>

              <ul className="mt-3 space-y-2 text-sm">
                {g.reports.map((r) => (
                  <li key={r.id} className="border-t border-(--line) pt-2 text-(--ink-2)">
                    <span className="font-medium text-(--ink)">{r.category}</span>
                    {r.claims_ownership ? ' · ownership claimed' : ''} ·{' '}
                    {reportedWhen(r.created_at)}
                    {r.reason ? <p className="mt-1">{r.reason}</p> : null}
                  </li>
                ))}
              </ul>

              <form className="mt-4 flex flex-wrap items-center gap-3">
                <input
                  name="public_reason"
                  placeholder="Public reason (shown on moderation log)"
                  className="min-w-[16rem] flex-1 rounded-lg border border-(--line) bg-(--surface) px-3 py-1.5 text-sm"
                />
                <Button type="submit" variant="tertiary" formAction={act.bind(null, reportIds[0], reportIds, 'dismiss')}>
                  Dismiss
                </Button>
                <Button
                  type="submit"
                  variant="secondary"
                  formAction={act.bind(null, reportIds[0], reportIds, 'unlist')}
                >
                  Unlist
                </Button>
                <Button
                  type="submit"
                  variant="danger-secondary"
                  formAction={act.bind(null, reportIds[0], reportIds, 'quarantine')}
                >
                  Quarantine
                </Button>
              </form>
            </section>
          )
        })}
      </div>
      )}

      {recent.length > 0 ? (
        <section className="mt-10">
          <h2 className="text-sm font-semibold text-(--ink)">Recent actions</h2>
          <p className="mt-1 text-sm text-(--ink-2)">
            The enforcement log. Undo returns a skill to normal and drops it off the public log.
          </p>
          <ul className="mt-4 divide-y divide-(--line) rounded-2xl border border-(--line) bg-(--surface)">
            {(() => {
              const seen = new Set<string>()
              return recent.map((a) => {
                const isLatestForSkill = !seen.has(a.skill_id)
                seen.add(a.skill_id)
                const undoable =
                  isLatestForSkill &&
                  ((a.action === 'quarantine' && a.moderation_status === 'quarantined') ||
                    (a.action === 'unlist' && a.moderation_status === 'unlisted'))
                const reverseAction = a.action === 'quarantine' ? 'unquarantine' : 'relist'
                const reversed =
                  (a.action === 'quarantine' || a.action === 'unlist') &&
                  a.moderation_status === 'none'
                return (
                  <li
                    key={a.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
                  >
                    <div className="min-w-0">
                      <span className="font-medium text-(--ink)">
                        {ACTION_LABEL[a.action] ?? a.action}
                      </span>{' '}
                      <a href={`/${a.author}/${a.slug}`} className="text-(--ink-2) hover:underline">
                        {a.author}/{a.slug}
                      </a>
                      <span className="text-(--ink-2)">
                        {' · '}
                        {reportedWhen(a.created_at)}
                        {a.acted_by_handle ? ` · by ${a.acted_by_handle}` : ''}
                      </span>
                      {a.public_reason ? (
                        <p className="mt-0.5 text-(--ink-2)">{a.public_reason}</p>
                      ) : null}
                    </div>
                    {undoable ? (
                      <form>
                        <Button
                          type="submit"
                          variant="secondary"
                          formAction={undo.bind(null, a.skill_id, reverseAction)}
                        >
                          Undo
                        </Button>
                      </form>
                    ) : reversed ? (
                      <span className="text-xs text-(--ink-2)">Reversed</span>
                    ) : null}
                  </li>
                )
              })
            })()}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

export default function ReportQueuePage() {
  return (
    <Suspense fallback={null}>
      <ReportQueueContent />
    </Suspense>
  )
}
