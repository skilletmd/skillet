'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { readSessionCookie } from '@/lib/session-cookie'
import { unlinkRegistryIdentity } from '@/lib/registry-session'

export interface DisconnectResult {
  ok: boolean
  error?: string
}

/**
 * Unlink a connected provider (GitHub) from the account. The registry enforces
 * the real guard — it refuses to remove your last sign-in method — so we surface
 * that as a clear message rather than re-checking here.
 */
export async function disconnectProviderAction(
  provider: 'github' | 'twitter',
): Promise<DisconnectResult> {
  const sessionToken = readSessionCookie(await cookies())
  if (!sessionToken) return { ok: false, error: 'Sign in first.' }

  const res = await unlinkRegistryIdentity(sessionToken, provider)
  if (!res.ok) {
    return {
      ok: false,
      error:
        res.error === 'last_identity'
          ? 'That’s your only sign-in method. Add another before disconnecting it.'
          : 'Could not disconnect. Try again.',
    }
  }
  revalidatePath('/settings')
  revalidatePath('/settings/github')
  return { ok: true }
}
