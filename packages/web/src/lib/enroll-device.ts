// Delegation listing for Connected devices settings.
// Browser↔CLI pairing UI was removed; approve devices with the CLI only.

import { fetchRegistryWithRetry } from './registry-proxy'

export type DelegationStatus = 'active' | 'expired' | 'revoked'

/** One row of GET /api/v1/delegations (the caller's own delegations). */
export interface Delegation {
  device_key_id: string
  label: string | null
  scopes: string[]
  issued_at: number
  expires_at: number
  revoked_at: number | null
  status: DelegationStatus
}

/** Fetch the signed-in user's delegations. Throws on a non-OK response. */
export async function fetchDelegations(signal?: AbortSignal): Promise<Delegation[]> {
  const res = await fetchRegistryWithRetry('delegations', { signal })
  if (!res.ok) throw new Error(`Could not load delegations (${res.status})`)
  const body = (await res.json()) as { delegations?: Delegation[] }
  return body.delegations ?? []
}
