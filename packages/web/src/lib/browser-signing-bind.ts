import { bootstrapBrowserSigning, ensureBrowserSigningReady } from '@/lib/signing-setup'

let bindInFlight: Promise<void> | null = null

/** Bind this browser's signing key once; dedupes concurrent callers (login + studio). */
export function bindBrowserSigningOnce(sessionHandle?: string | null): Promise<void> {
  if (!bindInFlight) {
    bindInFlight = bootstrapBrowserSigning(sessionHandle).finally(() => {
      bindInFlight = null
    })
  }
  return bindInFlight
}

export { ensureBrowserSigningReady }
