import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// Mock the server-actions module so the client components don't pull in
// next/cache, next/navigation, or @/auth during the test.
vi.mock('@/app/(consumer)/settings/teams/actions', () => ({
  createTeamAction: vi.fn(async () => ({})),
  inviteMemberAction: vi.fn(async () => ({})),
}))

import { InviteMemberForm } from '@/components/team/invite-member-form'
import { CreateTeamForm } from '@/components/team/create-team-form'

describe('InviteMemberForm', () => {
  it('offers Member and Admin roles but never Owner (AC: role picker)', () => {
    render(<InviteMemberForm slug="acme" canInvite />)
    const select = screen.getByLabelText('Role') as HTMLSelectElement
    const options = Array.from(select.options).map((o) => o.value)
    expect(options).toEqual(['member', 'admin'])
    expect(options).not.toContain('owner')
    expect(select.value).toBe('member') // sensible default
  })

  it('renders the invite input for an owner/admin', () => {
    render(<InviteMemberForm slug="acme" canInvite />)
    expect(screen.getByPlaceholderText(/handle or email/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /invite/i })).toBeTruthy()
  })

  it('hides the form and explains when the viewer cannot invite (AC: owner/admin only)', () => {
    render(<InviteMemberForm slug="acme" canInvite={false} />)
    expect(screen.queryByPlaceholderText(/handle or email/i)).toBeNull()
    expect(screen.getByText(/only owners and admins can invite/i)).toBeTruthy()
  })
})

describe('CreateTeamForm', () => {
  it('previews the derived team URL as the name is typed', () => {
    render(<CreateTeamForm />)
    fireEvent.change(screen.getByPlaceholderText('Acme Skills'), {
      target: { value: 'My Cool Team!' },
    })
    expect(screen.getByText('https://skillet.md/my-cool-team')).toBeTruthy()
  })
})
