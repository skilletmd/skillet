// Web-first handle claim orchestration. The browser key + claim
// primitives are mocked so the test covers validation and the generate→claim
// wiring without WebCrypto.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { claimHandle, validateHandle } from '@/lib/claim-handle'

const browserKeyId = vi.fn()
const generateBrowserAuthorKey = vi.fn()
const publicKeyBase64FromStored = vi.fn()
const claimBrowserAuthorKey = vi.fn()

vi.mock('@/lib/browser-author-key', () => ({
  browserKeyId: () => browserKeyId(),
  generateBrowserAuthorKey: () => generateBrowserAuthorKey(),
  publicKeyBase64FromStored: () => publicKeyBase64FromStored(),
}))
vi.mock('@/lib/skill-studio-client', () => ({
  claimBrowserAuthorKey: (...a: unknown[]) => claimBrowserAuthorKey(...a),
}))

beforeEach(() => {
  browserKeyId.mockReset()
  generateBrowserAuthorKey.mockReset()
  publicKeyBase64FromStored.mockReset()
  claimBrowserAuthorKey.mockReset()
  claimBrowserAuthorKey.mockResolvedValue(undefined)
  publicKeyBase64FromStored.mockReturnValue('cHVibGlja2V5')
})

describe('validateHandle', () => {
  it('accepts valid handles', () => {
    expect(validateHandle('alice')).toBeNull()
    expect(validateHandle('a1-b2')).toBeNull()
    expect(validateHandle('x')).toBeNull()
  })

  it('rejects empty, uppercase, bad start, and bad chars', () => {
    expect(validateHandle('   ')).toMatch(/choose a username/i)
    expect(validateHandle('Alice')).toMatch(/lowercase/i)
    expect(validateHandle('-nope')).toMatch(/start/i)
    expect(validateHandle('a_b')).toMatch(/letters, numbers/i)
    expect(validateHandle('a'.repeat(40))).toMatch(/at most/i)
  })

  it('rejects reserved names', () => {
    expect(validateHandle('admin')).toMatch(/reserved/i)
    expect(validateHandle('skillet')).toMatch(/reserved/i)
    expect(validateHandle('support')).toMatch(/reserved/i)
    expect(validateHandle('taylor')).toBeNull()
  })

  it('allows allowlisted brand handles when brandEligible is set', () => {
    expect(validateHandle('skillet', { brandEligible: ['skillet'] })).toBeNull()
    expect(validateHandle('admin', { brandEligible: ['skillet'] })).toMatch(/reserved/i)
  })

  // Repeated-hyphen and multi-segment authority compounds mirror the server.
  it('rejects repeated-hyphen and multi-segment brand authority compounds', () => {
    expect(validateHandle('skillet--support')).toMatch(/reserved/i)
    expect(validateHandle('skillet---admin')).toMatch(/reserved/i)
    expect(validateHandle('skillet-support-team')).toMatch(/reserved/i)
    expect(validateHandle('skillet-help-desk')).toMatch(/reserved/i)
    expect(validateHandle('springfield-county')).toBeNull()
  })

  // The inline UX mirrors the server's brand-compound rule so a
  // user is told the name is reserved before they ever hit the claim gate.
  it('rejects brand-prefixed authority compounds but allows community ones', () => {
    expect(validateHandle('skillet-support')).toMatch(/reserved/i)
    expect(validateHandle('skillet-team')).toMatch(/reserved/i)
    expect(validateHandle('skillet-fan')).toBeNull()
    expect(validateHandle('springfield')).toBeNull()
  })
})

describe('claimHandle', () => {
  it('generates a key when none exists, then claims', async () => {
    browserKeyId.mockReturnValue(null)
    generateBrowserAuthorKey.mockResolvedValue('newkeyid')

    await claimHandle('alice')

    expect(generateBrowserAuthorKey).toHaveBeenCalledOnce()
    expect(claimBrowserAuthorKey).toHaveBeenCalledWith({
      handle: 'alice',
      publicKey: 'cHVibGlja2V5',
      keyId: 'newkeyid',
    })
  })

  it('reuses an existing browser key', async () => {
    browserKeyId.mockReturnValue('existingkey')

    await claimHandle('bob')

    expect(generateBrowserAuthorKey).not.toHaveBeenCalled()
    expect(claimBrowserAuthorKey).toHaveBeenCalledWith({
      handle: 'bob',
      publicKey: 'cHVibGlja2V5',
      keyId: 'existingkey',
    })
  })

  it('throws on invalid handle without touching the registry', async () => {
    await expect(claimHandle('Bad_Handle')).rejects.toThrow(/lowercase/i)
    expect(claimBrowserAuthorKey).not.toHaveBeenCalled()
  })

  it('surfaces a claim failure', async () => {
    browserKeyId.mockReturnValue('k')
    claimBrowserAuthorKey.mockRejectedValue(
      new Error('That username is already taken. Try another.'),
    )

    await expect(claimHandle('taken')).rejects.toThrow(/already taken/i)
  })
})
