'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { searchUniversal, type SearchGroups } from '@/lib/search-client'
import {
  buildGroupViews,
  flattenResults,
  resultKey,
  searchAllHref,
  TYPEAHEAD_PER_GROUP,
} from '@/lib/search-view'
import { SearchResultRow } from './search-result-row'
import type { AsyncStatus } from '@/lib/types'

const DEBOUNCE_MS = 200
const LOADING_DELAY_MS = 150
const RECENTS_KEY = 'skillet:recent-searches'
const MAX_RECENTS = 5

type Status = AsyncStatus

function readRecents(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((s): s is string => typeof s === 'string').slice(0, MAX_RECENTS)
  } catch {
    return []
  }
}

function pushRecent(q: string): string[] {
  const trimmed = q.trim()
  if (!trimmed) return readRecents()
  const next = [trimmed, ...readRecents().filter((r) => r !== trimmed)].slice(0, MAX_RECENTS)
  try {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next))
  } catch {
    // localStorage may be unavailable (private mode); recents are best-effort.
  }
  return next
}

function SearchGlyph() {
  return (
    <svg
      className="search-input-glyph"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function ClearGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M4 4l8 8M12 4l-8 8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

export interface SearchBoxProps {
  /** `inline` = header bar; `sheet` = inside the mobile full-screen sheet. */
  variant?: 'inline' | 'sheet'
  autoFocus?: boolean
  /** Lets a parent (the ⌘K shortcut) focus this input. */
  inputRef?: React.RefObject<HTMLInputElement | null>
  /** Called after navigating to a result — closes the mobile sheet. */
  onNavigate?: () => void
  /** Called on the second Escape (input already empty) — closes the sheet. */
  onEscapeWhenEmpty?: () => void
}

export function SearchBox({
  variant = 'inline',
  autoFocus = false,
  inputRef,
  onNavigate,
  onEscapeWhenEmpty,
}: SearchBoxProps) {
  const router = useRouter()
  const baseId = useId()
  const listboxId = `${baseId}-listbox`
  const optionId = useCallback((i: number) => `${baseId}-opt-${i}`, [baseId])

  const [query, setQuery] = useState('')
  const [groups, setGroups] = useState<SearchGroups>({})
  const [status, setStatus] = useState<Status>('idle')
  const [open, setOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const [recents, setRecents] = useState<string[]>([])

  const containerRef = useRef<HTMLDivElement | null>(null)
  const localInputRef = useRef<HTMLInputElement | null>(null)
  const resolvedInputRef = inputRef ?? localInputRef

  const trimmed = query.trim()
  const groupViews = useMemo(() => buildGroupViews(groups, TYPEAHEAD_PER_GROUP), [groups])
  const flat = useMemo(() => flattenResults(groupViews), [groupViews])
  const hasResults = flat.length > 0

  // Load recent searches once on mount (client-only).
  useEffect(() => {
    setRecents(readRecents())
  }, [])

  useEffect(() => {
    if (autoFocus) resolvedInputRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus])

  // Debounced search. Aborts the prior request when the query changes; only
  // flips to the loading state after LOADING_DELAY_MS so fast responses don't
  // flash a spinner.
  useEffect(() => {
    if (trimmed === '') {
      setGroups({})
      setStatus('idle')
      setHighlightedIndex(-1)
      return
    }

    const controller = new AbortController()
    let loadingTimer: ReturnType<typeof setTimeout> | undefined

    const debounce = setTimeout(() => {
      loadingTimer = setTimeout(() => setStatus('loading'), LOADING_DELAY_MS)
      searchUniversal(trimmed, {
        limit: TYPEAHEAD_PER_GROUP + 1,
        signal: controller.signal,
      })
        .then((res) => {
          if (controller.signal.aborted) return
          if (loadingTimer) clearTimeout(loadingTimer)
          setGroups(res.groups)
          setStatus('ready')
          setHighlightedIndex(-1)
        })
        .catch((err: unknown) => {
          if (
            controller.signal.aborted ||
            (err instanceof DOMException && err.name === 'AbortError')
          ) {
            return
          }
          if (loadingTimer) clearTimeout(loadingTimer)
          // eslint-disable-next-line no-console
          console.error('universal search failed', err)
          setStatus('error')
        })
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(debounce)
      if (loadingTimer) clearTimeout(loadingTimer)
      controller.abort()
    }
  }, [trimmed])

  // Close on click outside (inline only — the sheet owns the whole screen).
  useEffect(() => {
    if (!open || variant === 'sheet') return
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [open, variant])

  // Keep the highlighted row scrolled into view.
  useEffect(() => {
    if (highlightedIndex < 0) return
    const el = document.getElementById(optionId(highlightedIndex))
    el?.scrollIntoView?.({ block: 'nearest' })
  }, [highlightedIndex, optionId])

  const recordAndClose = useCallback(() => {
    setRecents(pushRecent(query))
    setOpen(false)
    setHighlightedIndex(-1)
    onNavigate?.()
  }, [query, onNavigate])

  const navigateTo = useCallback(
    (url: string) => {
      recordAndClose()
      router.push(url)
    },
    [recordAndClose, router],
  )

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      switch (event.key) {
        case 'ArrowDown':
          if (!hasResults) return
          event.preventDefault()
          setOpen(true)
          setHighlightedIndex((i) => (i + 1) % flat.length)
          break
        case 'ArrowUp':
          if (!hasResults) return
          event.preventDefault()
          setHighlightedIndex((i) => (i <= 0 ? flat.length - 1 : i - 1))
          break
        case 'Enter': {
          const selected = highlightedIndex >= 0 ? flat[highlightedIndex] : undefined
          if (selected) {
            event.preventDefault()
            navigateTo(selected.url)
          } else if (trimmed !== '') {
            event.preventDefault()
            navigateTo(searchAllHref(trimmed))
          }
          break
        }
        case 'Escape':
          if (query !== '') {
            // First Esc clears the value.
            setQuery('')
            setGroups({})
            setStatus('idle')
            setHighlightedIndex(-1)
          } else {
            // Second Esc (already empty) closes/blurs.
            setOpen(false)
            resolvedInputRef.current?.blur()
            onEscapeWhenEmpty?.()
          }
          break
        default:
          break
      }
    },
    [
      flat,
      hasResults,
      highlightedIndex,
      navigateTo,
      onEscapeWhenEmpty,
      query,
      resolvedInputRef,
      trimmed,
    ],
  )

  const showShortcutBadge = variant === 'inline' && query === '' && !open

  function renderDropdownBody() {
    if (status === 'loading') {
      return (
        <div className="search-state search-state--loading" aria-live="polite">
          <span className="search-loading-dots" aria-hidden="true" />
          <span className="sr-only">Searching…</span>
        </div>
      )
    }

    if (status === 'error') {
      return (
        <div className="search-state" role="status">
          <p className="search-state-title">Something went wrong.</p>
          <p className="search-state-sub">Try again in a moment.</p>
        </div>
      )
    }

    if (trimmed === '') {
      return (
        <div className="search-empty-hint">
          {recents.length > 0 && (
            <>
              <div className="search-section-header" role="presentation">
                <span>Recent</span>
              </div>
              {recents.map((r) => (
                <button
                  key={r}
                  type="button"
                  className="search-recent-row"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setQuery(r)
                    resolvedInputRef.current?.focus()
                  }}
                >
                  <SearchGlyph />
                  <span>{r}</span>
                </button>
              ))}
              <div className="search-group-divider" />
            </>
          )}
          <p className="search-hint-line">Try: skills, kit names, @handles</p>
        </div>
      )
    }

    if (status === 'ready' && !hasResults) {
      return (
        <div className="search-state" role="status">
          <p className="search-state-title">No results for “{trimmed}”</p>
          <p className="search-state-sub">Check the spelling or try a different term.</p>
        </div>
      )
    }

    if (!hasResults) return null

    let idx = -1
    return (
      <>
        {groupViews.map((g, gi) => (
          <div key={g.key} className="search-group" role="presentation">
            {gi > 0 && <div className="search-group-divider" />}
            <div className="search-section-header" role="presentation">
              <span>{g.label}</span>
              {g.hasMore && (
                <Link
                  href={searchAllHref(trimmed, g.key)}
                  className="search-see-all"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={recordAndClose}
                >
                  see all
                </Link>
              )}
            </div>
            {g.items.map((item) => {
              idx += 1
              const i = idx
              return (
                <SearchResultRow
                  key={resultKey(item)}
                  id={optionId(i)}
                  item={item}
                  highlighted={i === highlightedIndex}
                  onHover={() => setHighlightedIndex(i)}
                  onActivate={recordAndClose}
                />
              )
            })}
          </div>
        ))}
        <Link
          href={searchAllHref(trimmed)}
          className="search-see-all-footer"
          onMouseDown={(e) => e.preventDefault()}
          onClick={recordAndClose}
        >
          See all results for “{trimmed}”
        </Link>
      </>
    )
  }

  return (
    <div ref={containerRef} className={`universal-search-box universal-search-box--${variant}`}>
      <div className="search-input">
        <SearchGlyph />
        <input
          ref={resolvedInputRef}
          type="text"
          className="search-input-field"
          placeholder="Search"
          value={query}
          role="combobox"
          aria-label="Search Skillet"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={listboxId}
          aria-activedescendant={highlightedIndex >= 0 ? optionId(highlightedIndex) : undefined}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {query ? (
          <button
            type="button"
            className="search-input-clear"
            aria-label="Clear search"
            // Keep the input from blurring before the click registers.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setQuery('')
              setOpen(true)
              resolvedInputRef.current?.focus()
            }}
          >
            <ClearGlyph />
          </button>
        ) : (
          showShortcutBadge && (
            <kbd className="search-shortcut-badge" aria-hidden="true">
              ⌘K
            </kbd>
          )
        )}
      </div>
      {open && (
        <div id={listboxId} role="listbox" className="search-dropdown">
          {renderDropdownBody()}
        </div>
      )}
    </div>
  )
}
