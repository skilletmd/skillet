/**
 * Registry origin helpers.
 *
 * - Fetch origin: server-to-server calls (SSR, BFF). Prefer REGISTRY_URL so
 *   same-box web→registry stays on loopback and never hairpins through Cloudflare.
 * - Public origin: URLs we print for humans / external clients (MCP connectors).
 *   Prefer NEXT_PUBLIC_REGISTRY_PUBLIC_URL; never use a loopback value here.
 */

function trimOrigin(raw: string | undefined): string {
  return (raw ?? '').trim().replace(/\/+$/, '')
}

/** Origin for outbound registry fetches from this Node process. Empty ⇒ mock mode. */
export function registryFetchOrigin(): string {
  return (
    trimOrigin(process.env.REGISTRY_URL) ||
    // Legacy fallback when only the public var was set (local one-box).
    trimOrigin(process.env.NEXT_PUBLIC_REGISTRY_URL)
  )
}

/** Same as {@link registryFetchOrigin} with an explicit loopback default for BFF routes. */
export function registryFetchOriginOrDefault(): string {
  return registryFetchOrigin() || 'http://127.0.0.1:3481'
}

/**
 * Browser-reachable registry origin for UI copy (MCP URL, etc.).
 * Falls back to NEXT_PUBLIC_REGISTRY_URL for older prod envs.
 */
export function registryPublicOrigin(): string {
  return (
    trimOrigin(process.env.NEXT_PUBLIC_REGISTRY_PUBLIC_URL) ||
    trimOrigin(process.env.NEXT_PUBLIC_REGISTRY_URL)
  )
}
