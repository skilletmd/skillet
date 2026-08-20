'use client'

import { useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { SkillIcon } from '@/components/directory-card'
import { Avatar } from '@/components/ui/avatar'
import { Eyebrow } from '@/components/ui/eyebrow'
import { CategoryIcon } from '@/components/category-icons'
import { coverHue } from '@/components/cover/cover-hue'
import {
  CATEGORIES_BY_SECTION,
  SECTION_GLYPH_COLOR,
  isCategoryKey,
  type Category,
  type CategoryKey,
} from '@/lib/categories'
import { humanizeSlug } from '@/lib/humanize-slug'
import { skillHref } from '@/lib/urls'
import type { KitSkillEntry } from '@/lib/kits'

/** Above this many skills, a kit stops opening fully — instead its leading
 *  categories open until ~AUTO_OPEN_SKILLS skills show and the rest collapse, so
 *  you land on real content with the remaining sections as a scannable overview.
 *  Disclosure lives at the category level only — a skill row always shows its
 *  description, so a skill reads identically in every kit. */
const COLLAPSE_CATEGORIES_ABOVE = 10
const AUTO_OPEN_SKILLS = 10

// Group display order is the browse-rail order (Code → Creative → Grow,
// alphabetical within a section), so the kit page and browse read the same way.
const ORDERED_CATEGORIES: Category[] = CATEGORIES_BY_SECTION.flatMap((s) => s.categories)

const OTHER = 'other' as const

function refOf(entry: KitSkillEntry): { author: string; slug: string } {
  const [author, slug] = entry.skill_id.split(':')
  return { author, slug }
}

/**
 * One skill in a kit: the whole row links to the skill, and the description (when
 * present) always shows beneath the identity line — no per-row disclosure. A skill
 * reads identically in every kit; the only thing that folds is its category.
 */
function SkillRow({ entry, owner }: { entry: KitSkillEntry; owner: string }) {
  const { author, slug } = refOf(entry)
  const description = entry.description?.trim() ? entry.description : null
  // The kit's own skills are the common case — repeating the owner's handle on
  // every row is noise. Only name the author when the skill is someone else's.
  const byOther = author !== owner
  // A faint cover-hue wash on hover, so the row speaks the same tinted language
  // as the browse cards instead of a flat gray highlight.
  const rowTint = { '--row-hover': `hsl(${coverHue([entry.category ?? null], `${author}/${slug}`)} 60% 52% / 0.07)` } as CSSProperties
  return (
    <div style={rowTint} className="group relative transition-colors hover:bg-(--row-hover)">
      {/* Stretched link: the whole row (identity + description) goes to the skill. */}
      <Link
        href={skillHref(author, slug)}
        aria-label={humanizeSlug(slug)}
        className="absolute inset-0 focus-visible:outline focus-visible:-outline-offset-2 focus-visible:outline-(--accent)"
      />
      {/* Cover on the left, name + description stacked tightly beside it (the
          cover centers against the two lines) — so the name→description gap stays
          snug instead of inheriting the cover's height. */}
      <div className="flex items-center gap-3 px-3.5 py-2.5">
        <div className="relative size-10 shrink-0">
          <SkillIcon seed={`${author}/${slug}`} category={entry.category} radius="rounded-md" />
        </div>
        <div className="min-w-0 flex-1">
          {/* Identity clustered together: title, then the author beside it — but
              only when the skill is by someone other than the kit's owner. */}
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-semibold text-(--ink)">{humanizeSlug(slug)}</span>
            {entry.pinned_hash && (
              <span className="shrink-0 rounded-full border border-(--line) px-2 py-0.5 text-xs text-(--ink-2)">
                pinned
              </span>
            )}
            {byOther && (
              <>
                <span aria-hidden="true" className="shrink-0 text-(--ink-2)/40">·</span>
                <span className="flex min-w-0 shrink items-center gap-1.5 text-xs font-medium text-(--ink-2)">
                  <Avatar
                    src={entry.author_avatar_url}
                    name={entry.author_name ?? author}
                    colorKey={author}
                    kind="person"
                    size="xxs"
                    aria-hidden="true"
                  />
                  <span className="truncate">@{author}</span>
                </span>
              </>
            )}
          </div>
          {description && (
            <p className="line-clamp-1 text-sm leading-[1.5] text-(--ink-2)">{description}</p>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * The category subhead as a row INSIDE the list panel, so a grouped kit reads as
 * one continuous list with dividers, not a stack of separate sections. It's also
 * the section's disclosure: click it to fold the whole category down to this row.
 */
function GroupSubheadRow({
  cat,
  count,
  preview,
  collapsed,
  onToggle,
}: {
  cat: Category | null
  count: number
  /** Comma-joined skill titles — a one-line peek shown only while collapsed. */
  preview: string
  collapsed: boolean
  onToggle: () => void
}) {
  return (
    <h3>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-2 bg-(--ink)/[0.025] px-3.5 py-2 text-left text-xs font-semibold text-(--ink) transition-colors hover:bg-(--ink)/[0.05] focus-visible:outline focus-visible:-outline-offset-2 focus-visible:outline-(--accent)"
      >
        {cat && (
          <span
            className="grid size-3.5 shrink-0 place-items-center text-sm"
            style={{ color: SECTION_GLYPH_COLOR[cat.section] }}
          >
            <CategoryIcon cat={cat.key} />
          </span>
        )}
        {cat ? cat.label : 'Other'}
        <span className="font-mono text-xs font-medium text-(--ink-2)">{count}</span>
        {/* Collapsed: a muted one-line peek at the skills inside; it truncates, so
            a big category just shows the leading few. Gone once expanded. */}
        {collapsed && preview && (
          <span className="min-w-0 flex-1 truncate font-normal text-(--ink-2)/70">{preview}</span>
        )}
        <svg
          viewBox="0 0 12 12"
          width="11"
          height="11"
          aria-hidden="true"
          className={`ml-auto shrink-0 text-(--ink-2) transition-transform duration-200 ${collapsed ? '-rotate-90' : ''}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2.5 4.5 6 8l3.5-3.5" />
        </svg>
      </button>
    </h3>
  )
}

/**
 * The skills inside a kit, with its "Includes N skills" header. One presentation
 * at every size: a single continuous list, grouped by category whenever the kit
 * spans more than one (category subheads live inside the panel as rows). Every
 * skill row always shows its description — disclosure lives at the category level,
 * not per skill. Large kits (> COLLAPSE_CATEGORIES_ABOVE) open with their sections
 * collapsed to a scannable set of headers; smaller kits open fully. Curator order
 * is preserved within each group.
 */
export function KitSkillList({ entries, owner }: { entries: KitSkillEntry[]; owner: string }) {
  const byCategory = new Map<CategoryKey | typeof OTHER, KitSkillEntry[]>()
  for (const entry of entries) {
    const key = isCategoryKey(entry.category) ? entry.category : OTHER
    const bucket = byCategory.get(key)
    if (bucket) bucket.push(entry)
    else byCategory.set(key, [entry])
  }

  const groups: { cat: Category | null; members: KitSkillEntry[] }[] = ORDERED_CATEGORIES.filter(
    (c) => byCategory.has(c.key),
  ).map((c) => ({ cat: c, members: byCategory.get(c.key)! }))
  if (byCategory.has(OTHER)) groups.push({ cat: null, members: byCategory.get(OTHER)! })

  // Group whenever the kit spans more than one category — independent of size, so
  // a 3-skill kit across two categories reads the same way a 90-skill one does. A
  // single-category kit drops the redundant lone header but keeps the same rows.
  const grouped = groups.length > 1
  const sectionKeys = () => groups.map((g) => g.cat?.key ?? OTHER)

  // Small kits open fully. Big kits open their leading categories until ~10 skills
  // show, then collapse the rest — content on load, not a wall, overview intact.
  const [collapsedSections, setCollapsedSections] = useState<ReadonlySet<string>>(() => {
    if (!grouped || entries.length <= COLLAPSE_CATEGORIES_ABOVE) return new Set()
    const collapsed = new Set<string>()
    let shown = 0
    let stop = false
    for (const g of groups) {
      const key = g.cat?.key ?? OTHER
      // Always open the first category; keep opening while the next fits the
      // budget; once one doesn't, stop and collapse every section after it.
      if (!stop && (shown === 0 || shown + g.members.length <= AUTO_OPEN_SKILLS)) {
        shown += g.members.length
      } else {
        stop = true
        collapsed.add(key)
      }
    }
    return collapsed
  })
  const allExpanded = collapsedSections.size === 0
  const toggleSection = (key: string) =>
    setCollapsedSections((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  return (
    <>
      <Eyebrow>Skills</Eyebrow>
      {entries.length === 0 ? (
        <p className="mt-4 text-sm text-(--ink-2)">No skills in this kit yet.</p>
      ) : (
        // Same panel chrome as the skill-page file viewer: a surface-card shell
        // with a mono header bar (label + view control) and a mono footer meta bar,
        // so a kit's skills and a skill's files read as one family of panels.
        <div className="surface-card mt-4 flex flex-col overflow-hidden">
          <div className="flex items-center gap-2 border-b border-(--line) px-3.5 py-2">
            <ListGlyph className="h-[18px] w-[18px] shrink-0 text-(--ink-2)" />
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-(--ink-2)">
              {entries.length} {entries.length === 1 ? 'skill' : 'skills'}
              {grouped ? ` · ${groups.length} categories` : ''}
            </span>
            {grouped && (
              <button
                type="button"
                onClick={() =>
                  setCollapsedSections(allExpanded ? new Set(sectionKeys()) : new Set())
                }
                className="shrink-0 font-mono text-xs text-(--ink-2) transition-colors hover:text-(--ink)"
              >
                {allExpanded ? 'Collapse all' : 'Expand all'}
              </button>
            )}
          </div>
          {/* One continuous list; the subheads live inside as rows, so many
              categories still read as a single list, not many sections. */}
          <div className="divide-y divide-(--line)">
            {(grouped ? groups : [{ cat: null, members: entries }]).map(({ cat, members }) => {
              const sectionKey = cat?.key ?? OTHER
              const collapsed = grouped && collapsedSections.has(sectionKey)
              return (
                <div key={sectionKey} className="divide-y divide-(--line)">
                  {grouped && (
                    <GroupSubheadRow
                      cat={cat}
                      count={members.length}
                      preview={members.map((m) => humanizeSlug(refOf(m).slug)).join(', ')}
                      collapsed={collapsed}
                      onToggle={() => toggleSection(sectionKey)}
                    />
                  )}
                  {!collapsed &&
                    members.map((entry) => (
                      <SkillRow key={entry.skill_id} entry={entry} owner={owner} />
                    ))}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}

/** A small bulleted-list glyph for the panel header, matching the file viewer's
 *  header icon in weight. */
function ListGlyph({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M6 4.5h6.5M6 8h6.5M6 11.5h6.5" />
      <circle cx="3.25" cy="4.5" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="3.25" cy="8" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="3.25" cy="11.5" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  )
}
