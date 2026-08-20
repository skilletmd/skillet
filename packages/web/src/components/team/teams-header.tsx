'use client'

import { useState } from 'react'
import { PageHeader } from '@/components/page-header'
import { Panel } from '@/components/ui/panel'
import { Button } from '@/components/ui/button'
import { Plus } from '@/components/ui/icons'
import { CreateTeamForm } from '@/components/team/create-team-form'

/**
 * Teams page header — the shared {@link PageHeader} (h1 + lede) like every other
 * settings page, with the create-team control in its action slot. The form is an
 * inline disclosure under the header, replacing the LibrarySection wrapper Teams
 * used to special-case.
 */
export function TeamsHeader({ hideAction = false }: { hideAction?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <PageHeader
        title="Teams"
        lede="A team is a shared space for publishing. Invite teammates, then publish kits and skills under the team so everyone installs the same versions."
        action={
          hideAction ? undefined : (
            <Button
              type="button"
              variant="secondary"
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
            >
              {open ? (
                'Cancel'
              ) : (
                <>
                  <Plus className="h-3.5 w-3.5" />
                  New team
                </>
              )}
            </Button>
          )
        }
      />
      {open && (
        <Panel padding="md" className="mb-6">
          <CreateTeamForm />
        </Panel>
      )}
    </>
  )
}
