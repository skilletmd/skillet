import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// The wrappers inject router.refresh() as onChanged; stub the router so render works.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

import {
  MemberRowActionsLive,
  PendingInviteActionsLive,
} from '@/components/team/member-row-actions-live'

describe('MemberRowActionsLive (team page wiring)', () => {
  it('mounts the remove + role controls for an owner viewer', () => {
    render(
      <MemberRowActionsLive
        orgSlug="acme"
        member={{ user_id: 'u2', handle: 'taylor', role: 'member' }}
        viewerRole="owner"
      />,
    )
    expect(screen.getByRole('button', { name: /remove @taylor/i })).toBeTruthy()
    expect(screen.getByLabelText(/role for @taylor/i)).toBeTruthy()
  })

  it('shows only the static badge to a plain member viewer', () => {
    render(
      <MemberRowActionsLive
        orgSlug="acme"
        member={{ user_id: 'u2', handle: 'taylor', role: 'member' }}
        viewerRole="member"
      />,
    )
    expect(screen.queryByRole('button', { name: /remove/i })).toBeNull()
  })
})

describe('PendingInviteActionsLive', () => {
  it('mounts the revoke control for an owner/admin viewer', () => {
    render(
      <PendingInviteActionsLive
        orgSlug="acme"
        invite={{ invite_id: 'i1', handle: 'newbie', email: null, role: 'member' }}
        viewerRole="admin"
      />,
    )
    expect(screen.getByRole('button', { name: /revoke invite for @newbie/i })).toBeTruthy()
  })
})
