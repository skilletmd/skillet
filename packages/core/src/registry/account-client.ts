import { RegistryClient } from './client.js'
import { loadRegistryBearer } from '../auth-token.js'
import { REGISTRY_URL_DEFAULT } from '../kit/types.js'

/**
 * A best-effort authed registry client for account-scoped decision write-through
 *. Returns null when no bearer is configured, so CLI commands stay fully
 * functional offline — the local lock is recorded regardless and reconciles on
 * the next `skillet sync`.
 */
export async function accountClient(registryUrl?: string): Promise<RegistryClient | null> {
  const { token } = await loadRegistryBearer()
  if (!token) return null
  // Honor the registry override like every other authed path — a local/dev
  // token sent to prod fails silently and the account read looks empty.
  const base = registryUrl ?? process.env['SKILLET_REGISTRY_URL'] ?? REGISTRY_URL_DEFAULT
  return new RegistryClient({
    baseUrl: base.replace(/\/+$/, ''),
    token,
  })
}

/** Registry skill id ("owner:slug") from a local state key ("@owner/slug"). */
export function skillIdFromSlug(slug: string, owner: string | null | undefined): string | null {
  if (!owner) return null
  const bare = slug.split('/').pop()
  return bare ? `${owner}:${bare}` : null
}
