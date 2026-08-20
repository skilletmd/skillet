'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Panel } from '@/components/ui/panel'
import { SettingsList } from '@/components/ui/settings-list'
import { AppLink } from '@/components/app-link'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { refreshRepoAction, disconnectRepoAction } from '@/app/(consumer)/settings/github/actions'
import type { ConnectedRepo } from '@/lib/connected-repos'
import type { OwnedRepo } from '@/lib/github-repos'
import { kitHref, skillHref } from '@/lib/urls'
import { SUBSECTION_LABEL_CLASS } from '@/lib/page-layout'
import { SettingsSection } from '@/components/ui/setting-section'
import { GitHubIcon } from '@/components/auth-provider-icons'
import { SkillIcon, KitStackIcon } from '@/components/directory-card'
import { ChevronRight } from '@/components/ui/icons'
import { timeAgo } from '@/lib/feed-format'

/** Horizontal ellipsis trigger for the per-repo actions menu. */
function EllipsisIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
  )
}

/**
 * One connected-repo row: a compact header (logo, repo, what it publishes, when it
 * last synced) with a disclosure that expands to the actual kit + skills — each
 * with its generative cover and a link — for full clarity on what's syncing. Manage
 * (Refresh / Disconnect) lives in a kebab menu so the destructive action sits a
 * layer down instead of one stray click away.
 */
function RepoRow({ r }: { r: ConnectedRepo }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [, startActionTransition] = useTransition()
  const skills = r.skills ?? []
  // The synced skills/kit publish under the Skillet handle (you or a team), NOT
  // the GitHub repo owner — profile links and cover seeds must use it.
  const handle = r.author ?? r.owner
  const count = r.skill_count ?? skills.length
  const skillLabel = `${count} skill${count === 1 ? '' : 's'}`
  const skillCategories = skills.map((s) => s.category)
  const expandable = skills.length > 0 || r.kit != null

  function run(action: (fd: FormData) => void | Promise<void>) {
    const fd = new FormData()
    fd.set('id', r.id)
    startActionTransition(() => {
      void action(fd)
    })
  }

  return (
    <li className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <GitHubIcon className="mt-0.5 h-5 w-5 shrink-0 text-(--ink)" />
          <div className="min-w-0">
            <AppLink href={r.url} className="font-mono text-sm text-(--ink) hover:underline">
              {r.full}
            </AppLink>
            {(r.kit || count > 0) && (
              <p className="mt-0.5 text-xs text-(--ink-2)">
                Publishes{' '}
                {r.kit ? (
                  <>
                    {r.kit.slug ? (
                      <AppLink
                        href={kitHref(handle, r.kit.slug)}
                        className="font-medium text-(--ink) hover:underline"
                      >
                        {r.kit.name}
                      </AppLink>
                    ) : (
                      <span className="font-medium text-(--ink)">{r.kit.name}</span>
                    )}{' '}
                    kit{count > 0 ? ` · ${skillLabel}` : ''}
                  </>
                ) : (
                  skillLabel
                )}
              </p>
            )}
            <p className="mt-0.5 text-xs text-(--ink-2)">
              {r.last_synced_at
                ? `synced ${timeAgo(r.last_synced_at, { suffix: true })}`
                : 'not synced yet'}
              {r.status && r.status !== 'active' ? ` · ${r.status}` : ''}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {expandable && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-label={open ? 'Hide synced items' : 'Show synced items'}
              className="flex h-8 w-8 items-center justify-center rounded-md text-(--ink-2) transition-colors hover:bg-(--accent-bg) hover:text-(--ink)"
            >
              <span
                className="inline-flex"
                style={{
                  transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
                  transition: 'transform 200ms cubic-bezier(0.23, 1, 0.32, 1)',
                }}
              >
                <ChevronRight className="h-4 w-4" />
              </span>
            </button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Manage repo"
              className="flex h-8 w-8 items-center justify-center rounded-md text-(--ink-2) outline-none transition-colors hover:bg-(--accent-bg) hover:text-(--ink) data-[state=open]:bg-(--bg) data-[state=open]:text-(--ink)"
            >
              <EllipsisIcon className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => router.push(`/import?url=${encodeURIComponent(r.full)}`)}>
                Edit skills
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => run(refreshRepoAction)}>
                Refresh now
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => run(disconnectRepoAction)}>
                Stop syncing
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {open && expandable && (
        <div className="mt-3 border-t border-(--line) pt-3 pl-8">
          {r.kit && (
            <div className="flex items-center gap-3">
              <span className="relative h-9 w-9 shrink-0">
                <KitStackIcon seed={r.kit.id} categories={skillCategories} radius="rounded-md" />
              </span>
              <span className="min-w-0">
                {r.kit.slug ? (
                  <AppLink
                    href={kitHref(handle, r.kit.slug)}
                    className="block truncate text-sm font-medium text-(--ink) hover:underline"
                  >
                    {r.kit.name}
                  </AppLink>
                ) : (
                  <span className="block truncate text-sm font-medium text-(--ink)">
                    {r.kit.name}
                  </span>
                )}
                <span className="block text-xs text-(--ink-2)">kit · {skillLabel}</span>
              </span>
            </div>
          )}
          {/* Indent the member skills under the kit (with a connecting rail) so they
              read as "inside" it. A repo with no kit lists its lone skill flush. */}
          <ul
            className={`space-y-2 ${r.kit ? 'mt-2 ml-[18px] border-l border-(--line) pt-1 pl-5' : ''}`}
          >
            {skills.map((s) => (
              <li key={s.slug} className="flex items-center gap-3">
                <span className="relative h-7 w-7 shrink-0">
                  <SkillIcon
                    seed={`${handle}/${s.slug}`}
                    category={s.category}
                    radius="rounded-md"
                  />
                </span>
                <AppLink
                  href={skillHref(handle, s.slug)}
                  className="min-w-0 truncate font-mono text-sm text-(--ink) hover:underline"
                >
                  {s.slug}
                </AppLink>
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  )
}

/**
 * The repos section on /settings/github. Two lists, both read-only here:
 * what's already synced (each row manages its own refresh / stop-syncing), and
 * your other public repos as one-click "add" rows. Picking either an available
 * repo or "Add a repo" hands off to the import wizard (/import) — where you pick
 * which skills, name the kit, and confirm. Nothing publishes from this page.
 */
export function ConnectRepoPanel({
  repos,
  available,
}: {
  repos: ConnectedRepo[]
  available: OwnedRepo[]
}) {
  const router = useRouter()
  // Re-fetch the page (owned-repo list is no-store) to pick up a repo you just
  // created on GitHub. The transition drives the "Refreshing…" label.
  const [refreshing, startRefresh] = useTransition()
  const rescan = () => startRefresh(() => router.refresh())

  const hasRepos = repos.length > 0
  const hasAvailable = available.length > 0
  // Owned repos arrive most-recently-pushed first, so the top few are the ones
  // you're most likely adding. Cap the inline list and tuck the rest behind a
  // "Show all" so a big account doesn't dump 100 rows into settings.
  const AVAILABLE_CAP = 5
  const [showAll, setShowAll] = useState(false)
  const visibleAvailable = showAll ? available : available.slice(0, AVAILABLE_CAP)
  return (
    <SettingsSection
      title="Repositories"
      description="Repos synced to Skillet, and others you own that you can add."
    >
      <div className="space-y-6">
        {hasRepos && (
          <div className="space-y-1.5">
            <p className={`px-1 ${SUBSECTION_LABEL_CLASS}`}>Synced</p>
            <SettingsList>
              {repos.map((r) => (
                <RepoRow key={r.id} r={r} />
              ))}
            </SettingsList>
          </div>
        )}

        {hasAvailable && (
          <div className="space-y-1.5">
            <p className={`px-1 ${SUBSECTION_LABEL_CLASS}`}>Add from your repos</p>
          <SettingsList className="overflow-hidden">
            {visibleAvailable.map((r) => (
              <li key={r.full}>
                <AppLink
                  href={`/import?url=${encodeURIComponent(r.full)}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-(--accent-bg)"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <GitHubIcon className="h-5 w-5 shrink-0 text-(--ink)" />
                    <span className="truncate font-mono text-sm text-(--ink)">{r.full}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-(--ink-2)" />
                </AppLink>
              </li>
            ))}
            {available.length > AVAILABLE_CAP && (
              <li>
                <button
                  type="button"
                  onClick={() => setShowAll((v) => !v)}
                  className="flex w-full items-center justify-center px-4 py-3 text-sm text-(--ink-2) transition-colors hover:bg-(--accent-bg) hover:text-(--ink)"
                >
                  {showAll ? 'Show fewer' : `Show all ${available.length} repos`}
                </button>
              </li>
            )}
          </SettingsList>
        </div>
      )}

      {!hasRepos && !hasAvailable ? (
        <Panel padding="md">
          <p className="text-sm leading-relaxed text-(--ink-2)">
            No repos found yet.{' '}
            <AppLink href="/import" className="font-medium text-(--ink) underline underline-offset-2">
              Add a public repo you own
            </AppLink>{' '}
            to publish its <span className="font-mono text-xs">SKILL.md</span> skills, or{' '}
            <button
              type="button"
              onClick={rescan}
              disabled={refreshing}
              className="font-medium text-(--ink) underline underline-offset-2 disabled:opacity-60"
            >
              {refreshing ? 'refreshing…' : 'refresh'}
            </button>{' '}
            to re-scan GitHub.
          </p>
        </Panel>
      ) : (
        <p className="px-1 text-xs text-(--ink-2)">
          Just created a repo?{' '}
          <button
            type="button"
            onClick={rescan}
            disabled={refreshing}
            className="font-medium text-(--ink) underline underline-offset-2 disabled:opacity-60"
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>{' '}
          to re-scan, or{' '}
          <AppLink href="/import" className="font-medium text-(--ink) underline underline-offset-2">
            add it manually
          </AppLink>
          .
        </p>
      )}
      </div>
    </SettingsSection>
  )
}
