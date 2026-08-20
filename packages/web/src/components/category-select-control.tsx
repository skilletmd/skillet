'use client'

// Owner-facing category picker on the skill edit page.
//
// Category is prefilled by a heuristic at import/publish (classify/heuristic on
// the registry); this control lets the owner correct it. It saves on change via
// a lightweight PATCH (no republish) — the category is user-facing metadata,
// independent of the signed bundle. Owner-gated the same way as the deprecate
// control; the registry re-authorizes regardless.
//
// Presented as a real dropdown showing each category's cover mark (glyph + color,
// the same art as the skill's cover), not a bare native <select>.

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { ChevronDown, Check } from '@/components/ui/icons'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu'
import { CategoryCover } from '@/components/cover/category-cover'
import { CATEGORIES_BY_SECTION, CATEGORY_BY_KEY } from '@/lib/categories'
import type { CategoryKey } from '@/lib/categories'
import { setSkillCategory, SkillCategoryError } from '@/lib/skill-category'
import { isSkillOwner } from './deprecate-skill-control'

/** The category's cover mark (glyph on its color), or a neutral tile when unset. */
function CategoryMark({ category }: { category: CategoryKey | null }) {
  return (
    <span className="relative inline-block size-5 shrink-0">
      {category ? (
        <CategoryCover category={category} radius="rounded-[5px]" />
      ) : (
        <span className="absolute inset-0 rounded-[5px] border border-(--line) bg-(--bg)" />
      )}
    </span>
  )
}

export function CategorySelectControl(props: {
  author: string
  slug: string
  initialCategory?: CategoryKey | null
}) {
  const { data: session, status } = useSession()
  if (status === 'loading') return null
  if (!isSkillOwner(session?.handle, props.author)) return null
  return <CategorySelectPanel {...props} />
}

/** The panel itself — owner-gated by the wrapper, exported for tests. */
export function CategorySelectPanel({
  author,
  slug,
  initialCategory = null,
}: {
  author: string
  slug: string
  initialCategory?: CategoryKey | null
}) {
  const [category, setCategory] = useState<CategoryKey | null>(initialCategory)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function choose(next: CategoryKey | null) {
    if (next === category) return
    const prev = category
    setCategory(next) // optimistic
    setSaving(true)
    setError(null)
    try {
      const saved = await setSkillCategory(author, slug, next)
      setCategory(saved)
    } catch (err) {
      setCategory(prev) // revert on failure
      setError(err instanceof SkillCategoryError ? err.message : 'Could not save the category.')
    } finally {
      setSaving(false)
    }
  }

  const current = category ? CATEGORY_BY_KEY[category] : null

  // Compact: a muted label + the dropdown, sized to sit in the editor footer
  // beside the slug. The dropdown itself (mark + name) carries the meaning.
  return (
    <div className="flex items-center gap-2" aria-label="Skill category">
      <span className="text-xs text-(--ink-2)">Category</span>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={saving}
          className="inline-flex min-w-44 items-center justify-between gap-2 rounded-lg border border-(--line) bg-(--card-pop) px-2.5 py-1.5 text-sm text-(--ink) transition-colors hover:border-(--ink)/25 disabled:opacity-60"
        >
          <span className="flex min-w-0 items-center gap-2">
            <CategoryMark category={category} />
            <span className="truncate">{current?.label ?? 'Uncategorized'}</span>
          </span>
          <ChevronDown className="size-4 shrink-0 text-(--ink-2)" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          // Match the trigger width so the menu lines up under it.
          className="max-h-80 w-(--radix-dropdown-menu-trigger-width) overflow-y-auto"
        >
          <DropdownMenuItem onSelect={() => void choose(null)}>
            <CategoryMark category={null} />
            <span className="ml-2 flex-1">Uncategorized</span>
            {category === null && <Check className="size-4 shrink-0 text-(--accent)" />}
          </DropdownMenuItem>
          {/* Grouped by section (the color families), the same way browse is
              organized — not alphabetical, so the color logic reads. Flattened to
              direct Label/Item children (no Fragment/div wrapper) so Radix's menu
              collection tracks them and every element carries its own key. */}
          {CATEGORIES_BY_SECTION.flatMap(({ section, categories }) => [
            <DropdownMenuLabel key={`section:${section}`}>{section}</DropdownMenuLabel>,
            ...categories.map((c) => (
              <DropdownMenuItem key={c.key} onSelect={() => void choose(c.key)}>
                <CategoryMark category={c.key} />
                <span className="ml-2 flex-1 truncate">{c.label}</span>
                {category === c.key && <Check className="size-4 shrink-0 text-(--accent)" />}
              </DropdownMenuItem>
            )),
          ])}
        </DropdownMenuContent>
      </DropdownMenu>
      {error && (
        <span role="alert" className="text-xs text-(--danger)">
          {error}
        </span>
      )}
    </div>
  )
}
