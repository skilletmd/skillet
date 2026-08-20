'use client'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'

// Route-level error boundary for the skills directory. Reached when the live
// catalog fetch fails (registry unreachable or non-OK) — see
// getSkillCatalog / RegistryUnavailableError. We show an honest "couldn't load"
// with a retry rather than fabricated seed skills or a raw stack trace.
export default function SkillsError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto max-w-[1120px] px-[clamp(16px,4vw,32px)] py-12">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Skills</h1>
      </div>

      <EmptyState
        variant="card"
        action={
          <Button type="button" variant="secondary" onClick={reset}>
            Try again
          </Button>
        }
      >
        <p className="text-(--ink)">The directory couldn’t load right now.</p>
        <p className="mt-2 text-sm text-(--ink-2)">
          {error.message.includes('pnpm dev')
            ? error.message
            : 'The skill registry didn’t respond. This is usually temporary.'}
        </p>
      </EmptyState>
    </main>
  )
}
