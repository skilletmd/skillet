import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureBrowserSigningReady } from '@/lib/signing-setup'

const mockBrowserKeyId = vi.fn(() => 'localkey'.repeat(8))
const mockGenerateBrowserAuthorKey = vi.fn(async () => 'newbrowser'.repeat(8))

vi.mock('@/lib/browser-author-key', () => ({
  browserKeyId: () => mockBrowserKeyId(),
  generateBrowserAuthorKey: () => mockGenerateBrowserAuthorKey(),
  publicKeyBase64FromStored: vi.fn(() => 'UFVCTElDCg=='),
}))

const mockLoadDeviceKey = vi.fn()
const mockFetchDelegations = vi.fn()

vi.mock('@/lib/device-key', () => ({
  loadDeviceKey: () => mockLoadDeviceKey(),
}))

vi.mock('@/lib/enroll-device', () => ({
  fetchDelegations: (...args: unknown[]) => mockFetchDelegations(...args),
}))

const mockFetchWhoami = vi.fn()
const mockClaim = vi.fn()

vi.mock('@/lib/skill-studio-client', () => ({
  fetchWhoami: (...args: unknown[]) => mockFetchWhoami(...args),
  claimBrowserAuthorKey: (...args: unknown[]) => mockClaim(...args),
}))

beforeEach(() => {
  mockFetchWhoami.mockReset()
  mockClaim.mockReset()
  mockGenerateBrowserAuthorKey.mockReset()
  mockGenerateBrowserAuthorKey.mockResolvedValue('newbrowser'.repeat(8))
  mockBrowserKeyId.mockReset()
  mockBrowserKeyId.mockReturnValue('localkey'.repeat(8))
  mockLoadDeviceKey.mockReset()
  mockLoadDeviceKey.mockResolvedValue(null)
  mockFetchDelegations.mockReset()
  mockFetchDelegations.mockResolvedValue([])
  mockClaim.mockResolvedValue(undefined)
})

describe('ensureBrowserSigningReady', () => {
  it('returns browser_primary when this browser key is the registry primary', async () => {
    mockFetchWhoami.mockResolvedValue({
      handle: 'taylor',
      author_key_id: 'localkey'.repeat(8),
    })

    const result = await ensureBrowserSigningReady('taylor')
    expect(result).toEqual({ kind: 'ready', mode: 'browser_primary' })
    expect(mockClaim).not.toHaveBeenCalled()
  })

  it('claims this browser key as the first primary when the account has none', async () => {
    mockFetchWhoami.mockResolvedValue({ handle: 'taylor', author_key_id: null })

    const result = await ensureBrowserSigningReady('taylor')
    expect(result).toEqual({ kind: 'ready', mode: 'browser_primary' })
    expect(mockClaim).toHaveBeenCalledWith({
      handle: 'taylor',
      publicKey: 'UFVCTElDCg==',
      keyId: 'localkey'.repeat(8),
    })
  })

  it('publishes via session against the existing primary, never rotating it', async () => {
    // CLI-first user: the account already has a primary, on another device. Web
    // publishes via session, so we must NOT promote/rotate the trust root to a
    // browser key (that would break subscribers who pinned the existing key).
    mockFetchWhoami.mockResolvedValue({
      handle: 'taylor',
      author_key_id: 'cliprimary'.repeat(8),
    })
    mockBrowserKeyId.mockReturnValue('staleweb'.repeat(8))

    const result = await ensureBrowserSigningReady('taylor')
    expect(result).toEqual({ kind: 'ready', mode: 'session_primary' })
    expect(mockClaim).not.toHaveBeenCalled()
    expect(mockGenerateBrowserAuthorKey).not.toHaveBeenCalled()
  })

  it('returns device_publish when this browser has an active publish delegation', async () => {
    mockLoadDeviceKey.mockResolvedValue({ deviceKeyId: 'device'.repeat(8) })
    mockFetchDelegations.mockResolvedValue([
      {
        device_key_id: 'device'.repeat(8),
        label: 'laptop',
        scopes: ['publish'],
        issued_at: 1,
        expires_at: 9_999_999_999,
        revoked_at: null,
        status: 'active',
      },
    ])
    mockFetchWhoami.mockResolvedValue({
      handle: 'taylor',
      author_key_id: 'cliprimary'.repeat(8),
    })

    const result = await ensureBrowserSigningReady('taylor')
    expect(result).toEqual({ kind: 'ready', mode: 'device_publish' })
  })

  it('returns needs_handle when there is no key and no handle to claim under', async () => {
    mockFetchWhoami.mockResolvedValue({ handle: null, author_key_id: null })

    const result = await ensureBrowserSigningReady(null)
    expect(result).toEqual({ kind: 'needs_handle' })
    expect(mockClaim).not.toHaveBeenCalled()
  })

  it('returns setup_error when the first-key claim fails', async () => {
    mockFetchWhoami.mockResolvedValue({ handle: 'taylor', author_key_id: null })
    mockClaim.mockRejectedValue(new Error('key_change_forbidden'))

    const result = await ensureBrowserSigningReady('taylor')
    expect(result).toEqual({ kind: 'setup_error', message: 'key_change_forbidden' })
  })

  it('returns no_session without a whoami or session handle', async () => {
    mockFetchWhoami.mockResolvedValue(null)
    const result = await ensureBrowserSigningReady(null)
    expect(result).toEqual({ kind: 'no_session' })
  })
})
