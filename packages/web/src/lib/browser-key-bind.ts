/**
 * Proof-of-possession for POST /api/v1/auth/keys.
 * Domain-separated message from @skillet/protocol key-bind constants.
 */
import { keyBindPopMessage } from '@skillet/protocol'
import { loadStoredBrowserKey } from './browser-author-key'
import { registryAuthApi } from './registry-proxy'

function bytesToBase64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

async function importPrivateKey(
  stored: NonNullable<ReturnType<typeof loadStoredBrowserKey>>,
): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', stored.privateJwk, { name: 'Ed25519' }, false, ['sign'])
}

export function popBindMessage(nonce: string, keyId: string): string {
  return keyBindPopMessage(nonce, keyId)
}

export async function signPopBindNonce(nonce: string, keyId: string): Promise<string> {
  const stored = loadStoredBrowserKey()
  if (!stored) {
    throw new Error('No browser signing key. Refresh the page and try again.')
  }
  const privateKey = await importPrivateKey(stored)
  const data = new TextEncoder().encode(popBindMessage(nonce, keyId))
  const sigBuf = await crypto.subtle.sign({ name: 'Ed25519' }, privateKey, data)
  return bytesToBase64(new Uint8Array(sigBuf))
}

export interface KeyBindNonce {
  nonce: string
  needs_cosign: boolean
}

export async function fetchKeyBindNonce(): Promise<KeyBindNonce> {
  const res = await fetch(registryAuthApi('auth/keys/nonce'), {
    credentials: 'include',
    headers: { accept: 'application/json' },
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string; error?: string }
    throw new Error(err.message ?? err.error ?? `Could not start key setup (${res.status})`)
  }
  const body = (await res.json()) as { nonce?: string; needs_cosign?: boolean }
  if (!body.nonce) {
    throw new Error('Registry did not return a setup nonce. Try again in a moment.')
  }
  return { nonce: body.nonce, needs_cosign: body.needs_cosign === true }
}

export async function bindBrowserAuthorKeyWithPop(input: {
  publicKey: string
  keyId: string
  label?: string
}): Promise<void> {
  const { nonce, needs_cosign } = await fetchKeyBindNonce()
  if (needs_cosign) {
    throw new Error(
      'This account already has a signing key on another device. Publish and propose from the CLI on that device.',
    )
  }
  const pop_sig_new = await signPopBindNonce(nonce, input.keyId)
  const res = await fetch(registryAuthApi('auth/keys'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      public_key: input.publicKey,
      key_id: input.keyId,
      label: input.label ?? 'browser-studio',
      pop_nonce: nonce,
      pop_sig_new,
    }),
  })
  if (res.status === 409) return
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string; error?: string }
    throw new Error(err.message ?? err.error ?? `Could not register browser key (${res.status})`)
  }
}
