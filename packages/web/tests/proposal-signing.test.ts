// Signing-strategy selection: prefer the enrolled device key, fall
// back to the legacy browser author key.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const hasDeviceKey = vi.fn()
const signContentHashWithDevice = vi.fn()
const signContentHash = vi.fn()

vi.mock('@/lib/device-key', () => ({
  hasDeviceKey: () => hasDeviceKey(),
  signContentHashWithDevice: (...a: unknown[]) => signContentHashWithDevice(...a),
}))
vi.mock('@/lib/browser-author-key', () => ({
  signContentHash: (...a: unknown[]) => signContentHash(...a),
}))

import { signContentHashForProposal } from '@/lib/proposal-signing'

const HASH = 'sha256:' + '0'.repeat(64)

beforeEach(() => {
  hasDeviceKey.mockReset()
  signContentHashWithDevice.mockReset()
  signContentHash.mockReset()
})

describe('signContentHashForProposal', () => {
  it('signs with the device key when this browser is enrolled', async () => {
    hasDeviceKey.mockResolvedValue(true)
    signContentHashWithDevice.mockResolvedValue({ alg: 'ed25519', key_id: 'device', sig: 's' })
    const sig = await signContentHashForProposal(HASH)
    expect(sig.key_id).toBe('device')
    expect(signContentHashWithDevice).toHaveBeenCalledWith(HASH)
    expect(signContentHash).not.toHaveBeenCalled()
  })

  it('falls back to the browser author key when not enrolled', async () => {
    hasDeviceKey.mockResolvedValue(false)
    signContentHash.mockResolvedValue({ alg: 'ed25519', key_id: 'primary', sig: 's' })
    const sig = await signContentHashForProposal(HASH)
    expect(sig.key_id).toBe('primary')
    expect(signContentHash).toHaveBeenCalledWith(HASH)
    expect(signContentHashWithDevice).not.toHaveBeenCalled()
  })
})
