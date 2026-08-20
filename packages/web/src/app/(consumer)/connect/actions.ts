'use server'

import { cookies } from 'next/headers'
import { signIn } from '@/auth'
import { safeCallbackPath } from '@/lib/auth-errors'
import { skilletSessionCookieOptions, SKILLET_SESSION_COOKIE } from '@/lib/session-cookie'
import { REGISTRY_API } from '@/lib/registry-prefix'

function registryUrl(): string {
  return process.env.REGISTRY_URL ?? process.env.NEXT_PUBLIC_REGISTRY_URL ?? 'http://127.0.0.1:3481'
}

/** Strip spaces/dashes and uppercase — matches the registry's normalization. */
function normalizeCode(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[\s_-]+/g, '')
}

export interface ConnectCodeState {
  error?: string
}

/**
 * Redeem a join code minted on another device, browser, or app. Binds THIS
 * browser to the same account: claim → set the registry session cookie → mint an
 * Auth.js session (mirrors the magic-link callback). The session token never
 * reaches client JS.
 */
export async function redeemConnectCode(
  _prev: ConnectCodeState,
  formData: FormData,
): Promise<ConnectCodeState> {
  const code = normalizeCode(String(formData.get('code') ?? ''))
  const callback = safeCallbackPath(String(formData.get('callbackUrl') ?? '') || undefined)

  if (code.length !== 8) {
    return { error: 'Enter the 8-character code from your other device.' }
  }

  let sessionToken: string
  try {
    const res = await fetch(`${registryUrl()}${REGISTRY_API}/connect/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      // Browser only needs the session cookie; skip the throwaway device token.
      body: JSON.stringify({ code, bind_device: false }),
    })
    const body = (await res.json().catch(() => null)) as {
      session_token?: string
      message?: string
      error?: string
    } | null
    if (!res.ok || !body?.session_token) {
      return {
        error:
          body?.message ??
          (res.status === 429
            ? 'Too many attempts. Wait a minute and try again.'
            : 'That code is invalid or expired. Generate a new one and try again.'),
      }
    }
    sessionToken = body.session_token
  } catch {
    return { error: 'Network error. Please try again.' }
  }

  const jar = await cookies()
  jar.set(SKILLET_SESSION_COOKIE, sessionToken, skilletSessionCookieOptions)

  // Throws NEXT_REDIRECT on success — propagate it out of the action.
  await signIn('registry', { sessionToken, redirectTo: callback })
  return {}
}
