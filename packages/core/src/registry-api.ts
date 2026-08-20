/**
 * The registry's canonical API version prefix (PROTOCOL.md §0 mandates
 * `/api/v1/`). Every core/CLI caller builds registry URLs off this constant —
 * `${registryUrl}${REGISTRY_API}/…` — so a future version bump is a one-line
 * edit rather than a sweep across every command. A guard test (registry-api
 * prefix guard) fails the build if a raw `/api/v1` literal reappears.
 */
export const REGISTRY_API = '/api/v1'
