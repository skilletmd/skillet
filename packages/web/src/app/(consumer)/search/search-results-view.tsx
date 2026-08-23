'use client'

import { useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SearchResultRow } from '@/components/search/search-result-row'
import { searchUniversal, type SearchGroups } from '@/lib/search-client'
import {
  buildGroupViews,
  displaySectionKeys,
  resultKey,
  SEARCH_DISPLAY_SECTIONS,
} from '@/lib/search-view'
import type { AsyncStatus } from '@/lib/types'

const FULL_LIMIT = 25

type Status = AsyncStatus

function isSectionId(value: string | null): boolean {
  return value !== null && SEARCH_DISPLAY_SECTIONS.some((s) => s.id === value)
}

export function SearchResultsView() {
  const params = useSearchParams()
  const query = (params.get('q') ?? '').trim()
  const typeParam = params.get('type')
  const activeType = isSectionId(typeParam) ? typeParam : null

  const [groups, setGroups] = useState<SearchGroups>({})
  const [status, setStatus] = useState<Status>('idle')
  // Controlled so the field follows the URL: clearing navigates to /search, and
  // an uncontrolled defaultValue would keep the old text in the DOM.
  const [term, setTerm] = useState(query)

  useEffect(() => {
    setTerm(query)
  }, [query])

  useEffect(() => {
    if (query === '') {
      setGroups({})
      setStatus('idle')
      return
    }

    const controller = new AbortController()
    setStatus('loading')
    searchUniversal(query, {
      types: activeType ? (displaySectionKeys(activeType) ?? undefined) : undefined,
      limit: FULL_LIMIT,
      signal: controller.signal,
    })
      .then((res) => {
        if (controller.signal.aborted) return
        setGroups(res.groups)
        setStatus('ready')
      })
      .catch((err: unknown) => {
        if (
          controller.signal.aborted ||
          (err instanceof DOMException && err.name === 'AbortError')
        ) {
          return
        }
        // eslint-disable-next-line no-console
        console.error('universal search failed', err)
        setStatus('error')
      })

    return () => controller.abort()
  }, [query, activeType])

  const groupViews = buildGroupViews(groups)
  const hasResults = groupViews.length > 0

  return (
    <main className="search-page">
      <header className="search-page-header">
        <h1 className="search-page-title">
          {query ? <>Search results for “{query}”</> : 'Search'}
        </h1>
        <form action="/search" role="search" className="search-page-form">
          <label className="sr-only" htmlFor="search-page-q">
            Search Skillet
          </label>
          <div className="search-page-field">
            <Input
              id="search-page-q"
              name="q"
              type="search"
              size="lg"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Search skills, kits, people..."
              className="pr-10 [&::-webkit-search-cancel-button]:appearance-none"
            />
            {query && (
              <Link href="/search" className="search-page-clear" aria-label="Clear search">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path
                    d="M4 4l8 8M12 4l-8 8"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
              </Link>
            )}
          </div>
          <Button type="submit" variant="primary" size="lg">
            Search
          </Button>
        </form>
        {query && (
          <nav className="search-page-filters" aria-label="Filter by type">
            <FilterLink query={query} type={null} active={activeType === null}>
              All
            </FilterLink>
            {SEARCH_DISPLAY_SECTIONS.map((section) => (
              <FilterLink
                key={section.id}
                query={query}
                type={section.id}
                active={activeType === section.id}
              >
                {section.label}
              </FilterLink>
            ))}
          </nav>
        )}
      </header>

      {query === '' && <SearchStart />}

      {status === 'loading' && (
        <div className="search-state search-state--page" aria-live="polite">
          <span className="search-loading-dots" aria-hidden="true" />
          <span className="sr-only">Searching…</span>
        </div>
      )}

      {status === 'error' && (
        <div className="search-state search-state--page" role="status">
          <p className="search-state-title">Something went wrong.</p>
          <p className="search-state-sub">Try again in a moment.</p>
        </div>
      )}

      {status === 'ready' && !hasResults && (
        <div className="search-state search-state--page" role="status">
          <p className="search-state-title">No results for “{query}”</p>
          <p className="search-state-sub">Check the spelling or try a different term.</p>
        </div>
      )}

      {status === 'ready' && hasResults && (
        <div className="search-page-results">
          {groupViews.map((g) => (
            <section key={g.key} className="search-page-group">
              <h2 className="search-page-group-title">
                {g.label}
                <span className="search-page-group-count">{g.items.length}</span>
              </h2>
              <div role="list" className="search-page-group-list">
                {g.items.map((item) => (
                  <SearchResultRow
                    key={resultKey(item)}
                    id={`page-${resultKey(item)}`}
                    item={item}
                    highlighted={false}
                    onHover={() => {}}
                    onActivate={() => {}}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  )
}

function SearchStart() {
  const suggestions = [
    { label: 'PR review', href: '/search?q=pr+review' },
    { label: 'Writing', href: '/browse/writing' },
    { label: 'Security', href: '/browse/security' },
    { label: 'People', href: '/browse/people' },
  ]

  return (
    <section className="search-start" aria-label="Search suggestions">
      <p className="search-page-empty">Search across skills, kits, people, and teams.</p>
      <div className="search-start-links">
        {suggestions.map((item) => (
          <Link key={item.label} href={item.href} className="search-filter-chip">
            {item.label}
          </Link>
        ))}
      </div>
    </section>
  )
}

function FilterLink({
  query,
  type,
  active,
  children,
}: {
  query: string
  type: string | null
  active: boolean
  children: React.ReactNode
}) {
  const params = new URLSearchParams({ q: query })
  if (type) params.set('type', type)
  return (
    <a
      href={`/search?${params.toString()}`}
      className={`search-filter-chip${active ? ' is-active' : ''}`}
      aria-current={active ? 'page' : undefined}
    >
      {children}
    </a>
  )
}
