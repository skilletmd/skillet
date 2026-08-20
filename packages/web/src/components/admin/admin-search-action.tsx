'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { searchUniversal, type SearchGroups, type SearchResultItem } from '@/lib/search-client'
import type { SearchGroupKey } from '@/lib/registry'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'

/** The subset of result types this control can act on. */
type Actionable = Extract<SearchResultItem, { type: 'skill' | 'kit' | 'author' }>

export interface AdminSearchActions {
  skill: (skillId: string) => Promise<void>
  kit: (kitId: string) => Promise<void>
  /** Present on the moderation surface (hide a user); absent on featured. */
  author?: (handle: string) => Promise<void>
}

function describe(item: Actionable): {
  title: string
  sub: string
  avatar?: { name: string; src?: string | null; key: string }
} {
  switch (item.type) {
    case 'skill':
      return { title: `${item.author}/${item.slug}`, sub: 'Skill' }
    case 'kit':
      return { title: item.name, sub: `Kit · ${item.owner}` }
    case 'author':
      return {
        title: item.name || `@${item.username}`,
        sub: `User · @${item.username}`,
        avatar: { name: item.name || item.username, src: item.avatar_url, key: item.username },
      }
  }
}

/**
 * Instant search (reuses the site's universal search) → pick a result → confirm
 * the action. Results carry the ids the admin endpoints need, so no ref parsing.
 * `types` scopes what's searchable (moderation includes users; featured doesn't).
 */
export function AdminSearchAction({
  verb,
  types,
  actions,
  danger = false,
}: {
  verb: string
  types: SearchGroupKey[]
  actions: AdminSearchActions
  danger?: boolean
}) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [groups, setGroups] = useState<SearchGroups>({})
  const [selected, setSelected] = useState<Actionable | null>(null)
  const [busy, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const q = query.trim()
    setSelected(null)
    if (q.length < 2) {
      setGroups({})
      return
    }
    const controller = new AbortController()
    const t = setTimeout(() => {
      searchUniversal(q, { types, limit: 6, signal: controller.signal })
        .then((r) => {
          if (!controller.signal.aborted) setGroups(r.groups)
        })
        .catch(() => {
          /* aborted or offline */
        })
    }, 150)
    return () => {
      clearTimeout(t)
      controller.abort()
    }
  }, [query, types])

  const items: Actionable[] = [
    ...(groups.skills ?? []),
    ...(groups.kits ?? []),
    ...(groups.authors ?? []),
  ]

  function run() {
    if (!selected) return
    setError(null)
    startTransition(async () => {
      try {
        if (selected.type === 'skill') await actions.skill(selected.skill_id)
        else if (selected.type === 'kit') await actions.kit(selected.kit_id)
        else if (selected.type === 'author' && actions.author) await actions.author(selected.username)
        setSelected(null)
        setQuery('')
        setGroups({})
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Action failed.')
      }
    })
  }

  const confirming = selected ? describe(selected) : null

  return (
    <div>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search skills, kits, and users…"
        className="w-full rounded-lg border border-(--line) bg-(--surface) px-3.5 py-2 text-sm outline-none focus:border-(--accent)"
      />

      {confirming ? (
        <div className="mt-2 rounded-xl border border-(--line) bg-(--surface) p-4">
          {/* Buttons are right-aligned, away from where the result row (left) was
              just clicked — so the cursor never lands on the destructive action. */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="min-w-0 text-sm text-(--ink)">
              {verb} <span className="font-mono font-medium">{confirming.title}</span>
              <span className="text-(--ink-2)"> — {confirming.sub.toLowerCase()}?</span>
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setSelected(null)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant={danger ? 'danger-secondary' : 'primary'}
                onClick={run}
                disabled={busy}
              >
                {busy ? 'Working…' : verb}
              </Button>
            </div>
          </div>
          {error && <p className="mt-2 text-sm text-(--danger)">{error}</p>}
        </div>
      ) : items.length > 0 ? (
        <ul className="mt-2 divide-y divide-(--line) overflow-hidden rounded-xl border border-(--line) bg-(--surface)">
          {items.map((it) => {
            const d = describe(it)
            const key =
              it.type === 'skill'
                ? `skill:${it.skill_id}`
                : it.type === 'kit'
                  ? `kit:${it.kit_id}`
                  : `author:${it.username}`
            return (
              <li key={key}>
                <button
                  type="button"
                  onClick={() => setSelected(it)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-(--accent-bg)"
                >
                  {d.avatar ? (
                    <Avatar src={d.avatar.src} name={d.avatar.name} colorKey={d.avatar.key} size="sm" />
                  ) : (
                    <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg text-xs font-semibold uppercase text-(--ink-3)">
                      {it.type[0]}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-(--ink)">{d.title}</span>
                    <span className="block truncate text-xs text-(--ink-2)">{d.sub}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
