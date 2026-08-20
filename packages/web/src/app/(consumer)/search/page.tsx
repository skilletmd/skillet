import type { Metadata } from 'next'
import { Suspense } from 'react'
import { SearchResultsView } from './search-results-view'

export const metadata: Metadata = {
  title: 'Search · Skillet',
  description: 'Search skills, kits, users, and teams on Skillet.',
  // Result pages are query-dependent and per-user; keep them out of the index.
  robots: { index: false, follow: true },
}

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <main className="search-page">
          <div className="search-state search-state--page" aria-live="polite">
            <span className="search-loading-dots" aria-hidden="true" />
          </div>
        </main>
      }
    >
      <SearchResultsView />
    </Suspense>
  )
}
