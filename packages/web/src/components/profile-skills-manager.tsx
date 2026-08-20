'use client'

import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { SkillCard } from '@/components/skill-card'
import { SkillIcon } from '@/components/directory-card'
import { PrivateMark } from '@/components/visibility-badge'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogTitle, DialogClose } from '@/components/ui/dialog'
import { DialogFooter } from '@/components/ui/dialog-footer'
import { Button } from '@/components/ui/button'
import { SKILL_CARD_GRID } from '@/lib/page-layout'
import { EmptyState } from '@/components/ui/empty-state'
import { skillEditHref } from '@/lib/urls'
import { setSkillVisibility, deprecateSkill, undeprecateSkill } from '@/lib/deprecation'

export interface ManagedSkill {
  author: string
  slug: string
  title?: string | null
  description: string | null
  category?: string | null
  /** 'public' | 'private'; undefined reads as public. */
  visibility?: string
  installCount: number
  /** Owner-only: the skill is unlisted (deprecated). Public list never sends these. */
  deprecated?: boolean
}

type View = 'card' | 'list'
type Filter = 'all' | 'public' | 'private' | 'unpublished'

const FILTER_LABEL: Record<Filter, string> = {
  all: 'All',
  public: 'Public',
  private: 'Private',
  unpublished: 'Unpublished',
}
const FILTER_ORDER: Filter[] = ['all', 'public', 'private', 'unpublished']

/**
 * The whole Skills section for a profile: its own eyebrow header (title + count
 * on the left, a card/list view toggle on the right), plus owner controls (bulk
 * bar + per-row Edit menu) in list view. Renders the section itself rather than
 * nesting in LibrarySection so the toggle can share the header row and the view
 * state. A client island so the page stays server-side.
 */
export function ProfileSkillsManager({
  skills,
  isSelf,
  avatarUrl,
  emptyCopy,
}: {
  skills: ManagedSkill[]
  isSelf: boolean
  avatarUrl?: string | null
  emptyCopy: ReactNode
}) {
  const [view, setView] = useState<View>('card')
  const [items, setItems] = useState<ManagedSkill[]>(skills)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<{ slugs: string[]; label: string; fromBulk: boolean } | null>(null)
  const [filter, setFilter] = useState<Filter>('all')

  const canManage = isSelf
  const authorBySlug = useMemo(() => new Map(items.map((s) => [s.slug, s.author])), [items])

  // Live skills are what the public sees and what bulk actions target; deprecated
  // (unlisted) skills are owner-only. The list-view filter cuts across both.
  const liveItems = items.filter((s) => !s.deprecated)
  const deprecatedItems = items.filter((s) => s.deprecated)
  const counts: Record<Filter, number> = {
    all: liveItems.length + deprecatedItems.length,
    public: liveItems.filter((s) => s.visibility !== 'private').length,
    private: liveItems.filter((s) => s.visibility === 'private').length,
    unpublished: deprecatedItems.length,
  }
  // "All" is literally all your skills: live first, then unpublished at the end.
  // The narrower filters cut across visibility / lifecycle.
  const listItems =
    filter === 'unpublished'
      ? deprecatedItems
      : filter === 'public'
        ? liveItems.filter((s) => s.visibility !== 'private')
        : filter === 'private'
          ? liveItems.filter((s) => s.visibility === 'private')
          : [...liveItems, ...deprecatedItems]
  // Only live rows are bulk-selectable; unpublished rows offer per-row Restore.
  const selectable = listItems.filter((s) => !s.deprecated)
  const allSelected = selected.size === selectable.length && selectable.length > 0

  function toggleOne(slug: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      return next
    })
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === selectable.length ? new Set() : new Set(selectable.map((s) => s.slug))))
  }

  // Switching filters clears the selection so a bulk action never hits rows that
  // scrolled out of the current view.
  function changeFilter(next: Filter) {
    setFilter(next)
    setSelected(new Set())
  }

  const plural = (n: number) => (n === 1 ? 'skill' : 'skills')

  async function mutateVisibility(slugs: string[], target: 'public' | 'private'): Promise<string[]> {
    if (slugs.length === 0) return []
    const prevVis = new Map(items.map((s) => [s.slug, s.visibility]))
    const targetSet = new Set(slugs)
    setNotice(null)
    setBusy(true)
    setItems((cur) => cur.map((s) => (targetSet.has(s.slug) ? { ...s, visibility: target } : s)))
    const results = await Promise.allSettled(
      slugs.map((slug) => setSkillVisibility(authorBySlug.get(slug) ?? '', slug, target)),
    )
    const failed = slugs.filter((_, i) => results[i]!.status === 'rejected')
    if (failed.length > 0) {
      const failedSet = new Set(failed)
      setItems((cur) => cur.map((s) => (failedSet.has(s.slug) ? { ...s, visibility: prevVis.get(s.slug) } : s)))
      setNotice(`Could not update ${failed.length} ${plural(failed.length)}. They are unchanged.`)
    }
    setBusy(false)
    return failed
  }

  // Unpublish = deprecate: flip the flag so the skill drops out of the live list
  // and into the (owner-only) unpublished group, rather than vanishing.
  async function mutateRemove(slugs: string[]): Promise<string[]> {
    if (slugs.length === 0) return []
    const targeting = new Set(slugs)
    setNotice(null)
    setBusy(true)
    setItems((cur) => cur.map((s) => (targeting.has(s.slug) ? { ...s, deprecated: true } : s)))
    setSelected((prev) => {
      const next = new Set(prev)
      slugs.forEach((slug) => next.delete(slug))
      return next
    })
    const results = await Promise.allSettled(
      slugs.map((slug) => deprecateSkill(authorBySlug.get(slug) ?? '', slug)),
    )
    const failed = slugs.filter((_, i) => results[i]!.status === 'rejected')
    if (failed.length > 0) {
      const failedSet = new Set(failed)
      setItems((cur) => cur.map((s) => (failedSet.has(s.slug) ? { ...s, deprecated: false } : s)))
      setNotice(`Could not unpublish ${failed.length} ${plural(failed.length)}. They are still listed.`)
    }
    setBusy(false)
    return failed
  }

  // Restore = undeprecate: flip the flag back so the skill returns to the live list.
  async function mutateRestore(slugs: string[]): Promise<string[]> {
    if (slugs.length === 0) return []
    const targeting = new Set(slugs)
    setNotice(null)
    setBusy(true)
    setItems((cur) => cur.map((s) => (targeting.has(s.slug) ? { ...s, deprecated: false } : s)))
    const results = await Promise.allSettled(
      slugs.map((slug) => undeprecateSkill(authorBySlug.get(slug) ?? '', slug)),
    )
    const failed = slugs.filter((_, i) => results[i]!.status === 'rejected')
    if (failed.length > 0) {
      const failedSet = new Set(failed)
      setItems((cur) => cur.map((s) => (failedSet.has(s.slug) ? { ...s, deprecated: true } : s)))
      setNotice(`Could not restore ${failed.length} ${plural(failed.length)}.`)
    }
    setBusy(false)
    return failed
  }

  function rowRestore(skill: ManagedSkill) {
    void mutateRestore([skill.slug])
  }

  async function runVisibility(target: 'public' | 'private') {
    const failed = await mutateVisibility([...selected], target)
    setSelected(failed.length > 0 ? new Set(failed) : new Set())
  }

  function runRemove() {
    const slugs = [...selected]
    if (slugs.length === 0) return
    setConfirming({ slugs, label: `${slugs.length} ${plural(slugs.length)}`, fromBulk: true })
  }

  function rowRemove(skill: ManagedSkill) {
    setConfirming({ slugs: [skill.slug], label: `"${skill.title ?? skill.slug}"`, fromBulk: false })
  }

  async function confirmRemoval() {
    if (!confirming) return
    const { slugs, fromBulk } = confirming
    setConfirming(null)
    const failed = await mutateRemove(slugs)
    if (fromBulk) setSelected(failed.length > 0 ? new Set(failed) : new Set())
  }

  const showBulk = canManage && view === 'list' && selected.size > 0

  return (
    <section id="skills" className="scroll-mt-24">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-(--ink-2)">
          Skills
          <span className="ml-2 text-xs font-normal tabular-nums text-(--ink-2)">{liveItems.length}</span>
        </h2>
        <ViewToggle view={view} onChange={setView} />
      </div>

      {items.length === 0 ? (
        <div className="mt-3">
          <EmptyState>{emptyCopy}</EmptyState>
        </div>
      ) : (
        <div className="mt-3">
          {canManage && view === 'list' ? (
            <div className="mb-3 flex min-h-9 flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-4">
                {selectable.length > 0 ? (
                  <label className="flex items-center gap-2 text-sm text-(--ink-2)">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all skills" />
                    <span>{selected.size > 0 ? `${selected.size} selected` : 'Select all'}</span>
                  </label>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {showBulk ? (
                  <div role="group" aria-label="Bulk actions" className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => runVisibility('public')} disabled={busy} className={barBtn}>
                      Make public
                    </button>
                    <button type="button" onClick={() => runVisibility('private')} disabled={busy} className={barBtn}>
                      Make private
                    </button>
                    <button type="button" onClick={runRemove} disabled={busy} className={`${barBtn} text-(--danger)`}>
                      Unpublish
                    </button>
                  </div>
                ) : null}
                <FilterMenu filter={filter} counts={counts} onChange={changeFilter} />
              </div>
            </div>
          ) : null}

          {notice ? (
            <p role="status" className="mb-3 text-sm text-(--danger)">
              {notice}
            </p>
          ) : null}

          {view === 'card' ? (
            <ul className={SKILL_CARD_GRID}>
              {liveItems.map((skill) => (
                <li key={skill.slug}>
                  <SkillCard
                    size="md"
                    author={skill.author}
                    slug={skill.slug}
                    title={skill.title}
                    description={skill.description}
                    category={skill.category}
                    installCount={skill.installCount}
                    visibility={skill.visibility === 'private' ? 'private' : 'public'}
                    editHref={canManage ? skillEditHref(skill.author, skill.slug) : undefined}
                    makerAvatarUrl={avatarUrl ?? null}
                    hideAuthor
                  />
                </li>
              ))}
            </ul>
          ) : listItems.length === 0 ? (
            <p className="rounded-xl border border-(--line) px-4 py-6 text-center text-sm text-(--ink-2)">
              No {FILTER_LABEL[filter].toLowerCase()} skills.
            </p>
          ) : (
            <ul className="divide-y divide-(--line) rounded-xl border border-(--line)">
              {listItems.map((skill) => {
                const isPrivate = skill.visibility === 'private'
                const isDeprecated = !!skill.deprecated
                // Under "All", label where the live list ends and unpublished begins.
                const startsUnpublished =
                  filter === 'all' && isDeprecated && deprecatedItems[0]?.slug === skill.slug
                return (
                  <Fragment key={skill.slug}>
                    {startsUnpublished ? (
                      <li className="bg-(--bg) px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-(--ink-2)">
                        Unpublished
                      </li>
                    ) : null}
                    <li className="flex items-center gap-5 px-4 py-3">
                      {canManage && !isDeprecated ? (
                        <input
                          type="checkbox"
                          checked={selected.has(skill.slug)}
                          onChange={() => toggleOne(skill.slug)}
                          aria-label={`Select ${skill.title ?? skill.slug}`}
                        />
                      ) : null}
                      <a
                        href={`/${skill.author}/${skill.slug}`}
                        aria-label={skill.title ?? skill.slug}
                        className={`relative h-10 w-10 shrink-0 ${isDeprecated ? 'opacity-60' : ''}`}
                      >
                        <SkillIcon seed={`${skill.author}/${skill.slug}`} category={skill.category} radius="rounded-lg" />
                      </a>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <a
                            href={`/${skill.author}/${skill.slug}`}
                            className={`truncate text-base font-semibold leading-[1.2] tracking-tight hover:underline hover:underline-offset-2 ${
                              isDeprecated ? 'text-(--ink-2)' : 'text-(--ink)'
                            }`}
                          >
                            {skill.title ?? skill.slug}
                          </a>
                          {isDeprecated ? (
                            <span className="shrink-0 rounded border border-(--line) px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-(--ink-2)">
                              Unpublished
                            </span>
                          ) : isPrivate ? (
                            <PrivateMark className="shrink-0 text-(--ink-2)" />
                          ) : null}
                        </div>
                        {skill.description ? (
                          <p className="mt-0.5 truncate text-sm leading-[1.5] text-(--ink-2)">{skill.description}</p>
                        ) : null}
                      </div>
                      <span className="shrink-0 text-xs text-(--ink-2)">Used by {skill.installCount}</span>
                      {canManage && isDeprecated ? (
                        <button
                          type="button"
                          onClick={() => rowRestore(skill)}
                          disabled={busy}
                          className={barBtn}
                        >
                          Restore
                        </button>
                      ) : canManage ? (
                        <div className="inline-flex shrink-0 items-center overflow-hidden rounded-lg border border-(--line) bg-(--surface)">
                          <a
                            href={skillEditHref(skill.author, skill.slug)}
                            className="flex items-center px-2.5 py-1 text-sm font-medium text-(--ink) transition-colors hover:bg-(--bg)"
                          >
                            Edit
                          </a>
                          <span aria-hidden="true" className="h-5 w-px bg-(--line)" />
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                aria-label={`More actions for ${skill.title ?? skill.slug}`}
                                className="flex items-center px-1.5 py-1 text-(--ink) transition-colors hover:bg-(--bg)"
                              >
                                <Chevron />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent>
                              <DropdownMenuItem onSelect={() => void mutateVisibility([skill.slug], isPrivate ? 'public' : 'private')}>
                                {isPrivate ? 'Make public' : 'Make private'}
                              </DropdownMenuItem>
                              <DropdownMenuItem variant="destructive" onSelect={() => void rowRemove(skill)}>
                                Unpublish
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      ) : null}
                    </li>
                  </Fragment>
                )
              })}
            </ul>
          )}
        </div>
      )}

      <Dialog open={!!confirming} onOpenChange={(open) => (open ? null : setConfirming(null))}>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle className="text-base font-semibold text-(--ink)">
            Unpublish {confirming?.label}?
          </DialogTitle>
          <p className="mt-2 text-sm leading-[1.5] text-(--ink-2)">
            This unlists {confirming && confirming.slugs.length > 1 ? 'them' : 'it'} from your profile and the
            public catalog. Existing installs keep working, and you can restore{' '}
            {confirming && confirming.slugs.length > 1 ? 'them' : 'it'} later.
          </p>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary" size="sm">
                Cancel
              </Button>
            </DialogClose>
            <Button variant="danger-secondary" size="sm" onClick={confirmRemoval}>
              Unpublish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

const barBtn =
  'rounded-md border border-(--line) bg-(--surface) px-2.5 py-1 text-sm font-medium text-(--ink) transition-colors hover:bg-(--bg) disabled:opacity-50'

function FilterMenu({
  filter,
  counts,
  onChange,
}: {
  filter: Filter
  counts: Record<Filter, number>
  onChange: (f: Filter) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="Filter skills" className={`${barBtn} flex items-center gap-1.5`}>
          {FILTER_LABEL[filter]}
          <span className="tabular-nums text-(--ink-2)">{counts[filter]}</span>
          <Chevron />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {FILTER_ORDER.map((f) => (
          <DropdownMenuItem key={f} onSelect={() => onChange(f)} className="flex items-center justify-between gap-8">
            <span>{FILTER_LABEL[f]}</span>
            <span className="text-xs tabular-nums text-(--ink-2)">{counts[f]}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function Chevron() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ViewToggle({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-(--line) bg-(--surface) p-0.5">
      {(['card', 'list'] as View[]).map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          aria-pressed={view === v}
          aria-label={`${v === 'card' ? 'Card' : 'List'} view`}
          title={`${v === 'card' ? 'Card' : 'List'} view`}
          className={`flex items-center rounded-md px-2 py-1 transition-colors ${
            view === v ? 'bg-(--ink) text-(--surface)' : 'text-(--ink-2) hover:text-(--ink)'
          }`}
        >
          {v === 'card' ? <GridIcon /> : <RowsIcon />}
        </button>
      ))}
    </div>
  )
}

function GridIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="3" y="3" width="8" height="8" rx="1.5" />
      <rect x="13" y="3" width="8" height="8" rx="1.5" />
      <rect x="3" y="13" width="8" height="8" rx="1.5" />
      <rect x="13" y="13" width="8" height="8" rx="1.5" />
    </svg>
  )
}

function RowsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="18" x2="20" y2="18" />
    </svg>
  )
}
