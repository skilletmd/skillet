// Profile editor (direct-edit, no mode): fields are always editable, a Save bar
// appears only when dirty, PATCH + refresh on success, friendly error on failure.
// profile-update + router are mocked.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { EditDisplayName } from '@/components/edit-display-name'

const updateProfile = vi.fn()
const uploadAvatar = vi.fn()
const refresh = vi.fn()
const updateSession = vi.fn()

vi.mock('@/lib/profile-update', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/profile-update')>('@/lib/profile-update')
  return {
    ...actual,
    updateProfile: (...a: unknown[]) => updateProfile(...a),
    uploadAvatar: (...a: unknown[]) => uploadAvatar(...a),
  }
})
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('next-auth/react', () => ({ useSession: () => ({ update: updateSession }) }))

beforeEach(() => {
  updateProfile.mockReset()
  uploadAvatar.mockReset()
  refresh.mockReset()
  updateSession.mockReset()
  updateProfile.mockResolvedValue(undefined)
  // The component awaits updateSession(...).catch(...); it must return a promise
  // (real useSession().update does), or the .catch throws and save/upload aborts.
  updateSession.mockResolvedValue(undefined)
})

describe('EditDisplayName', () => {
  it('renders the profile fields with their current values', () => {
    render(
      <EditDisplayName
        author="ada"
        initialName="Ada"
        initialBio="First programmer."
        initialProfileUrl="https://ada.example"
        email="ada@example.com"
      />,
    )

    expect(screen.getByLabelText('Display name')).toHaveValue('Ada')
    expect(screen.getByLabelText('Bio')).toHaveValue('First programmer.')
    expect(screen.getByLabelText('Link')).toHaveValue('https://ada.example')
    expect(screen.getByText('@ada')).toBeInTheDocument()
    expect(screen.getByText(/ada@example\.com/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View profile' })).toHaveAttribute('href', '/ada')
  })

  it('shows the Save bar only once a field changes', () => {
    render(<EditDisplayName author="ada" initialName="Ada" />)

    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Ada Lovelace' } })
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('saves, refreshes, and shows a saved indicator', async () => {
    render(<EditDisplayName author="ada" initialName="Ada" />)

    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Ada Lovelace' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(updateProfile).toHaveBeenCalledWith(
        'ada',
        expect.objectContaining({ name: 'Ada Lovelace' }),
      ),
    )
    expect(refresh).toHaveBeenCalled()
    await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument())
  })

  it('discards changes back to the saved values', () => {
    render(<EditDisplayName author="ada" initialName="Ada" />)

    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Mallory' } })
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))

    expect(screen.getByLabelText('Display name')).toHaveValue('Ada')
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  })

  it('uploads a picked image immediately and pushes the URL into the session', async () => {
    // The upload goes straight to R2 via uploadAvatar (mocked) and becomes the
    // live avatar — no Save step, no base64.
    const avatarUrl = 'https://pub-x.r2.dev/dev/abc123'
    uploadAvatar.mockResolvedValue(avatarUrl)

    render(<EditDisplayName author="ada" initialName="Ada" />)

    fireEvent.click(screen.getByRole('button', { name: 'Change avatar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Upload image' }))
    const file = new File(['avatar'], 'avatar.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText('Upload avatar image'), { target: { files: [file] } })

    await waitFor(() => expect(uploadAvatar).toHaveBeenCalledWith('ada', file))
    await waitFor(() => expect(updateSession).toHaveBeenCalledWith({ image: avatarUrl }))
    expect(refresh).toHaveBeenCalled()
    // Immediate upload is not a pending edit — no Save bar appears.
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  })

  it('surfaces an avatar upload error without changing the avatar', async () => {
    uploadAvatar.mockRejectedValue(new Error('Image is too large (max 12MB).'))

    render(<EditDisplayName author="ada" initialName="Ada" />)

    fireEvent.click(screen.getByRole('button', { name: 'Change avatar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Upload image' }))
    fireEvent.change(screen.getByLabelText('Upload avatar image'), {
      target: { files: [new File(['avatar'], 'avatar.png', { type: 'image/png' })] },
    })

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/too large/i))
    expect(updateSession).not.toHaveBeenCalled()
  })

  it('surfaces a server error and does not refresh', async () => {
    updateProfile.mockRejectedValue(new Error('You can only edit your own profile.'))
    render(<EditDisplayName author="ada" initialName="Ada" />)

    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Mallory' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/your own profile/i))
    expect(refresh).not.toHaveBeenCalled()
  })

  it('blocks an empty name inline', async () => {
    render(<EditDisplayName author="ada" initialName="Ada" />)

    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/empty/i))
    expect(updateProfile).not.toHaveBeenCalled()
  })
})
