'use client'

import { useState } from 'react'
import Image from 'next/image'
import { EmptyState } from '@/components/ui/empty-state'
import { Panel } from '@/components/ui/panel'
import { Button } from '@/components/ui/button'
import { CreateTeamForm } from '@/components/team/create-team-form'

/**
 * Teams empty state — the shared `EmptyState` card (matching the GitHub / other
 * settings empty states) with the create-team CTA inside it. The lede above
 * (TeamsHeader) carries the "what a team is" copy, so this stays a short nudge.
 * "New team" toggles the create form inline, the same disclosure the populated
 * header uses.
 */
export function TeamsEmptyState() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <EmptyState
        variant="card"
        illustration={
          <Image
            src="/illustrations/empty-teams.png"
            alt=""
            width={226}
            height={240}
            className="empty-illo h-24 w-auto"
          />
        }
        action={
          <Button
            type="button"
            variant="primary"
            size="lg"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? 'Cancel' : 'New team'}
          </Button>
        }
      >
        <span className="text-base font-semibold text-(--ink)">Create your first team</span>
      </EmptyState>
      {open && (
        <Panel padding="md" className="mt-4">
          <CreateTeamForm />
        </Panel>
      )}
    </>
  )
}
