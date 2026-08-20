// Member-row action controls + invite-accept flow.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemberRowActions, PendingInviteActions } from '@/components/team/member-row-actions'
import { AcceptInviteClient } from '@/components/team/accept-invite-client'
import type { OrgMember, PendingInvite } from '@/lib/org-team'

const removeMember = vi.fn()
const changeMemberRole = vi.fn()
const acceptInvite = vi.fn()

vi.mock('@/lib/org-team', async () => {
  const actual = await vi.importActual<typeof import('@/lib/org-team')>('@/lib/org-team')
  return {
    ...actual,
    removeMember: (...a: unknown[]) => removeMember(...a),
    changeMemberRole: (...a: unknown[]) => changeMemberRole(...a),
    acceptInvite: (...a: unknown[]) => acceptInvite(...a),
  }
})

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

function member(overrides: Partial<OrgMember> = {}): OrgMember {
  return { user_id: 'u_member', handle: 'member-one', role: 'member', ...overrides }
}

function invite(overrides: Partial<PendingInvite> = {}): PendingInvite {
  return {
    invite_id: 'inv_1',
    handle: null,
    email: 'invitee@example.com',
    role: 'member',
    ...overrides,
  }
}

beforeEach(() => {
  removeMember.mockReset()
  changeMemberRole.mockReset()
  acceptInvite.mockReset()
  push.mockReset()
})

describe('MemberRowActions — authorization gating', () => {
  it('owner sees a role picker and a remove button for a member', () => {
    render(<MemberRowActions orgSlug="acme" member={member()} viewerRole="owner" />)
    expect(screen.getByRole('combobox')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /remove @member-one/i })).toBeInTheDocument()
  })

  it('admin sees remove but no role picker', () => {
    render(<MemberRowActions orgSlug="acme" member={member()} viewerRole="admin" />)
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /remove/i })).toBeInTheDocument()
  })

  it('plain member sees only a static role badge — no controls', () => {
    render(<MemberRowActions orgSlug="acme" member={member()} viewerRole="member" />)
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText('member')).toBeInTheDocument()
  })

  it('never offers controls for the owner row, even to an owner viewer', () => {
    render(
      <MemberRowActions
        orgSlug="acme"
        member={member({ role: 'owner', handle: 'the-owner' })}
        viewerRole="owner"
      />,
    )
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText('owner')).toBeInTheDocument()
  })
})

describe('MemberRowActions — actions', () => {
  it('removing a member calls the API and notifies the parent', async () => {
    removeMember.mockResolvedValue({ kind: 'ok', data: { status: 'removed' } })
    const onChanged = vi.fn()
    render(
      <MemberRowActions
        orgSlug="acme"
        member={member()}
        viewerRole="owner"
        onChanged={onChanged}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /remove/i }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(removeMember).toHaveBeenCalledWith('acme', 'u_member')
  })

  it('changing the role calls the API with the chosen role', async () => {
    changeMemberRole.mockResolvedValue({ kind: 'ok', data: { role: 'admin' } })
    const onChanged = vi.fn()
    render(
      <MemberRowActions
        orgSlug="acme"
        member={member()}
        viewerRole="owner"
        onChanged={onChanged}
      />,
    )
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'admin' } })
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(changeMemberRole).toHaveBeenCalledWith('acme', 'u_member', 'admin')
  })

  it('surfaces a forbidden error without notifying the parent', async () => {
    removeMember.mockResolvedValue({ kind: 'forbidden' })
    const onChanged = vi.fn()
    render(
      <MemberRowActions
        orgSlug="acme"
        member={member()}
        viewerRole="owner"
        onChanged={onChanged}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /remove/i }))
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('redirects to login when the session has expired', async () => {
    removeMember.mockResolvedValue({ kind: 'unauthorized' })
    render(<MemberRowActions orgSlug="acme" member={member()} viewerRole="owner" />)
    fireEvent.click(screen.getByRole('button', { name: /remove/i }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/login'))
  })
})

describe('PendingInviteActions', () => {
  it('owner/admin can revoke a pending invite', async () => {
    removeMember.mockResolvedValue({ kind: 'ok', data: { status: 'revoked' } })
    const onChanged = vi.fn()
    render(
      <PendingInviteActions
        orgSlug="acme"
        invite={invite()}
        viewerRole="admin"
        onChanged={onChanged}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /revoke/i }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(removeMember).toHaveBeenCalledWith('acme', 'inv_1')
  })

  it('a plain member sees no revoke control', () => {
    render(<PendingInviteActions orgSlug="acme" invite={invite()} viewerRole="member" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText('invited')).toBeInTheDocument()
  })
})

describe('AcceptInviteClient', () => {
  it('accepting redeems the invite and routes into the team', async () => {
    acceptInvite.mockResolvedValue({
      kind: 'ok',
      data: { org: { id: 'o1', slug: 'acme', name: 'Acme Corp' }, role: 'member' },
    })
    render(<AcceptInviteClient orgSlug="acme" inviteId="inv_1" />)
    fireEvent.click(screen.getByRole('button', { name: /accept invitation/i }))
    await waitFor(() => expect(acceptInvite).toHaveBeenCalledWith('acme', 'inv_1'))
    expect(push).toHaveBeenCalledWith('/settings/teams')
    expect(screen.getByText('Acme Corp')).toBeInTheDocument()
  })

  it('shows a targeted message when the invite is for a different account', async () => {
    acceptInvite.mockResolvedValue({
      kind: 'forbidden',
      status: 403,
      error: 'invite_not_for_caller',
    })
    render(<AcceptInviteClient orgSlug="acme" inviteId="inv_1" />)
    fireEvent.click(screen.getByRole('button', { name: /accept invitation/i }))
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByRole('alert').textContent).toMatch(/different account/i)
    expect(push).not.toHaveBeenCalled()
  })

  it('flags an already-used invite', async () => {
    acceptInvite.mockResolvedValue({ kind: 'error', status: 409, error: 'invite_already_redeemed' })
    render(<AcceptInviteClient orgSlug="acme" inviteId="inv_1" />)
    fireEvent.click(screen.getByRole('button', { name: /accept invitation/i }))
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByRole('alert').textContent).toMatch(/already been used/i)
  })

  it('routes to login when the visitor is signed out', async () => {
    acceptInvite.mockResolvedValue({ kind: 'unauthorized' })
    render(<AcceptInviteClient orgSlug="acme" inviteId="inv_1" />)
    fireEvent.click(screen.getByRole('button', { name: /accept invitation/i }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/login'))
  })
})
