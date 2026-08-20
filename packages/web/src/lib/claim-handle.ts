// Web-first handle claim.
//
// Picking a username from the web is the same operation the studio runs
// implicitly via ensureBrowserSigningReady: generate this browser's Ed25519
// author key (if it has none yet), then POST /api/v1/claim to bind the handle
// AND seed it as the account's trust-root author key in one shot. The claim is
// one-time and TOFU-locked server-side — once a handle + key are bound, the
// registry rejects handle changes (already_claimed) and key changes
// (key_change_forbidden). See packages/registry/src/routes/auth.ts.

import { isReservedHandle } from '@skillet/protocol'
import {
  browserKeyId,
  generateBrowserAuthorKey,
  publicKeyBase64FromStored,
} from './browser-author-key'
import { claimBrowserAuthorKey } from './skill-studio-client'

/**
 * Mirror of the registry HANDLE_RE (packages/registry/src/routes/auth.ts):
 * lowercase, starts with [a-z0-9], then up to 38 of [a-z0-9-]. Kept in sync so
 * client validation never rejects something the server would accept (or accepts
 * something it would reject).
 */
export const HANDLE_RE = /^[a-z0-9][a-z0-9-]{0,38}$/

/** Inline validation matching the server rule. Returns an error string, or null when valid. */
export function validateHandle(
  raw: string,
  opts?: { brandEligible?: readonly string[] },
): string | null {
  const handle = raw.trim()
  if (!handle) return 'Choose a username.'
  if (handle.length > 39) return 'Usernames can be at most 39 characters.'
  if (/[A-Z]/.test(handle)) return 'Use lowercase letters only.'
  if (!/^[a-z0-9]/.test(handle)) return 'Usernames must start with a letter or number.'
  if (!HANDLE_RE.test(handle)) return 'Use lowercase letters, numbers, and hyphens only.'
  const brandEligible = opts?.brandEligible ?? []
  if (isReservedHandle(handle) && !brandEligible.includes(handle)) {
    return 'That username is reserved. Try another.'
  }
  return null
}

/**
 * Claim `handle` for the signed-in account, generating this browser's author key
 * if needed. Throws an Error with a user-facing message on failure (mapped by
 * claimBrowserAuthorKey). Resolves once the registry has bound the handle.
 */
export async function claimHandle(
  handle: string,
  opts?: { brandEligible?: readonly string[] },
): Promise<void> {
  const invalid = validateHandle(handle, opts)
  if (invalid) throw new Error(invalid)

  let keyId = browserKeyId()
  if (!keyId) keyId = await generateBrowserAuthorKey()

  const publicKey = publicKeyBase64FromStored()
  if (!publicKey) {
    throw new Error('Could not read this browser’s signing key. Refresh and try again.')
  }

  await claimBrowserAuthorKey({ handle: handle.trim(), publicKey, keyId })
}
