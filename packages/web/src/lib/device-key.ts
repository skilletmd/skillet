// Browser device signing key for web propose/approve via author-signed
// delegation (§4.1–§4.2).
//
// This is the durable replacement for the bridge key
// (browser-author-key.ts), which stored an EXTRACTABLE author key as JWK in
// localStorage. Here the private key is a NON-EXTRACTABLE Ed25519 `CryptoKey`
// held in IndexedDB (idb-store.ts): it can sign, but its bytes can never leave
// the browser (invariant #8). Authority is NOT this key being registered as an
// author key — it is an author-signed delegation cert minted by the CLI
// (`skillet device approve`) that names this device's public key. The browser
// never holds the primary author key.
//
// The device public key is exported raw (32 bytes); `device_key_id = hex(pub)`
// (the same id rule as the primary key in @skillet/core signing/index.ts), and
// `device_pub = base64(pub)` is what the user pairs to the CLI at enrollment.

const PRIVATE_KEY_SLOT = 'device_private_key'
const PUBLIC_RAW_SLOT = 'device_public_raw'

/** `/^sha256:[0-9a-f]{64}$/` — the only shape signatureBytes accepts (PROTOCOL §4). */
const CONTENT_HASH_RE = /^sha256:[0-9a-f]{64}$/

import { idbGet, idbPut, idbDelete } from './idb-store'

/** Public identity of the enrolled device key. */
export interface DeviceKeyInfo {
  /** 64 lowercase hex == hex(device_pub). The `signature.key_id` sent to the registry. */
  deviceKeyId: string
  /** base64 of the raw 32-byte Ed25519 public key. Paired to the CLI at enrollment. */
  devicePub: string
}

/** §4.2 signing payload — reused verbatim for propose and approve. */
export interface DeviceSignature {
  alg: 'ed25519'
  /** The DEVICE key id — never the primary author key id. */
  key_id: string
  /** base64 of the raw 64-byte Ed25519 signature over utf8(content_hash). */
  sig: string
}

function bytesToHex(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += b.toString(16).padStart(2, '0')
  return s
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function infoFromRawPub(rawPub: Uint8Array): DeviceKeyInfo {
  return { deviceKeyId: bytesToHex(rawPub), devicePub: bytesToBase64(rawPub) }
}

/**
 * Generate this browser's device key and persist it. The private key is
 * generated `extractable: false`, so neither this code nor any XSS payload can
 * export its bytes; only the PUBLIC key is exported (raw, always extractable for
 * an asymmetric pair) to derive `device_pub` / `device_key_id`. Overwrites any
 * existing device key (re-enrollment starts a fresh key).
 */
export async function generateDeviceKey(): Promise<DeviceKeyInfo> {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])
  const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  if (rawPub.length !== 32) {
    throw new Error(`Expected a 32-byte Ed25519 public key, got ${rawPub.length}`)
  }
  // Stored as a non-extractable CryptoKey object; IndexedDB structured-clone
  // preserves both the key and its non-extractability.
  await idbPut(PRIVATE_KEY_SLOT, pair.privateKey)
  await idbPut(PUBLIC_RAW_SLOT, rawPub)
  return infoFromRawPub(rawPub)
}

/** The enrolled device key's public identity, or `null` if none exists yet. */
export async function loadDeviceKey(): Promise<DeviceKeyInfo | null> {
  const rawPub = await idbGet<Uint8Array>(PUBLIC_RAW_SLOT)
  if (!rawPub || rawPub.length !== 32) return null
  return infoFromRawPub(new Uint8Array(rawPub))
}

/** True when a device key has been generated in this browser. */
export async function hasDeviceKey(): Promise<boolean> {
  return (await loadDeviceKey()) !== null
}

/**
 * Sign a canonical content hash with the device key, producing the §4.2 payload.
 * The signed bytes are `utf8(content_hash)` — the UTF-8 bytes of the hash STRING
 * (PROTOCOL §4), identical to the CLI/registry signing path. Throws if no device
 * key is enrolled or `contentHash` is not a well-formed `sha256:<64hex>`.
 */
export async function signContentHashWithDevice(contentHash: string): Promise<DeviceSignature> {
  if (!CONTENT_HASH_RE.test(contentHash)) {
    throw new Error(
      `contentHash must match /^sha256:[0-9a-f]{64}$/, got ${JSON.stringify(contentHash)}`,
    )
  }
  const privateKey = await idbGet<CryptoKey>(PRIVATE_KEY_SLOT)
  const rawPub = await idbGet<Uint8Array>(PUBLIC_RAW_SLOT)
  if (!privateKey || !rawPub) {
    throw new Error('This browser is not enrolled. Run `skillet device approve` to pair it.')
  }
  const signingBytes = new TextEncoder().encode(contentHash)
  const sig = await crypto.subtle.sign({ name: 'Ed25519' }, privateKey, signingBytes)
  return {
    alg: 'ed25519',
    key_id: bytesToHex(new Uint8Array(rawPub)),
    sig: bytesToBase64(new Uint8Array(sig)),
  }
}

/** Forget the device key (e.g. before re-enrolling after revocation/expiry). */
export async function clearDeviceKey(): Promise<void> {
  await idbDelete(PRIVATE_KEY_SLOT)
  await idbDelete(PUBLIC_RAW_SLOT)
}
