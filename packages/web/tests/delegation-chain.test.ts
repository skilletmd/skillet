// End-to-end delegation-chain contract (AC: "a web-proposed/approved
// change verifies via the delegation chain"). Reproduces exactly the links the
// registry's resolveAndVerifySigner checks, using the REAL browser device key
// (device-key.ts) and the SHARED @skillet/protocol cert canonicalization:
//
//   proposal sig  ←  device subkey  ←  signed delegation cert  ←  primary key
//
// A live registry isn't available in a unit test, so the CLI primary key is
// stood up here with WebCrypto and the cert is signed the same way the CLI does.

import { describe, it, expect, vi } from 'vitest'

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

import { generateDeviceKey, signContentHashWithDevice } from '@/lib/device-key'
import { validateDelegationCert, delegationCertHash } from '@skillet/protocol'

function hex(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += b.toString(16).padStart(2, '0')
  return s
}
function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64)
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
  return out
}
function utf8(s: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(s.length * 4))
  const { written } = new TextEncoder().encodeInto(s, out)
  return out.subarray(0, written) as Uint8Array<ArrayBuffer>
}

describe('delegation chain (browser device sig → cert → primary)', () => {
  it('a device-signed content hash verifies through a cert chaining to the primary key', async () => {
    // CLI-resident primary author key (the TOFU trust root).
    const primary = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
    const primaryRaw = new Uint8Array(await crypto.subtle.exportKey('raw', primary.publicKey))
    const author_key_id = hex(primaryRaw)

    // Browser device key (non-extractable, this is the code under test).
    const device = await generateDeviceKey()

    // The author-signed delegation cert the CLI mints at `skillet device approve`.
    const issued_at = 1_700_000_000
    const cert = {
      v: 1 as const,
      typ: 'skillet-delegation' as const,
      author_key_id,
      handle: 'taylor',
      device_key_id: device.deviceKeyId,
      device_pub: device.devicePub,
      scopes: ['propose', 'approve'],
      issued_at,
      expires_at: issued_at + 90 * 24 * 60 * 60,
      nonce: '0123456789abcdef0123456789abcdef',
    }

    // Cert is structurally valid and its id binds to the signed device pub (T7).
    const v = validateDelegationCert(cert)
    expect('ok' in v && v.ok === true).toBe(true)

    // cert_sig: primary key signs utf8(certHash) — the path the registry re-verifies.
    const certHash = delegationCertHash(cert)
    const certSig = await crypto.subtle.sign(
      { name: 'Ed25519' },
      primary.privateKey,
      utf8(certHash),
    )
    const certChains = await crypto.subtle.verify(
      { name: 'Ed25519' },
      primary.publicKey,
      certSig,
      utf8(certHash),
    )
    expect(certChains).toBe(true) // delegation authority chains to the primary key

    // The browser signs a proposal content hash with the device key.
    const contentHash = 'sha256:' + 'a'.repeat(64)
    const sig = await signContentHashWithDevice(contentHash)
    expect(sig.key_id).toBe(cert.device_key_id) // proposal references the device id

    // Final link: the proposal sig verifies against the device pub taken ONLY
    // from inside the signed cert (never an unsigned column) — invariant #2.
    const devicePub = await crypto.subtle.importKey(
      'raw',
      base64ToBytes(cert.device_pub),
      { name: 'Ed25519' },
      false,
      ['verify'],
    )
    const proposalVerifies = await crypto.subtle.verify(
      { name: 'Ed25519' },
      devicePub,
      base64ToBytes(sig.sig),
      utf8(contentHash),
    )
    expect(proposalVerifies).toBe(true)
  })
})
