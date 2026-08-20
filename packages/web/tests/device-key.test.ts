// Device key unit tests (§4.1–§4.2): non-extractable Ed25519
// key, raw 32-byte public export, device_key_id == hex(pub), and a §4.2 signing
// payload whose signature verifies against the public key. The IndexedDB store
// is mocked with an in-memory map so the crypto logic is exercised without a
// real IndexedDB (jsdom has none); the store wrapper itself is trivially correct.

import { describe, it, expect, beforeEach, vi } from 'vitest'

const store = new Map<string, unknown>()
vi.mock('@/lib/idb-store', () => ({
  idbGet: async (key: string) => store.get(key),
  idbPut: async (key: string, value: unknown) => {
    store.set(key, value)
  },
  idbDelete: async (key: string) => {
    store.delete(key)
  },
}))

import {
  generateDeviceKey,
  loadDeviceKey,
  hasDeviceKey,
  signContentHashWithDevice,
  clearDeviceKey,
} from '@/lib/device-key'

const HASH = 'sha256:' + '0'.repeat(64)

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64)
  const bytes = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function utf8(s: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(s.length * 4))
  const { written } = new TextEncoder().encodeInto(s, out)
  return out.subarray(0, written) as Uint8Array<ArrayBuffer>
}

beforeEach(() => {
  store.clear()
})

describe('device key generation', () => {
  it('produces a 64-hex key id == hex of the raw 32-byte public key', async () => {
    const info = await generateDeviceKey()
    expect(info.deviceKeyId).toMatch(/^[0-9a-f]{64}$/)
    const pubBytes = base64ToBytes(info.devicePub)
    expect(pubBytes.length).toBe(32)
    const hex = Array.from(pubBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    expect(info.deviceKeyId).toBe(hex)
  })

  it('stores a NON-EXTRACTABLE private key (its bytes cannot be exported)', async () => {
    await generateDeviceKey()
    const privateKey = store.get('device_private_key') as CryptoKey
    expect(privateKey).toBeTruthy()
    expect(privateKey.extractable).toBe(false)
    await expect(crypto.subtle.exportKey('raw', privateKey)).rejects.toBeTruthy()
    await expect(crypto.subtle.exportKey('pkcs8', privateKey)).rejects.toBeTruthy()
  })

  it('loadDeviceKey / hasDeviceKey reflect persisted state', async () => {
    expect(await loadDeviceKey()).toBeNull()
    expect(await hasDeviceKey()).toBe(false)
    const info = await generateDeviceKey()
    expect(await hasDeviceKey()).toBe(true)
    expect((await loadDeviceKey())?.deviceKeyId).toBe(info.deviceKeyId)
  })
})

describe('device signing payload (§4.2)', () => {
  it('signs utf8(content_hash) and the signature verifies against the public key', async () => {
    const info = await generateDeviceKey()
    const payload = await signContentHashWithDevice(HASH)

    expect(payload.alg).toBe('ed25519')
    expect(payload.key_id).toBe(info.deviceKeyId) // device key id, not primary
    const sigBytes = base64ToBytes(payload.sig)
    expect(sigBytes.length).toBe(64)

    // Independently re-import the raw public key and verify the signature.
    const pub = await crypto.subtle.importKey(
      'raw',
      base64ToBytes(info.devicePub),
      { name: 'Ed25519' },
      false,
      ['verify'],
    )
    const ok = await crypto.subtle.verify({ name: 'Ed25519' }, pub, sigBytes, utf8(HASH))
    expect(ok).toBe(true)

    // Tamper: a different hash must NOT verify against this signature.
    const bad = await crypto.subtle.verify(
      { name: 'Ed25519' },
      pub,
      sigBytes,
      utf8('sha256:' + '1'.repeat(64)),
    )
    expect(bad).toBe(false)
  })

  it('rejects a malformed content hash', async () => {
    await generateDeviceKey()
    await expect(signContentHashWithDevice('not-a-hash')).rejects.toThrow(/sha256/)
    await expect(signContentHashWithDevice('sha256:ABC')).rejects.toThrow(/sha256/)
    await expect(signContentHashWithDevice('sha256:' + 'A'.repeat(64))).rejects.toThrow(/sha256/) // uppercase
  })

  it('throws when no device key is enrolled', async () => {
    await expect(signContentHashWithDevice(HASH)).rejects.toThrow(/not enrolled/)
  })
})

describe('clearDeviceKey', () => {
  it('forgets the device key', async () => {
    await generateDeviceKey()
    expect(await hasDeviceKey()).toBe(true)
    await clearDeviceKey()
    expect(await hasDeviceKey()).toBe(false)
    await expect(signContentHashWithDevice(HASH)).rejects.toThrow(/not enrolled/)
  })
})
