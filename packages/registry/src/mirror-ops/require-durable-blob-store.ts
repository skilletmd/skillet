import type { BlobStoreMode } from '../blob-store/types.js'
import { resolveBlobStoreMode } from '../blob-store/create-blob-store.js'

/**
 * Prod mirror entrypoints must not resolve to ephemeral MemoryBlobStore.
 * Override with SKILLET_ALLOW_MEMORY_BLOB_STORE=1 for emergency local dry-runs
 * against a production-shaped NODE_ENV (tests never set that combo).
 */
export function assertDurableBlobStoreForProd(
  env: NodeJS.ProcessEnv = process.env,
  mode: BlobStoreMode = resolveBlobStoreMode(env.BLOB_STORE),
): void {
  if (env.NODE_ENV !== 'production') return
  if (env.SKILLET_ALLOW_MEMORY_BLOB_STORE === '1') return
  if (mode === 'memory') {
    throw new Error(
      'BLOB_STORE resolved to memory under NODE_ENV=production. ' +
        'Set BLOB_STORE=r2 (and R2_* credentials) so mirror sync persists skill bytes. ' +
        'Set SKILLET_ALLOW_MEMORY_BLOB_STORE=1 only for an intentional override.',
    )
  }
}
