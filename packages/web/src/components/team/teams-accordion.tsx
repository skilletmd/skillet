'use client'

import { useState, type ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Avatar } from '@/components/ui/avatar'
import { SettingsList } from '@/components/ui/settings-list'
import { ChevronRight } from '@/components/ui/icons'

export interface TeamRow {
  slug: string
  name: string
  role: string
  /** Server-rendered management body (members, invites, publish shortcuts). */
  panel: ReactNode
}

/**
 * The Teams list with inline, client-side expansion. Every team's panel is
 * pre-rendered on the server and passed in, so opening one is an instant
 * show/hide — no navigation, so the column never refreshes. The URL is kept in
 * sync via the History API (push/replaceState) so /settings/teams/<slug> stays
 * deep-linkable without triggering a route change.
 */
export function TeamsAccordion({
  teams,
  initialOpen,
}: {
  teams: TeamRow[]
  initialOpen: string | null
}) {
  const [open, setOpen] = useState<string | null>(initialOpen)

  function toggle(slug: string) {
    const next = open === slug ? null : slug
    setOpen(next)
    // Shallow URL sync — update the address bar without a Next navigation so the
    // panel doesn't re-render the whole column. Deep links still resolve on load.
    window.history.replaceState(null, '', next ? `/settings/teams/${next}` : '/settings/teams')
  }

  return (
    <SettingsList className="overflow-hidden">
      {teams.map((team) => {
        const isOpen = open === team.slug
        return (
          <li key={team.slug} className="overflow-hidden">
            <button
              type="button"
              onClick={() => toggle(team.slug)}
              aria-expanded={isOpen}
              aria-controls={`team-panel-${team.slug}`}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-(--accent-bg)"
            >
              <Avatar
                name={team.name}
                colorKey={team.slug}
                kind="team"
                size="md"
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-(--ink)">
                  {team.name}
                </span>
                <span className="block truncate font-mono text-xs text-(--ink-2)">
                  @{team.slug}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-3">
                <Badge variant="default">{team.role}</Badge>
                <span
                  className="inline-flex text-(--ink-2)"
                  style={{
                    transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                    transition: 'transform 200ms cubic-bezier(0.23, 1, 0.32, 1)',
                  }}
                >
                  <ChevronRight className="h-4 w-4" />
                </span>
              </span>
            </button>
            {isOpen && (
              <div
                id={`team-panel-${team.slug}`}
                className="border-t border-(--line) px-4 py-6 sm:px-6"
              >
                {team.panel}
              </div>
            )}
          </li>
        )
      })}
    </SettingsList>
  )
}
