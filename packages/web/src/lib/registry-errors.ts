/** Thrown when the live registry is DOWN — unreachable or returning a non-OK,
 *  non-404 status. Distinct from a genuine 404 (resource ABSENT), which the data
 *  layer reports as null/undefined/[] so a page renders not-found, not an outage. */
export class RegistryUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'RegistryUnavailableError'
  }
}

/**
 * Log a degraded registry path server-side before throwing or returning a
 * fallback. The web data/session layer routes EVERY caught failure through here
 * instead of swallowing it into a bare `catch {}`, so an outage leaves a trace.
 */
export function logRegistryDegrade(context: string, cause?: unknown): void {
  if (cause === undefined) console.error(`[registry] ${context}`)
  else console.error(`[registry] ${context}`, cause)
}
