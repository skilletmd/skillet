import { connection } from 'next/server'

/** Opt a route into per-request rendering under cacheComponents (replaces force-dynamic). */
export async function markDynamicRoute(): Promise<void> {
  await connection()
}
