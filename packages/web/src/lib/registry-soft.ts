import { logRegistryDegrade } from './registry-errors'
import { browseSsrLog, browseSsrProbeClock } from './browse-ssr-probe'

/**
 * Soft registry call for browse / shelf surfaces: log the degrade, return
 * fallback, never let an outage take down the whole route.
 */
export async function softRegistry<T>(
  context: string,
  promise: Promise<T>,
  fallback: T,
): Promise<T> {
  const started = browseSsrProbeClock()
  try {
    const value = await promise
    browseSsrLog('soft_ok', {
      context,
      ms: started ? browseSsrProbeClock() - started : undefined,
    })
    return value
  } catch (cause) {
    browseSsrLog('soft_fail', {
      context,
      ms: started ? browseSsrProbeClock() - started : undefined,
      error: cause instanceof Error ? cause.message : String(cause),
      name: cause instanceof Error ? cause.name : undefined,
    })
    logRegistryDegrade(context, cause)
    return fallback
  }
}
