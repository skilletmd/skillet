'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SkillIcon } from '@/components/directory-card'
import { humanizeSlug } from '@/components/skill-card'
import { PrivateMark } from '@/components/visibility-badge'
import { searchUniversal, type SearchSkillResult } from '@/lib/search-client'
import type { KitVisibility } from '@/lib/kits'

/** A skill the picker can surface — normalized from my-skills, saved, or search. */
export interface PickerSkill {
  /** "author:slug". */
  skill_id: string
  author: string
  slug: string
  description: string | null
  category: string | null
  /** 'private' skills can't go in a public kit. null/undefined = unknown (e.g.
   *  search results, which don't carry visibility) — treated as allowed. */
  visibility?: 'public' | 'private' | null
}

const DEBOUNCE_MS = 180
const RESULT_LIMIT = 12

export function fromSearch(r: SearchSkillResult): PickerSkill {
  return {
    skill_id: r.skill_id,
    author: r.author,
    slug: r.slug,
    description: r.description,
    category: null,
    visibility: r.visibility ?? null,
  }
}

function byTitle(a: PickerSkill, b: PickerSkill): number {
  return (
    humanizeSlug(a.slug).localeCompare(humanizeSlug(b.slug)) || a.author.localeCompare(b.author)
  )
}

// Local match for the personal scopes (Created / Saved) — a search inside a
// filter stays client-side over that list, no global lookup.
function matchesQuery(s: PickerSkill, q: string): boolean {
  return `${humanizeSlug(s.slug)} @${s.author} ${s.slug} ${s.description ?? ''}`
    .toLowerCase()
    .includes(q)
}

function SkillThumb({ skill }: { skill: PickerSkill }) {
  return (
    <span className="relative h-8 w-8 shrink-0" aria-hidden="true">
      <SkillIcon
        seed={`${skill.author}/${skill.slug}`}
        category={skill.category}
        radius="rounded-lg"
      />
    </span>
  )
}

type Scope = 'all' | 'mine' | 'saved'

/**
 * One skill picker for both kit flows. A single search field opens a dropdown of
 * results; Created / Saved are scope filters (on the right) and the unfiltered
 * state shows Popular. Typing searches across everything, or within the active
 * scope when one is on. It emits the chosen skill via `onAdd` — the parent
 * decides whether to stage it locally (create) or persist it (edit). Skills
 * already in `existingSkillIds` are filtered out of every list.
 */
export function KitSkillPicker({
  existingSkillIds,
  mySkills = [],
  savedSkills = [],
  popularSkills = [],
  kitVisibility,
  onAdd,
  busy = false,
  placeholder = 'Search every skill…',
}: {
  existingSkillIds: readonly string[]
  mySkills?: readonly PickerSkill[]
  savedSkills?: readonly PickerSkill[]
  /** Most-installed skills, for the Popular browse tab. */
  popularSkills?: readonly PickerSkill[]
  /** The kit's visibility — a public kit can't hold private skills, so those
   *  show in the list but their Add is disabled. */
  kitVisibility: KitVisibility
  onAdd: (skill: PickerSkill) => void
  /** Disable input while the parent is persisting an add (edit flow). */
  busy?: boolean
  placeholder?: string
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PickerSkill[]>([])
  const [searching, setSearching] = useState(false)
  // -1 = nothing pre-highlighted; a row only lights up once you arrow-key onto
  // it (mouse hover is pure CSS). Avoids a phantom "hovered" first row on load.
  const [highlight, setHighlight] = useState(-1)
  // Created / Saved are scope filters; 'all' is the unfiltered view (Popular when
  // idle, global search when typing). Smart default: your own if you have any.
  const [scope, setScope] = useState<Scope>(mySkills.length ? 'mine' : 'all')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)
  // The results live in a dropdown that opens on focus — the field is the only
  // persistent control, so the kit's own list stays the hero of the page.
  const [open, setOpen] = useState(false)
  const trimmed = query.trim()

  const existing = useMemo(() => new Set(existingSkillIds), [existingSkillIds])
  const hasMine = mySkills.length > 0
  const hasSaved = savedSkills.length > 0
  // Once you have a library, show BOTH Created and Saved filters (even at 0) so
  // the option is discoverable; a user with neither just gets All.
  const showScopes = hasMine || hasSaved
  const browsable = showScopes || popularSkills.length > 0

  // Only the unfiltered (All/Popular) scope hits the global search — the personal
  // scopes filter their own list locally, so an empty box or an active scope
  // never fires a network lookup.
  useEffect(() => {
    if (scope !== 'all' || trimmed === '') {
      setResults([])
      setSearching(false)
      return
    }
    const controller = new AbortController()
    const t = setTimeout(() => {
      setSearching(true)
      searchUniversal(trimmed, {
        types: ['skills'],
        limit: RESULT_LIMIT,
        signal: controller.signal,
      })
        .then((res) => {
          if (controller.signal.aborted) return
          setResults((res.groups.skills ?? []).map(fromSearch))
          setSearching(false)
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return
          setSearching(false)
        })
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(t)
      controller.abort()
    }
  }, [trimmed, scope])

  // Already-added skills drop out of every list — the kit's own list shows them.
  const notAdded = useCallback(
    (list: readonly PickerSkill[]) => list.filter((s) => !existing.has(s.skill_id)),
    [existing],
  )

  // The personal lists, scoped to the current query — computed once and reused
  // for both the live chip counts and the visible list. Empty query sorts by
  // title; a query filters locally.
  const q = trimmed.toLowerCase()
  const createdList = useMemo<PickerSkill[]>(() => {
    const base = notAdded(mySkills)
    return q ? base.filter((s) => matchesQuery(s, q)) : base.slice().sort(byTitle)
  }, [mySkills, notAdded, q])
  const savedList = useMemo<PickerSkill[]>(() => {
    const base = notAdded(savedSkills)
    return q ? base.filter((s) => matchesQuery(s, q)) : base.slice().sort(byTitle)
  }, [savedSkills, notAdded, q])

  // The active scope drives the list: All searches everything (or browses
  // Popular when idle); Created/Saved show their scoped list.
  const visible = useMemo<PickerSkill[]>(() => {
    if (scope === 'mine') return createdList
    if (scope === 'saved') return savedList
    if (trimmed !== '') return notAdded(results)
    return notAdded(popularSkills)
  }, [scope, createdList, savedList, trimmed, results, popularSkills, notAdded])

  // Clamp the upper bound as the list shrinks, but preserve -1 (no selection).
  useEffect(() => {
    setHighlight((h) => Math.min(h, visible.length - 1))
  }, [visible.length])

  // Keep the arrow-key highlighted row in view as you page through a long list.
  useEffect(() => {
    if (highlight < 0) return
    ;(listRef.current?.children[highlight] as HTMLElement | undefined)?.scrollIntoView({
      block: 'nearest',
    })
  }, [highlight])

  // Close on an outside click; clicks inside (a result, a tab) keep it open so
  // you can add several skills in a row.
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const add = useCallback(
    (skill: PickerSkill) => {
      // A public kit can't hold private skills — ignore the attempt.
      if (kitVisibility === 'public' && skill.visibility === 'private') return
      onAdd(skill)
      // Adding from search clears the box so the next add is one keystroke away;
      // either way keep focus in the field so the dropdown stays open for more.
      if (trimmed !== '') setQuery('')
      inputRef.current?.focus()
    },
    [onAdd, trimmed, kitVisibility],
  )

  // Filters select (not toggle): click All to clear back to everything. The
  // query is kept so it re-scopes rather than resetting.
  function selectScope(next: Scope) {
    setScope(next)
    setHighlight(-1)
    inputRef.current?.focus()
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      if (visible.length === 0) return
      e.preventDefault()
      setHighlight((h) => (h + 1) % visible.length)
    } else if (e.key === 'ArrowUp') {
      if (visible.length === 0) return
      e.preventDefault()
      setHighlight((h) => (h <= 0 ? visible.length - 1 : h - 1))
    } else if (e.key === 'Enter') {
      const pick = visible[highlight]
      if (pick) {
        e.preventDefault()
        add(pick)
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      if (query !== '') setQuery('')
      else setOpen(false)
    }
  }

  const emptyMessage = searching
    ? 'Searching…'
    : scope === 'mine'
      ? trimmed !== ''
        ? `None of your skills match “${trimmed}”.`
        : 'No skills of your own yet.'
      : scope === 'saved'
        ? trimmed !== ''
          ? `None of your saved skills match “${trimmed}”.`
          : 'Nothing saved yet.'
        : trimmed !== ''
          ? `No skills for “${trimmed}”.`
          : !browsable
            ? 'Type above to search every skill.'
            : 'Nothing to show yet.'

  return (
    <div ref={containerRef} className="relative">
      {/* The one persistent control — a search field. Results open in a dropdown
        below it on focus, so the kit's own list stays the page's hero. */}
      <div className="relative h-10">
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-(--ink-2)">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="M10.5 10.5L14 14"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </span>
        <input
          ref={inputRef}
          type="text"
          value={query}
          disabled={busy}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value)
            setHighlight(-1)
            setOpen(true)
          }}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-label="Search skills to add"
          autoComplete="off"
          spellCheck={false}
          className="block h-full w-full rounded-xl border border-(--line) bg-[color-mix(in_srgb,var(--ink)_4%,transparent)] pl-10 pr-3.5 text-sm text-(--ink) transition-[border-color,box-shadow,background-color] duration-200 placeholder:text-(--ink-2) focus:border-(--ink) focus:bg-(--bg) focus:shadow-[0_0_0_3px_var(--accent-bg)] focus:outline-none disabled:opacity-60"
        />
      </div>

      {open && (
        <div className="absolute inset-x-0 top-full z-30 mt-2 origin-top animate-[search-dropdown-in_140ms_ease-out] overflow-hidden rounded-2xl border border-(--line) bg-(--bg) shadow-[0_16px_44px_-16px_rgba(40,30,15,0.3)] motion-reduce:animate-none">
          {/* Filter set — All / Created / Saved, each with a live count for the
            current query. Selecting one scopes the list AND the search; there's
            always exactly one active (All = everything), never a dead toggle. */}
          {browsable && (
            <div className="flex items-center justify-start gap-1 border-b border-(--line) px-2 py-2">
              {(
                [
                  { key: 'all' as const, label: 'All', count: null, show: true },
                  {
                    key: 'mine' as const,
                    label: 'Created',
                    count: createdList.length,
                    show: showScopes,
                  },
                  {
                    key: 'saved' as const,
                    label: 'Saved',
                    count: savedList.length,
                    show: showScopes,
                  },
                ] satisfies { key: Scope; label: string; count: number | null; show: boolean }[]
              )
                .filter((f) => f.show)
                .map((f) => {
                  const active = scope === f.key
                  return (
                    <button
                      key={f.key}
                      type="button"
                      aria-pressed={active}
                      onClick={() => selectScope(f.key)}
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                        active
                          ? 'bg-(--accent-bg) text-(--accent) ring-1 ring-inset ring-(--accent)/30'
                          : 'text-(--ink-2) hover:bg-(--accent-bg) hover:text-(--ink)'
                      }`}
                    >
                      {f.label}
                      {f.count !== null && (
                        <span
                          className={`tabular-nums ${active ? 'text-(--accent)/70' : 'text-(--ink-3)'}`}
                        >
                          {f.count}
                        </span>
                      )}
                    </button>
                  )
                })}
            </div>
          )}
          <div className="max-h-[300px] overflow-y-auto p-1.5">
            {visible.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-(--ink-2)">{emptyMessage}</p>
            ) : (
              <ul ref={listRef} className="flex flex-col">
                {visible.map((s, i) => {
              const isHot = i === highlight
              const isPrivate = s.visibility === 'private'
              // A private skill can't join a public kit — show it, but block Add.
              const blocked = isPrivate && kitVisibility === 'public'
              return (
                <li key={s.skill_id}>
                  <button
                    type="button"
                    disabled={busy || blocked}
                    onClick={() => add(s)}
                    title={blocked ? "Private skills can't be added to a public kit." : undefined}
                    className={`group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors disabled:opacity-60 ${
                      blocked ? 'cursor-not-allowed' : isHot ? 'bg-(--accent-bg)' : 'hover:bg-(--accent-bg)'
                    }`}
                  >
                    <SkillThumb skill={s} />
                    <span className="min-w-0 flex-1">
                      {/* Title · @author on line one, description on line two —
                        matching the kit contents rows below. */}
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm font-semibold text-(--ink)">
                          {humanizeSlug(s.slug)}
                        </span>
                        <span className="shrink-0 font-mono text-xs text-(--ink-2)">
                          @{s.author}
                        </span>
                        {isPrivate && (
                          <PrivateMark className="shrink-0 rounded-lg border border-(--warning-line) px-1.5 py-px text-(--warning)" />
                        )}
                      </span>
                      {s.description?.trim() && (
                        <span className="block truncate text-xs text-(--ink-2)">
                          {s.description}
                        </span>
                      )}
                    </span>
                    <span
                      className={`shrink-0 rounded-lg border px-3 py-1.5 font-mono text-xs font-semibold uppercase tracking-[0.04em] transition-colors ${
                        blocked
                          ? 'border-(--line) text-(--ink-3)'
                          : isHot
                            ? 'border-(--ink)/25 bg-(--surface) text-(--ink)'
                            : 'border-(--line) text-(--ink-2) group-hover:border-(--ink)/25 group-hover:bg-(--surface) group-hover:text-(--ink)'
                      }`}
                    >
                      Add
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
          </div>
        </div>
      )}
    </div>
  )
}
