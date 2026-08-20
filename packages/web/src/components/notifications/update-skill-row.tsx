import type { CSSProperties } from 'react'
import Link from 'next/link'
import { SkillIcon } from '@/components/directory-card'
import { Avatar } from '@/components/ui/avatar'
import { coverHue } from '@/components/cover/cover-hue'
import { humanizeSlug } from '@/components/skill-card'
import { skillHref } from '@/lib/urls'
import type { UpdateItem } from '@/lib/account-updates'

/**
 * A brand-new skill listed inside a kit update group, drawn in the same language
 * as a skill on the kit page ({@link SkillRow} in kit-skill-list): cover + name +
 * author + description, the whole row linking to the skill. A new skill has no
 * diff to review, so this is a plain identity row — the group's "Update all" owns
 * the decision. Edits keep the diff-bearing UpdateCard instead.
 */
export function UpdateSkillRow({ item }: { item: UpdateItem }) {
  const [author, slug] = item.ref.split('/')
  const description = item.description?.trim() ? item.description.trim() : null
  const rowTint = {
    '--row-hover': `hsl(${coverHue([item.category ?? null], `${author}/${slug}`)} 60% 52% / 0.07)`,
  } as CSSProperties
  return (
    <div style={rowTint} className="group relative transition-colors hover:bg-(--row-hover)">
      {/* Stretched link: the whole row goes to the skill (its full detail). */}
      <Link
        href={skillHref(author, slug)}
        aria-label={humanizeSlug(slug)}
        className="absolute inset-0 focus-visible:outline focus-visible:-outline-offset-2 focus-visible:outline-(--accent)"
      />
      {/* Cover on the left, name + description stacked tightly beside it (the
          cover centers against the two lines), matching the kit-page SkillRow. */}
      <div className="flex items-center gap-3 px-3.5 py-2.5">
        <div className="relative size-10 shrink-0">
          <SkillIcon seed={`${author}/${slug}`} category={item.category} radius="rounded-md" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-semibold text-(--ink)">
              {humanizeSlug(slug)}
            </span>
            <span aria-hidden="true" className="shrink-0 text-(--ink-2)/40">
              ·
            </span>
            <span className="flex min-w-0 shrink items-center gap-1.5 text-xs font-medium text-(--ink-2)">
              <Avatar name={author} colorKey={author} kind="person" size="xxs" aria-hidden="true" />
              <span className="truncate">@{author}</span>
            </span>
          </div>
          {description && (
            <p className="line-clamp-1 text-sm leading-[1.5] text-(--ink-2)">{description}</p>
          )}
        </div>
      </div>
    </div>
  )
}
