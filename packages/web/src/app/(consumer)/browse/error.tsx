'use client'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'

// Safety net for unexpected throws under /browse. Catalog soft-fail should
// empty the grid before this fires; we keep chrome recoverable if something
// else still escapes.
export default function BrowseError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="py-8">
      <EmptyState
        variant="card"
        action={
          <Button type="button" variant="secondary" onClick={reset}>
            Try again
          </Button>
        }
      >
        <p className="text-(--ink)">Browse couldn’t load right now.</p>
        <p className="mt-2 text-sm text-(--ink-2)">
          {error.message.includes('pnpm dev')
            ? error.message
            : 'The skill registry didn’t respond. This is usually temporary.'}
        </p>
      </EmptyState>
    </div>
  )
}
