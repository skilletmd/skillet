import { registryAuthApi } from './registry-proxy'

/** Revoke a legacy signing delegation from the signed-in account (session auth). */
export async function revokeDelegationSession(deviceKeyId: string): Promise<void> {
  const res = await fetch(registryAuthApi(`delegations/${deviceKeyId}/revoke-session`), {
    method: 'POST',
    credentials: 'include',
    headers: { accept: 'application/json' },
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string }
    throw new Error(body.message ?? body.error ?? `Could not remove device (${res.status})`)
  }
}
