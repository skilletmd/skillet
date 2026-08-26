'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ToggleSwitch } from '@/components/ui/toggle-switch'
import { PublishAsControl, type PublishAsTarget } from '@/components/publish-as-control'
import { Input, FieldLabel } from '@/components/ui/input'
import {
  classifyDiscovery,
  discoverSkillsFromUrl,
  type SkillDiscoveryResult,
} from '@/lib/skill-import'
import { humanizeSlug } from '@/components/skill-card'
import { ensureBrowserSigningReady } from '@/lib/browser-signing-bind'
import { useBfcacheRestore } from '@/lib/use-bfcache-restore'
import { pluralize } from '@/lib/format'
import { NEEDS_HANDLE_MESSAGE } from '@/lib/signing-setup'
import {
  importRepoAsKit,
  importRepoAsUnifiedSkillPublished,
  type ImportProgress,
  type ImportRepoAsKitResult,
} from '@/lib/import-repo-as-kit'
import { AppLink } from '@/components/app-link'
import { syncFromWizard } from '@/app/(consumer)/settings/github/actions'
import type { ConnectState } from '@/app/(consumer)/settings/github/actions'
import type { OwnedRepo } from '@/lib/github-repos'
import type { ConnectedRepo } from '@/lib/connected-repos'
import { kitHrefFromRecord, skillHref } from '@/lib/urls'
import { Check } from '@/components/ui/icons'
import { PageHeader } from '@/components/page-header'
import { Panel } from '@/components/ui/panel'
import { GithubImportPanel } from '@/components/github-import-panel'

type Phase = 'input' | 'preview' | 'importing' | 'done'

const LARGE_IMPORT = 40

/** Calm success cue for the done screens — a check on the success tint (matches
 *  Badge variant="success"), not the near-black accent used for primary actions. */
function SuccessBadge() {
  return (
    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-(--success-bg) text-(--success)">
      <Check className="h-5 w-5" />
    </span>
  )
}

function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={className} fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}

export function RepoImportWizard({
  author,
  initialUrl,
  githubLinked = false,
  publishTargets = [],
  sessionHandle = null,
  available = [],
  connected = [],
}: {
  author: string
  initialUrl?: string
  githubLinked?: boolean
  /** Who the user can publish under (self + admin teams). >1 shows the picker. */
  publishTargets?: PublishAsTarget[]
  /** The signed-in user's own handle, to tell a personal target from a team. */
  sessionHandle?: string | null
  available?: OwnedRepo[]
  connected?: ConnectedRepo[]
}) {
  const [phase, setPhase] = useState<Phase>('input')
  const [url, setUrl] = useState(initialUrl ?? '')
  const autoRan = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [discovery, setDiscovery] = useState<SkillDiscoveryResult | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [kitName, setKitName] = useState('')
  // A one-time copy import is PRIVATE — you may not own the source repo (or it may
  // carry no redistributable license), so we never republish it publicly on your
  // behalf. Publishing publicly requires proving ownership via Connect GitHub, which
  // routes through `runSync` (the license/ownership-gated mirror path), not this copy.
  const visibility = 'private' as const
  const [progress, setProgress] = useState<ImportProgress[]>([])
  const [result, setResult] = useState<ImportRepoAsKitResult | null>(null)
  const [syncResult, setSyncResult] = useState<ConnectState | null>(null)
  // For an owned repo: keep it live-synced vs import a one-time copy.
  const [keepSynced, setKeepSynced] = useState(false)
  // Bundle the selected skills into a kit. Auto-on for 2+ (the toggle only shows
  // then); the user can turn it off to publish them as separate skills.
  const [bundleAsKit, setBundleAsKit] = useState(true)
  // Who to publish under — yourself or a team you admin. Picker shown only when
  // there's more than one option. The publishAs sent to sync is null for self.
  const [selectedAuthor, setSelectedAuthor] = useState(author)
  const publishAs = selectedAuthor !== (sessionHandle ?? author) ? selectedAuthor : undefined
  // When the repo's skills are coupled (reference ../), importing as one skill
  // is the default so the shared paths resolve. The user can override to N kits.
  const [unified, setUnified] = useState(false)

  // Repos the user owns (can sync), from their connected GitHub + already-synced.
  const ownedSet = new Set([...available.map((r) => r.full), ...connected.map((r) => r.full)])

  // Browser-back (e.g. from the Connect GitHub redirect) restores this page from
  // the bfcache with `busy` stuck true — its in-flight work died with the page.
  useBfcacheRestore(() => setBusy(false))

  async function discover(explicitUrl?: string) {
    const target = explicitUrl ?? url
    setBusy(true)
    setError(null)
    try {
      const found = await discoverSkillsFromUrl(target)
      if (found.skills.length === 0) {
        setError('No SKILL.md skills found in that repo.')
        return
      }
      setDiscovery(found)
      // Reconfiguring an already-synced repo: pre-check exactly the dirs it
      // currently syncs (null = the whole repo), so re-syncing to add one skill
      // doesn't silently drop the others. A fresh repo defaults to all.
      const already = connected.find((r) => r.full === `${found.owner}/${found.repo}`)
      const syncedDirs = already?.selected_dirs ?? null
      const discoveredDirs = found.skills.map((s) => s.dir)
      const initial = syncedDirs
        ? discoveredDirs.filter((d) => syncedDirs.includes(d))
        : discoveredDirs
      setSelected(new Set(initial.length > 0 ? initial : discoveredDirs))
      // Coupled repos default to a single unified skill so ../ refs resolve.
      setUnified(classifyDiscovery(found).mode === 'unified')
      // Pretty default: "agent-skills" -> "Agent Skills". The owner is shown
      // separately, so it doesn't belong in the name.
      setKitName(humanizeSlug(found.repo))
      // For a repo you own, live sync is the better default; a one-time copy is
      // the exception. (No-op for repos you can't sync — the row isn't shown.)
      setKeepSynced(repoIsOwned(found))
      setPhase('preview')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that repo.')
    } finally {
      setBusy(false)
    }
  }

  // Auto-discover when arriving with a prefilled URL (e.g. /github.com/owner/repo).
  useEffect(() => {
    if (initialUrl && !autoRan.current) {
      autoRan.current = true
      void discover()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The header "select all" checkbox shows a dash (indeterminate) on a partial
  // selection — set via the DOM property, which JSX can't express declaratively.
  const selectAllRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const el = selectAllRef.current
    if (el && discovery) {
      el.indeterminate = selected.size > 0 && selected.size < discovery.skills.length
    }
  }, [selected, discovery])

  function toggle(dir: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(dir)) next.delete(dir)
      else next.add(dir)
      return next
    })
  }

  // Append/replace one skill's progress entry by index — the live importing view.
  const appendProgress = (e: ImportProgress) =>
    setProgress((prev) => {
      const next = [...prev]
      const i = next.findIndex((p) => p.index === e.index)
      if (i >= 0) next[i] = e
      else next.push(e)
      return next
    })

  // Publishing signs each skill — make sure this browser can sign before we try
  // (and fail) on every skill. Sets the error and returns false when it can't.
  async function withSigningReady(): Promise<boolean> {
    const setup = await ensureBrowserSigningReady(author).catch((err: unknown) => ({
      kind: 'setup_error' as const,
      message:
        err instanceof Error
          ? err.message
          : 'This browser can’t publish yet. Sign in and try again.',
    }))
    if (setup.kind !== 'ready') {
      setError(
        setup.kind === 'needs_handle'
          ? NEEDS_HANDLE_MESSAGE
          : setup.kind === 'setup_error'
            ? setup.message
            : 'This browser can’t publish yet. Sign in and try again.',
      )
      return false
    }
    return true
  }

  async function runImport() {
    if (!discovery) return
    const chosen = discovery.skills.filter((s) => selected.has(s.dir))
    if (chosen.length === 0) return
    setError(null)
    if (!(await withSigningReady())) return

    setProgress([])
    setPhase('importing')
    const res = await importRepoAsKit({
      author: selectedAuthor,
      discovery,
      selected: chosen,
      kitName,
      visibility,
      bundle: bundleAsKit,
      onProgress: appendProgress,
    })
    setResult(res)
    setPhase('done')
  }

  // Coupled repo: publish the whole repo as one skill so ../ references resolve.
  async function runUnifiedImport() {
    if (!discovery) return
    setError(null)
    if (!(await withSigningReady())) return
    setProgress([])
    setPhase('importing')
    const res = await importRepoAsUnifiedSkillPublished({
      author: selectedAuthor,
      discovery,
      skillName: kitName,
      visibility,
      onProgress: appendProgress,
    })
    setResult(res)
    setPhase('done')
  }

  // Keep an owned repo in sync (live). For a coupled repo we omit the dir subset
  // so the registry classifies it as one unified skill; otherwise sync the picks.
  async function runSync() {
    if (!discovery) return
    const chosen = discovery.skills.filter((s) => selected.has(s.dir)).map((s) => s.dir)
    if (!unified && chosen.length === 0) return
    setError(null)
    setBusy(true)
    const res = await syncFromWizard({
      owner: discovery.owner,
      repo: discovery.repo,
      ...(unified ? {} : { dirs: chosen }),
      ...(kitName.trim() && !unified ? { kitName: kitName.trim() } : {}),
      ...(unified ? {} : { bundle: bundleAsKit }),
      ...(publishAs ? { publishAs } : {}),
    })
    setBusy(false)
    if (res.error) {
      setError(res.error)
      return
    }
    setSyncResult(res)
    setPhase('done')
  }

  const repoIsOwned = (d: SkillDiscoveryResult) =>
    githubLinked && ownedSet.has(`${d.owner}/${d.repo}`)

  if (phase === 'input') {
    return (
      <div>
        <PageHeader
          title="Import from GitHub"
          lede={
            <>
              Paste a public repo and pick which skills to import. They&rsquo;re added privately for
              you; to publish publicly, connect GitHub (for repos you own). Skillet finds every{' '}
              <code className="font-mono text-sm">SKILL.md</code> in the repo.
            </>
          }
        />
        <Panel>
          <GithubImportPanel
            githubLinked={githubLinked}
            available={available}
            connected={connected}
            onUse={(target) => {
              setUrl(target)
              void discover(target)
            }}
            busy={busy}
            error={error}
            initialUrl={initialUrl}
            connectReturn="/import"
          />
        </Panel>
      </div>
    )
  }

  if (phase === 'preview' && discovery) {
    const count = selected.size
    const classification = classifyDiscovery(discovery)
    const coupled = classification.mode === 'unified'
    return (
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-(--ink)">Import from GitHub</h1>

        {coupled && (
          <div className="mt-4 rounded-xl border border-(--accent) bg-(--accent-bg) p-4">
            <p className="text-sm font-medium text-(--ink)">Detected: a coupled toolkit</p>
            <p className="mt-1 text-sm text-(--ink-2)">
              {classification.reason} We&rsquo;ll import this repo as{' '}
              <span className="font-medium text-(--ink)">one skill</span> so the shared paths
              resolve.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <button
                type="button"
                onClick={() => setUnified(true)}
                className={`rounded-full border px-3 py-1 ${
                  unified
                    ? 'border-(--accent) bg-(--surface) font-medium text-(--ink)'
                    : 'border-(--line) text-(--ink-2) hover:text-(--ink)'
                }`}
              >
                Import as one skill
              </button>
              <button
                type="button"
                onClick={() => setUnified(false)}
                className={`rounded-full border px-3 py-1 ${
                  !unified
                    ? 'border-(--accent) bg-(--surface) font-medium text-(--ink)'
                    : 'border-(--line) text-(--ink-2) hover:text-(--ink)'
                }`}
              >
                Import as {discovery.skills.length} separate skills
              </button>
            </div>
          </div>
        )}

        <p className="mt-4 text-sm text-(--ink-2)">
          {unified
            ? 'The whole repo imports as a single skill, named after the repo.'
            : repoIsOwned(discovery)
              ? 'Choose which skills to publish.'
              : 'Choose which skills to import privately to your account.'}
          {!repoIsOwned(discovery) && (
            <>
              {' '}
              <AppLink
                href="/api/github/connect/start?return=/import"
                className="font-medium text-(--ink) underline underline-offset-2"
              >
                Connect GitHub
              </AppLink>{' '}
              to publish repos you own and keep them in sync.
            </>
          )}
        </p>
        {discovery.total > discovery.skills.length && (
          <p className="mt-2 rounded-lg border border-(--line) bg-(--surface) px-3 py-2 text-xs text-(--ink-2)">
            This repo has <span className="font-medium text-(--ink)">{discovery.total}</span>{' '}
            skills; showing the first {discovery.skills.length}. Paste a subfolder URL (e.g.{' '}
            <code className="font-mono text-xs">
              {discovery.owner}/{discovery.repo}/tree/{discovery.ref}/skills/components
            </code>
            ) to import a specific area.
          </p>
        )}

        <div className="mt-4 overflow-hidden surface-card">
          {/* The repo we're pulling from — the header for the skills table. */}
          <div
            className={`flex items-center justify-between gap-3 px-4 py-3${
              unified ? '' : ' border-b border-(--line)'
            }`}
          >
            <div className="flex min-w-0 items-center gap-3">
              {!unified && (
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  aria-label="Select all skills"
                  checked={count > 0 && count === discovery.skills.length}
                  onChange={() =>
                    setSelected(
                      count === discovery.skills.length
                        ? new Set()
                        : new Set(discovery.skills.map((s) => s.dir)),
                    )
                  }
                  className="shrink-0"
                />
              )}
              <div className="flex min-w-0 items-center gap-1.5">
                <GithubMark className="h-[15px] w-[15px] shrink-0 text-(--ink-2)" />
                <span className="truncate font-mono text-sm font-semibold text-(--ink)">
                  {discovery.owner}/{discovery.repo}
                </span>
              </div>
            </div>
            {unified ? (
              <span className="shrink-0 rounded-full border border-(--line) bg-(--bg) px-2.5 py-0.5 text-xs font-medium text-(--ink-2)">
                {discovery.total} {pluralize(discovery.total, 'skill')}
              </span>
            ) : (
              <span className="shrink-0 text-sm text-(--ink-2)">
                {count} of {discovery.skills.length} selected
              </span>
            )}
          </div>

          {!unified && (
            <>
              <ul
                className="divide-y divide-(--line) overflow-auto"
                style={{ maxHeight: 'min(56vh, 460px)' }}
              >
                {discovery.skills.map((s) => (
                  <li key={s.dir || '(root)'}>
                    <label className="flex cursor-pointer items-start gap-3 px-4 py-2.5 hover:bg-(--accent-bg)">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={selected.has(s.dir)}
                        onChange={() => toggle(s.dir)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate font-mono text-sm font-medium text-(--ink)">
                            {s.name || humanizeSlug(s.dir.split('/').pop() ?? 'skill')}
                          </span>
                          {s.dir && (
                            <span className="shrink-0 font-mono text-xs text-(--ink-2)">
                              {s.dir}
                            </span>
                          )}
                        </span>
                        {s.description && (
                          <span className="mt-0.5 block truncate text-xs text-(--ink-2)">
                            {s.description}
                          </span>
                        )}
                        {s.coupled && (
                          <span className="mt-0.5 block text-xs [color:var(--warning)]">
                            References shared files (../); may import incomplete on its own.
                          </span>
                        )}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        {!unified && count > 1 && (
          <div className="mt-4 rounded-lg border border-(--line) bg-(--surface)">
            <div className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-(--ink)">Bundle into a kit</p>
                <p className="mt-0.5 text-sm text-(--ink-2)">
                  A named set people can install in one step.
                </p>
              </div>
              <ToggleSwitch
                checked={bundleAsKit}
                onChange={(v) => setBundleAsKit(v)}
                ariaLabel="Bundle into a kit"
              />
            </div>
            {bundleAsKit && (
              <div className="border-t border-(--line) px-4 py-3">
                <FieldLabel className="mb-1.5 block">Kit name</FieldLabel>
                <Input
                  value={kitName}
                  onChange={(e) => setKitName(e.target.value)}
                  className="w-full max-w-[320px] text-sm"
                />
              </div>
            )}
          </div>
        )}

        {!unified && count >= LARGE_IMPORT && (
          <p className="mt-3 text-xs text-(--ink-2)">
            Importing {count} skills signs and publishes each one, which can take a minute or two.
            You can start with a subset and pull the rest later.
          </p>
        )}
        {/* Owned repo: a single choice (sync vs copy) as a checkbox row, not a
            competing button. Otherwise, invite connecting to unlock sync. Works
            for a unified (coupled) repo too — sync keeps it as one skill. */}
        {repoIsOwned(discovery) && (
          <div className="mt-4 flex items-center justify-between gap-4 rounded-lg border border-(--line) bg-(--surface) px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-(--ink)">Keep in sync with GitHub</p>
              <p className="mt-0.5 text-sm text-(--ink-2)">Updates automatically when you push.</p>
            </div>
            <ToggleSwitch
              checked={keepSynced}
              onChange={(v) => setKeepSynced(v)}
              ariaLabel="Keep in sync with GitHub"
            />
          </div>
        )}

        {error && <p className="mt-3 text-sm text-(--danger)">{error}</p>}

        {/* Footer: publish-as on the left, the action on the right. */}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          {publishTargets.length > 1 ? (
            <PublishAsControl
              targets={publishTargets}
              value={selectedAuthor}
              onChange={setSelectedAuthor}
            />
          ) : (
            <span />
          )}
          <Button
            type="button"
            variant="primary"
            disabled={busy || (!unified && count === 0)}
            onClick={() =>
              keepSynced ? void runSync() : unified ? void runUnifiedImport() : void runImport()
            }
          >
            {busy
              ? keepSynced
                ? 'Publishing…'
                : 'Importing…'
              : keepSynced
                ? `Publish ${unified || count === 1 ? 'skill' : 'skills'}`
                : `Import ${unified || count === 1 ? 'skill' : 'skills'}`}
          </Button>
        </div>
      </div>
    )
  }

  if (phase === 'importing') {
    const done = progress.filter((p) => p.status !== 'publishing').length
    const total = selected.size
    return (
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-(--ink)">Importing…</h1>
        <p className="mt-2 text-sm text-(--ink-2)">
          Signing and publishing each skill, then building the kit. {done} of {total}.
        </p>
        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-(--bg)">
          <div
            className="h-full rounded-full bg-(--accent) transition-[width] duration-300"
            style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }}
          />
        </div>
        <ul className="mt-4 max-h-[320px] space-y-1 overflow-auto text-sm">
          {progress.map((p) => (
            <li key={p.index} className="flex items-center gap-2">
              <span aria-hidden>
                {p.status === 'published' ? '✓' : p.status === 'failed' ? '✕' : '·'}
              </span>
              <span className={p.status === 'failed' ? 'text-(--danger)' : 'text-(--ink-2)'}>
                {p.label}
              </span>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  // done — sync outcome (kept the repo synced)
  if (syncResult) {
    const count = syncResult.skills?.length ?? 0
    const repoFull = discovery ? `${discovery.owner}/${discovery.repo}` : 'your repo'
    return (
      <div>
        <SuccessBadge />
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-(--ink)">
          {repoFull} is synced
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-(--ink-2)">
          {syncResult.kitName ? (
            <>
              <span className="font-medium text-(--ink)">{syncResult.kitName}</span> and its {count}{' '}
              {pluralize(count, 'skill')} now publish on Skillet.
            </>
          ) : (
            <>
              {count} {pluralize(count, 'skill')} now {count === 1 ? 'publishes' : 'publish'} on
              Skillet.
            </>
          )}{' '}
          They update automatically when you push.
        </p>
        {syncResult.skills && syncResult.skills.length > 0 && (
          <p className="mt-3 font-mono text-xs text-(--ink-2)">{syncResult.skills.join(' · ')}</p>
        )}
        <div className="mt-6 flex items-center gap-2">
          {syncResult.kitId && (
            <Button href={kitHrefFromRecord({ id: syncResult.kitId })} variant="primary">
              View kit
            </Button>
          )}
          <Button href="/settings/github" variant="secondary">
            Manage synced repos
          </Button>
        </div>
      </div>
    )
  }

  // done — import-a-copy outcome
  const importedCount = result?.published.length ?? 0
  const importFailed = result?.failed.length ?? 0
  return (
    <div>
      {importedCount > 0 ? <SuccessBadge /> : null}
      <h1
        className={`text-2xl font-semibold tracking-tight text-(--ink) ${importedCount > 0 ? 'mt-4' : ''}`}
      >
        {importedCount > 0
          ? `Imported ${importedCount} ${pluralize(importedCount, 'skill')}`
          : 'Nothing imported'}
        {importFailed > 0 && (
          <span className="font-normal text-(--ink-2)"> · {importFailed} skipped</span>
        )}
      </h1>
      {result?.kitId ? (
        <p className="mt-2 text-sm leading-relaxed text-(--ink-2)">
          They’re bundled into{' '}
          <Link
            href={kitHrefFromRecord({ id: result.kitId })}
            className="font-medium text-(--accent) hover:underline"
          >
            {kitName}
          </Link>
          . Re-import the repo anytime to add more.
        </p>
      ) : result && result.published.length === 1 ? (
        <p className="mt-2 text-sm leading-relaxed text-(--ink-2)">
          Published as{' '}
          <Link
            href={skillHref(result.published[0]!.author, result.published[0]!.slug)}
            className="font-medium text-(--accent) hover:underline"
          >
            {result.published[0]!.slug}
          </Link>
          .
        </p>
      ) : (
        <p className="mt-2 text-sm text-(--danger)">See the errors below.</p>
      )}

      {result && result.failed.length > 0 && (
        <div className="mt-4 surface-card p-4">
          <p className="text-sm font-medium text-(--ink)">{result.failed.length} skipped</p>
          <ul className="mt-2 space-y-1 text-xs text-(--ink-2)">
            {result.failed.map((f) => (
              <li key={f.label}>
                <span className="text-(--ink)">{f.label}</span>: {f.error}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-5 flex items-center gap-2">
        {result?.kitId ? (
          <Button href={kitHrefFromRecord({ id: result.kitId })} variant="primary">
            View kit
          </Button>
        ) : result && result.published.length === 1 ? (
          <Button
            href={skillHref(result.published[0]!.author, result.published[0]!.slug)}
            variant="primary"
          >
            View skill
          </Button>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setPhase('input')
            setUrl('')
            setDiscovery(null)
            setResult(null)
            setSyncResult(null)
            setProgress([])
          }}
        >
          Import another
        </Button>
      </div>
    </div>
  )
}
