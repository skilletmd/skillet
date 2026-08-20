import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ModerationLogView } from '@/app/(consumer)/moderation/page'

describe('ModerationLogView', () => {
  it('shows the empty state when nothing is enforced', () => {
    render(<ModerationLogView result={{ ok: true, entries: [] }} />)
    expect(screen.getByText('No active enforcement actions.')).toBeInTheDocument()
  })

  it('lists active enforcement with status and public reason', () => {
    render(
      <ModerationLogView
        result={{
          ok: true,
          entries: [
            { author: 'alice', slug: 'bad', status: 'quarantined', public_reason: 'ships a keylogger', acted_at: 1_700_000_000 },
            { author: 'bob', slug: 'hidden', status: 'unlisted', public_reason: null, acted_at: 1_700_000_100 },
          ],
        }}
      />,
    )
    expect(screen.getByText('alice/bad')).toBeInTheDocument()
    expect(screen.getByText('ships a keylogger')).toBeInTheDocument()
    expect(screen.getByText('Quarantined')).toBeInTheDocument()
    expect(screen.getByText('bob/hidden')).toBeInTheDocument()
    expect(screen.getByText('Unlisted')).toBeInTheDocument()
  })

  it('surfaces a fetch error instead of pretending the log is empty', () => {
    render(<ModerationLogView result={{ ok: false, status: 502 }} />)
    expect(screen.getByText(/registry responded 502/)).toBeInTheDocument()
    expect(screen.queryByText('No active enforcement actions.')).not.toBeInTheDocument()
  })
})
