/**
 * Browser-local Ed25519 author key for web publish/propose.
 *
 * Stored in localStorage only — never sent to the server except as signatures.
 * Must match the key registered via /api/v1/claim (same as CLI).
 */
const STORAGE_KEY = 'skillet_browser_author_key_v1'

export interface BrowserSignature {
  alg: 'ed25519'
  key_id: string
  sig: string
}

interface StoredKey {
  keyId: string
  publicJwk: JsonWebKey
  privateJwk: JsonWebKey
}

function base64UrlToBytes(b64: string): Uint8Array {
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
  const b64Std = b64.replace(/-/g, '+').replace(/_/g, '/') + pad
  const raw = atob(b64Std)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i)
  return out
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function publicKeyIdFromJwk(jwk: JsonWebKey): string {
  if (!jwk.x) throw new Error('Invalid Ed25519 public JWK')
  const raw = base64UrlToBytes(jwk.x)
  return Array.from(raw)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function importKeyPair(stored: StoredKey): Promise<CryptoKeyPair> {
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    stored.publicJwk,
    { name: 'Ed25519' },
    true,
    ['verify'],
  )
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    stored.privateJwk,
    { name: 'Ed25519' },
    false,
    ['sign'],
  )
  return { publicKey, privateKey }
}

export function loadStoredBrowserKey(): StoredKey | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as StoredKey
  } catch {
    return null
  }
}

export async function generateBrowserAuthorKey(): Promise<string> {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
  const keyId = publicKeyIdFromJwk(publicJwk)
  const stored: StoredKey = { keyId, publicJwk, privateJwk }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
  return keyId
}

export function browserKeyId(): string | null {
  return loadStoredBrowserKey()?.keyId ?? null
}

export async function signContentHash(contentHash: string): Promise<BrowserSignature> {
  const stored = loadStoredBrowserKey()
  if (!stored) {
    throw new Error('No browser signing key. Generate one from the dashboard first.')
  }
  const { privateKey } = await importKeyPair(stored)
  const data = new TextEncoder().encode(contentHash)
  const sigBuf = await crypto.subtle.sign({ name: 'Ed25519' }, privateKey, data)
  return {
    alg: 'ed25519',
    key_id: stored.keyId,
    sig: bytesToBase64(new Uint8Array(sigBuf)),
  }
}

export function publicKeyBase64FromStored(): string | null {
  const stored = loadStoredBrowserKey()
  if (!stored?.publicJwk.x) return null
  return bytesToBase64(base64UrlToBytes(stored.publicJwk.x))
}
