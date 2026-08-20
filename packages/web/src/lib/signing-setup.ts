/**
 * Browser signing readiness for skill studio.
 *
 * Web/desktop publish via session: the registry attests with the
 * account's existing primary key. So the only setup needed is for an account
 * that has NO key yet — claim this browser's key as the first primary. An
 * account that already has a primary publishes as-is; we never rotate the trust
 * root to a browser key, which would break subscribers who pinned it.
 */
import {
  browserKeyId,
  generateBrowserAuthorKey,
  publicKeyBase64FromStored,
} from './browser-author-key'
import { loadDeviceKey } from './device-key'
import { fetchDelegations } from './enroll-device'
import { claimBrowserAuthorKey, fetchWhoami } from './skill-studio-client'

export type SigningSetupResult =
  | { kind: 'ready'; mode: 'browser_primary' | 'session_primary' | 'device_publish' }
  | { kind: 'no_session' }
  | { kind: 'needs_handle' }
  | { kind: 'setup_error'; message: string }

export const NEEDS_HANDLE_MESSAGE =
  'Choose a public username before publishing. Open Dashboard from the menu after your handle is set, or sign in with the account that already has one.'

async function deviceCanPublish(): Promise<boolean> {
  try {
    const device = await loadDeviceKey()
    if (!device) return false
    const delegations = await fetchDelegations()
    return delegations.some(
      (d) =>
        d.device_key_id === device.deviceKeyId &&
        d.status === 'active' &&
        d.scopes.includes('publish'),
    )
  } catch {
    return false
  }
}

async function ensureBrowserPrimaryKey(
  sessionHandle: string | null | undefined,
  who: { handle: string | null; author_key_id: string | null },
): Promise<SigningSetupResult> {
  // The account already has a primary signing key (claimed on this or another
  // device). Web/desktop publish via session, which the registry attests with
  // that existing primary, so there is nothing to set up and nothing to rotate.
  if (who.author_key_id) {
    const localKey = browserKeyId()
    const mode = localKey && who.author_key_id === localKey ? 'browser_primary' : 'session_primary'
    return { kind: 'ready', mode }
  }

  // No primary yet: claim this browser's key as the account's first primary.
  const handleForClaim = who.handle ?? sessionHandle ?? null
  if (!handleForClaim) {
    return { kind: 'needs_handle' }
  }

  const localKey = browserKeyId() ?? (await generateBrowserAuthorKey())
  const pub = publicKeyBase64FromStored()
  if (!pub) {
    throw new Error('Could not read browser signing key. Refresh and try again.')
  }

  await claimBrowserAuthorKey({
    handle: handleForClaim,
    publicKey: pub,
    keyId: localKey,
  })

  return { kind: 'ready', mode: 'browser_primary' }
}

/** Prepare browser signing for studio publish. Never throws — returns a status the UI can render. */
export async function ensureBrowserSigningReady(
  sessionHandle?: string | null,
): Promise<SigningSetupResult> {
  const who = await fetchWhoami()
  if (!who && !sessionHandle) {
    return { kind: 'no_session' }
  }

  if (await deviceCanPublish()) {
    return { kind: 'ready', mode: 'device_publish' }
  }

  try {
    if (who) {
      return await ensureBrowserPrimaryKey(sessionHandle, who)
    }

    const handleForClaim = sessionHandle ?? null
    if (!handleForClaim) {
      return { kind: 'needs_handle' }
    }

    return await ensureBrowserPrimaryKey(sessionHandle, {
      handle: handleForClaim,
      author_key_id: null,
    })
  } catch (err) {
    return {
      kind: 'setup_error',
      message:
        err instanceof Error
          ? err.message
          : 'Could not set up browser signing. Try signing out and back in.',
    }
  }
}

/** Best-effort login bootstrap: claim or promote web-primary users. */
export async function bootstrapBrowserSigning(sessionHandle?: string | null): Promise<void> {
  try {
    const result = await ensureBrowserSigningReady(sessionHandle)
    if (result.kind === 'ready') return
    if (result.kind === 'needs_handle') return
  } catch {
    // Login bootstrap stays silent; studio surfaces errors on publish.
  }
}
