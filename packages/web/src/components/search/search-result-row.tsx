'use client'

import Link from 'next/link'
import type { SearchResultItem } from '@/lib/registry'
import { Avatar } from '@/components/ui/avatar'
import { CoverArt } from '@/components/cover/cover'
import { PrivateMark } from '@/components/visibility-badge'

function ArrowOut() {
  return (
    <svg
      className="search-result-arrow"
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3 9L9 3M9 3H4M9 3V8"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** The skill/kit cover mark — same generative art as the cards, sized for a row.
 *  Mirrors SkillIcon / KitStackIcon: a skill gets its category ground + section
 *  shape (listMark for the uncategorized placeholder), a kit gets the compact
 *  band composition of its members' categories. */
function CoverMark({ seed, categories, kit }: { seed: string; categories: (string | null | undefined)[]; kit: boolean }) {
  return (
    <span
      className="relative inline-flex h-7 w-7 shrink-0 overflow-hidden rounded-[7px] ring-1 ring-black/[0.06]"
      aria-hidden="true"
    >
      <CoverArt
        seed={seed}
        categories={categories}
        listMark={!kit}
        className="absolute inset-0 h-full w-full"
      />
    </span>
  )
}

/** A document line icon for doc results — matches the line-icon aesthetic. */
function DocIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M4 1.75h4.5L12.25 5.5v8.75a.5.5 0 0 1-.5.5h-7.5a.5.5 0 0 1-.5-.5V2.25a.5.5 0 0 1 .5-.5Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M8.5 1.75V5.5h3.75" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M6 8.75h4M6 11.25h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

function rowBody(item: SearchResultItem) {
  switch (item.type) {
    case 'skill':
      return (
        <>
          <CoverMark
            seed={`${item.author}/${item.slug}`}
            categories={[item.category ?? null]}
            kit={false}
          />
          <span className="search-result-text">
            <span className="search-result-title">
              <span className="search-result-name">{item.slug}</span>
              {item.visibility === 'private' ? (
                <PrivateMark className="search-result-meta text-(--ink-2)" />
              ) : (
                item.install_count > 0 && (
                  <span className="search-result-meta">
                    {item.install_count.toLocaleString()} installs
                  </span>
                )
              )}
            </span>
            <span className="search-result-sub">
              <span className="search-result-handle">@{item.author}</span>
              {item.description ? (
                <>
                  {' · '}
                  {item.description}
                </>
              ) : null}
            </span>
          </span>
        </>
      )
    case 'kit':
      return (
        <>
          <CoverMark seed={item.kit_id} categories={item.skill_categories ?? []} kit />
          <span className="search-result-text">
            <span className="search-result-title">
              <span className="search-result-name">
                {item.owner}/{item.name}
              </span>
              {item.visibility === 'private' && (
                <PrivateMark className="search-result-meta text-(--ink-2)" />
              )}
            </span>
            <span className="search-result-sub">
              <span className="search-result-handle">{item.owner}</span>
              {item.description ? (
                <>
                  {' · '}
                  {item.description}
                </>
              ) : null}
            </span>
          </span>
        </>
      )
    case 'author': {
      return (
        <>
          <span className="search-result-avatar" aria-hidden="true">
            <Avatar
              src={item.avatar_url}
              name={item.name || item.username}
              colorKey={item.username}
              className="h-full w-full"
            />
          </span>
          <span className="search-result-text">
            <span className="search-result-title">
              <span className="search-result-name">@{item.username}</span>
            </span>
            {item.name && item.name !== item.username ? (
              <span className="search-result-sub">{item.name}</span>
            ) : null}
          </span>
        </>
      )
    }
    case 'team':
      return (
        <>
          <span className="search-result-icon" aria-hidden="true">
            ◈
          </span>
          <span className="search-result-text">
            <span className="search-result-title">
              <span className="search-result-name">{item.name}</span>
            </span>
            <span className="search-result-sub">{item.slug}</span>
          </span>
        </>
      )
    case 'doc':
      return (
        <>
          <span className="search-result-icon" aria-hidden="true">
            <DocIcon />
          </span>
          <span className="search-result-text">
            <span className="search-result-title">
              <span className="search-result-name">{item.title}</span>
            </span>
            <span className="search-result-sub">
              <span className="search-result-handle">{item.section}</span>
              {item.snippet ? (
                <>
                  {' · '}
                  {item.snippet}
                </>
              ) : null}
            </span>
          </span>
        </>
      )
  }
}

export interface SearchResultRowProps {
  item: SearchResultItem
  /** Whether this row is the keyboard-highlighted option. */
  highlighted: boolean
  /** Pointer entered this row — parent updates `highlightedIndex`. */
  onHover: () => void
  /** Row activated (click). Parent records the recent search and closes. */
  onActivate: () => void
  /** id for aria-activedescendant wiring. */
  id: string
}

export function SearchResultRow({
  item,
  highlighted,
  onHover,
  onActivate,
  id,
}: SearchResultRowProps) {
  return (
    <Link
      href={item.url}
      id={id}
      role="option"
      aria-selected={highlighted}
      className={`search-result-row${highlighted ? ' is-highlighted' : ''}`}
      // Prevent the input from blurring before the click navigates.
      onMouseDown={(e) => e.preventDefault()}
      onMouseEnter={onHover}
      onClick={onActivate}
    >
      {rowBody(item)}
      <ArrowOut />
    </Link>
  )
}
