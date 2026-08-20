'use client'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'

// Route-level error boundary for an author profile and the skill pages nested
// under it. Reached when a primary fetch (getAuthorProfile / getSkill) throws
// RegistryUnavailableError — the registry is DOWN. This is deliberately distinct
// from not-found.tsx (a genuine 404): an outage must read as "temporarily
// unavailable, try again," never as "this person/skill doesn't exist."
export default function AuthorError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto max-w-[1120px] px-[clamp(16px,4vw,32px)] py-12">
      <EmptyState
        variant="card"
        action={
          <Button type="button" variant="secondary" onClick={reset}>
            Try again
          </Button>
        }
      >
        <p className="text-(--ink)">This page couldn’t load right now.</p>
        <p className="mt-2 text-sm text-(--ink-2)">
          {error.message.includes('pnpm dev')
            ? error.message
            : 'The skill registry didn’t respond. This is usually temporary.'}
        </p>
      </EmptyState>
    </main>
  )
}
