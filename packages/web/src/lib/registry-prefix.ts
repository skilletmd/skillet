/**
 * The registry's canonical API version prefix.
 *
 * PROTOCOL.md §0 mandates `/api/v1/`. The skill/catalog/proposal callers build
 * off this constant — server-side as `${REGISTRY_BASE_URL}${REGISTRY_API}/…`,
 * browser via the BFF as `/api/registry${REGISTRY_API}/…` — so a future version
 * bump is a one-line edit.
 *
 * A guard test (registry-prefix-guard) fails the build if a raw `/api/v1`
 * literal reappears anywhere in `web/src`, so every caller stays on this
 * constant rather than drifting when the version bumps.
 */
export const REGISTRY_API = '/api/v1'
