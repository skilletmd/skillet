'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Notice } from '@/components/ui/notice'
import { Shimmer } from '@/components/ui/shimmer'
import { SettingsList } from '@/components/ui/settings-list'
import { SettingRow } from '@/components/ui/setting-row'
import { SettingsSection } from '@/components/ui/setting-section'
import { ToggleSwitch } from '@/components/ui/toggle-switch'
import { fetchRegistryWithRetry, registryAuthApi } from '@/lib/registry-proxy'
import { CoverArt } from '@/components/cover/cover'
import { UsageChart, bucketRouteTs, sampleDays } from '@/components/settings/usage-chart'
import { AgentGlyph } from '@/components/agent-glyph'
import { runtimeLabel } from '@/lib/runtime-labels'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { DialogFooter } from '@/components/ui/dialog-footer'

interface UsageSkill {
  skill_ref: string
  count: number
  /** Most-recent route for this skill, epoch seconds. */
  last_ts: number
  /** Browse category, for the cover palette. Null on older registries. */
  category?: string | null
}

interface RouteUsageResponse {
  recording: boolean
  skills: UsageSkill[]
  runtimes: string[]
  /** Route timestamps (epoch seconds, last 30 days) for the per-day chart. Absent on older registries. */
  route_ts?: number[]
}

export interface ParsedRouteUsage {
  recording: boolean
  skills: UsageSkill[]
  runtimes: string[]
  routeTs: number[]
}

/**
 * Fail-safe parse of the `/me/route-usage` body into the panel's ready-state
 * fields. `recording` is a privacy control, so it fails **closed**: on only when
 * the server explicitly says `recording: true`. A missing field, a non-boolean,
 * a non-object body (null / array / string), or non-array collections all read
 * as recording-off with empty data. This function never throws, so a malformed
 * body can only ever surface as recording-off — never the error state (a network
 * failure or unparseable JSON is the separate error path in `load`).
 */
export function parseRouteUsage(body: unknown): ParsedRouteUsage {
  const b = (body && typeof body === 'object' ? body : {}) as Partial<RouteUsageResponse>
  return {
    recording: b.recording === true,
    skills: Array.isArray(b.skills) ? b.skills : [],
    runtimes: Array.isArray(b.runtimes)
      ? b.runtimes.filter((r): r is string => typeof r === 'string')
      : [],
    routeTs: Array.isArray(b.route_ts)
      ? b.route_ts.filter((n): n is number => typeof n === 'number')
      : [],
  }
}

/** Short relative label from an epoch-**seconds** timestamp. */
function lastUsedLabel(tsSeconds: number): string {
  const ms = Date.now() - tsSeconds * 1000
  if (!Number.isFinite(ms) || ms < 0) return ''
  const days = Math.floor(ms / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

// Dev-only preview data for the populated tally (the "Preview sample data"
// button below) — never rendered in production builds.
const SAMPLE_SKILLS: UsageSkill[] = [
  { skill_ref: '@vercel/deploy-to-vercel', count: 14, last_ts: Math.floor(Date.now() / 1000) - 2 * 3600, category: 'deploy' },
  { skill_ref: '@grace-reviews/pr-review-strict', count: 6, last_ts: Math.floor(Date.now() / 1000) - 86_400, category: 'review' },
  { skill_ref: '@taylor/test-tweet', count: 3, last_ts: Math.floor(Date.now() / 1000) - 3 * 86_400, category: 'writing' },
  { skill_ref: '@devops-dan/k8s-debug', count: 1, last_ts: Math.floor(Date.now() / 1000) - 12 * 86_400, category: 'debug' },
]

// Per-day series behind both the empty-state teaser and the dev preview:
// oldest first, ending today, ramping up so the chart reads as a habit
// forming. Sums to 24 to match the SAMPLE_SKILLS counts.
const SAMPLE_DAY_COUNTS = [
  0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 1, 2, 0, 1, 1, 2, 1, 0, 2, 1, 2, 1, 3,
]

/** '@author/slug' → its parts; tolerate junk refs by falling back to the raw string. */
function splitRef(ref: string): { author: string | null; slug: string } {
  const m = /^@([^/]+)\/(.+)$/.exec(ref)
  if (!m) return { author: null, slug: ref }
  return { author: m[1]!, slug: m[2]! }
}

/** One skill's tally row: cover + linked name, author + recency, usage count. */
function UsageRow({ skill }: { skill: UsageSkill }) {
  const { author, slug } = splitRef(skill.skill_ref)
  const href = author ? `/${author}/${slug}` : null
  const when = lastUsedLabel(skill.last_ts)
  const cover = (
    <span className="relative inline-flex h-9 w-9 shrink-0 overflow-hidden rounded-lg shadow-sm ring-1 ring-black/5">
      <CoverArt
        seed={author ? `${author}/${slug}` : skill.skill_ref}
        categories={[skill.category ?? null]}
        className="absolute inset-0 h-full w-full"
      />
    </span>
  )
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      {href ? (
        <Link href={href} className="shrink-0" aria-label={slug}>
          {cover}
        </Link>
      ) : (
        cover
      )}
      <div className="min-w-0 flex-1">
        {href ? (
          <Link
            href={href}
            className="block truncate text-sm font-medium text-(--ink) hover:underline"
          >
            {slug}
          </Link>
        ) : (
          <p className="truncate text-sm font-medium text-(--ink)">{slug}</p>
        )}
        <p className="truncate text-xs text-(--ink-2)">
          {author ? (
            <Link href={`/${author}`} className="hover:underline">
              @{author}
            </Link>
          ) : null}
          {author && when ? ' · ' : ''}
          {when ? `Last used ${when}` : ''}
        </p>
      </div>
      <span className="shrink-0 text-sm text-(--ink-2)">
        {skill.count === 1 ? 'Used once' : `Used ${skill.count} times`}
      </span>
    </li>
  )
}

export function SkilletUsagePanel() {
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error' }
    | {
        status: 'ready'
        recording: boolean
        skills: UsageSkill[]
        runtimes: string[]
        routeTs: number[]
        connected: boolean
      }
  >({ status: 'loading' })
  const [busy, setBusy] = useState(false)
  const [previewSample, setPreviewSample] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      // Devices ride along so the empty state can tell "connect first" apart
      // from "connected, just no routes yet" — availability (runtimes) lags
      // behind a real connection, so it is the wrong signal for that.
      const [res, devicesRes] = await Promise.all([
        fetchRegistryWithRetry('me/route-usage', { signal }),
        fetchRegistryWithRetry('devices', { signal }).catch(() => null),
      ])
      if (!res.ok) {
        setState({ status: 'error' })
        return
      }
      // Malformed/partial bodies fail closed to recording-off here (see
      // parseRouteUsage); only a fetch failure or unparseable JSON below is an error.
      const parsed = parseRouteUsage((await res.json()) as unknown)
      let connected = parsed.runtimes.length > 0
      if (devicesRes?.ok) {
        const devicesBody = (await devicesRes.json().catch(() => null)) as {
          devices?: unknown[]
        } | null
        connected = (devicesBody?.devices?.length ?? 0) > 0
      }
      setState({ status: 'ready', ...parsed, connected })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      setState({ status: 'error' })
    }
  }, [])

  useEffect(() => {
    const ac = new AbortController()
    void load(ac.signal)
    return () => ac.abort()
  }, [load])

  const setRecording = useCallback(
    async (next: boolean) => {
      if (state.status !== 'ready' || busy) return
      setBusy(true)
      setActionError(null)
      // Optimistic — reflect the switch immediately; roll back if the write fails.
      setState({ ...state, recording: next })
      try {
        const res = await fetch(registryAuthApi('me/activity'), {
          method: 'PUT',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ private: !next }),
        })
        if (!res.ok) throw new Error(String(res.status))
      } catch {
        setState({ ...state, recording: !next })
        setActionError('Couldn’t change that just now. Try again.')
      } finally {
        setBusy(false)
      }
    },
    [state, busy],
  )

  const deleteAll = useCallback(async () => {
    if (busy) return
    setBusy(true)
    setActionError(null)
    try {
      // Clear both streams the server holds for you: the route events and the
      // cross-runtime availability rows.
      const [ev, availability] = await Promise.all([
        fetch(registryAuthApi('me/events'), { method: 'DELETE', credentials: 'include' }),
        fetch(registryAuthApi('me/availability'), { method: 'DELETE', credentials: 'include' }),
      ])
      if (!ev.ok || !availability.ok) {
        setActionError('Couldn’t delete your history. Try again.')
        return
      }
      setConfirmingDelete(false)
      await load()
    } catch {
      setActionError('Couldn’t delete your history. Try again.')
    } finally {
      setBusy(false)
    }
  }, [busy, load])

  // Dev preview: swap in sample rows so the populated tally is inspectable
  // without seeding real events. Compiled out of production bundles.
  const sampling =
    process.env.NODE_ENV === 'development' && previewSample && state.status === 'ready'
  const shownSkills = sampling ? SAMPLE_SKILLS : state.status === 'ready' ? state.skills : []
  const chartDays = sampling
    ? sampleDays(SAMPLE_DAY_COUNTS)
    : bucketRouteTs(state.status === 'ready' ? state.routeTs : [])
  const chartTotal = chartDays.reduce((n, d) => n + d.count, 0)

  return (
    <SettingsSection
      title="Skill stats"
      description={
        <>
          Know which skills earn their keep. Only you can see this.{' '}
          <Link
            href="/docs/privacy"
            className="underline decoration-dotted underline-offset-2 hover:text-(--ink)"
          >
            What&rsquo;s recorded
          </Link>
        </>
      }
    >
      {state.status === 'loading' && (
        <SettingsList>
          <SettingRow
            as="li"
            title={<Shimmer className="h-4 w-36" />}
            description={<Shimmer className="mt-1 h-3 w-56" />}
          >
            <Shimmer className="h-6 w-11 rounded-full" />
          </SettingRow>
        </SettingsList>
      )}

      {state.status === 'error' && (
        <Notice tone="danger">Couldn&rsquo;t load your usage. Refresh to try again.</Notice>
      )}

      {state.status === 'ready' && (
        <div className="space-y-4">
          <SettingsList>
            <SettingRow
              as="li"
              title="Enable Stat Sync"
              description={
                state.recording
                  ? 'Syncs the skill picked and the agent that ran it. Never what you type.'
                  : 'Stats stay on your devices.'
              }
            >
              <ToggleSwitch
                checked={state.recording}
                onChange={setRecording}
                disabled={busy}
                ariaLabel="Enable Stat Sync"
              />
            </SettingRow>
          </SettingsList>

          {actionError && !confirmingDelete && <Notice tone="danger">{actionError}</Notice>}

          {/* Off collapses the tally and the teaser — a teaser would invite
              usage that isn't being saved. Delete stays reachable below. */}
          {state.recording &&
          (shownSkills.length === 0 ? (
            state.runtimes.length > 0 ? (
              <EmptyState>
                Only local skills so far. Those stay on your machine; see them with{' '}
                <code>skillet usage</code>.
              </EmptyState>
            ) : (
              <div className="relative">
                {/* Ghost preview — the per-day chart the tally will grow into,
                    so the empty state sells the feature instead of describing
                    absence. The caption sits over the faded tail. */}
                <div
                  aria-hidden="true"
                  className="pointer-events-none select-none opacity-40"
                  style={{
                    maskImage: 'linear-gradient(to bottom, black, transparent 96%)',
                    WebkitMaskImage: 'linear-gradient(to bottom, black, transparent 96%)',
                  }}
                >
                  <UsageChart days={sampleDays(SAMPLE_DAY_COUNTS)} />
                </div>
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-6 text-center">
                  <p className="text-sm font-semibold text-(--ink)">Nothing yet</p>
                  {/* Without a connection /skillet isn't on their agents yet,
                      so connecting comes first; with one, the command is the
                      only missing step. */}
                  <p className="text-sm text-(--ink-2)">
                    {state.connected ? (
                      <>
                        Try <code>/skillet</code> in any agent to see your first one.
                      </>
                    ) : (
                      <>
                        Connect a computer above, then try <code>/skillet</code> in any agent.
                      </>
                    )}
                  </p>
                </div>
              </div>
            )
          ) : (
            <>
              {/* Chart first — the shape of the habit is the headline; the
                  per-skill tally below is the breakdown. Hidden when every
                  route is older than the 30-day window. */}
              {chartTotal > 0 && <UsageChart days={chartDays} />}
              <SettingsList>
                {shownSkills.map((s) => (
                  <UsageRow key={s.skill_ref} skill={s} />
                ))}
              </SettingsList>
            </>
          ))}

          {state.recording && state.runtimes.length > 0 && !previewSample && (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-(--ink-2)">
              <span className="text-(--ink-3)">Used in</span>
              {state.runtimes.map((r) => (
                <span key={r} className="inline-flex items-center gap-1.5">
                  <AgentGlyph runtime={r} className="h-4 w-4" />
                  {runtimeLabel(r)}
                </span>
              ))}
            </p>
          )}

          {process.env.NODE_ENV === 'development' && state.recording && (
            <Button
              type="button"
              variant="tertiary"
              size="sm"
              onClick={() => setPreviewSample((v) => !v)}
            >
              {previewSample ? 'Exit sample preview' : 'Preview sample data (dev)'}
            </Button>
          )}

          {(state.skills.length > 0 || state.runtimes.length > 0) && (
            <Button
              variant="danger-ghost"
              size="sm"
              onClick={() => {
                setActionError(null)
                setConfirmingDelete(true)
              }}
              disabled={busy}
            >
              Delete history
            </Button>
          )}

          {/* Permanent, hard to reverse (past history is gone for good), so the
              confirm is a modal, not an inline two-tap — deliberate friction. */}
          <Dialog
            open={confirmingDelete}
            onOpenChange={(next) => {
              // Escape / overlay click cancel — but never close mid-request.
              if (!next && !busy) setConfirmingDelete(false)
            }}
          >
            <DialogContent className="w-[min(92vw,440px)]" aria-describedby={undefined}>
              <DialogTitle className="text-lg font-semibold text-(--ink)">
                Delete usage history?
              </DialogTitle>
              <p className="mt-2 text-sm leading-[1.5] text-(--ink-2)">
                This permanently removes your recorded usage from Skillet&rsquo;s servers. Past
                history can&rsquo;t be recovered. New usage records again as you use skills.
              </p>
              {actionError && (
                <p role="alert" className="mt-3 text-sm text-(--danger)">
                  {actionError}
                </p>
              )}
              <DialogFooter>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setConfirmingDelete(false)}
                  disabled={busy}
                >
                  Cancel
                </Button>
                <Button type="button" variant="danger-secondary" onClick={deleteAll} disabled={busy}>
                  {busy ? 'Deleting…' : 'Delete history'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}
    </SettingsSection>
  )
}
