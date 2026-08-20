import { beforeEach, afterEach, vi } from 'vitest'

/**
 * Make a sync()-driving test suite hermetic. Registry calls made by sync()
 * (manifest pulls, metrics pings) go to REGISTRY_URL_DEFAULT
 * (https://registry.skillet.md) via the real global fetch when no fetchImpl is
 * injected — so these suites used to hit the production registry on every run,
 * timing out the 5s pre-commit hook whenever that host was slow.
 *
 * Stubbing fetch fast-fails every registry call, so no account-scoped network
 * runs — the clean, hermetic offline path the suites were designed around.
 * Call once at the top level of the test file.
 */
export function installOfflineRegistry(): void {
  beforeEach(() => {
    vi.stubGlobal('fetch', (async () => {
      return new Response(JSON.stringify({ error: 'offline-test' }), { status: 503 })
    }) as unknown as typeof fetch)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })
}
