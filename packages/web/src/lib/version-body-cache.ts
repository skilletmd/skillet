import type { SkillBundleFileEntry } from './skill-bundle-content'

/**
 * Bounded, in-process LRU of decoded skill-version file maps, keyed by the
 * version's CONTENT HASH (U2 / KTD2). A version body is immutable by content
 * hash, so an entry keyed by hash never goes stale — correctness rests entirely
 * on the caller gating every read behind the registry's version-endpoint
 * conditional request (KTD1): the cache is only ever read after a `304`
 * (authorized-and-unchanged), and a `404`/`409` (revoked/blocked) evicts.
 *
 * This is deliberately NOT Next's Data Cache: that cache is shared and TTL'd, so
 * a private/revoked skill's bytes could outlive access. A content-addressed
 * in-process store gated live per request cannot.
 *
 * Deployment assumption (KTD2): the hit rate depends on a long-lived process
 * (Skillet web runs under pm2). On serverless/edge the module state resets per
 * request and the hit rate collapses toward zero — no benefit, no harm.
 * Multi-instance is fine: each instance keeps its own cache, worst case equals
 * today's every-request fetch.
 *
 * Eviction is by entry count AND total decoded bytes, LRU order, no TTL.
 */
export interface VersionBodyCache {
  get(hash: string): SkillBundleFileEntry[] | undefined
  set(hash: string, files: SkillBundleFileEntry[]): void
  delete(hash: string): void
  /** Test/introspection: current entry count. */
  size(): number
  /** Test helper: drop everything. */
  clear(): void
}

export interface VersionBodyCacheOptions {
  /** Max distinct version bodies retained. */
  maxEntries?: number
  /** Max total decoded bytes retained across all entries. */
  maxBytes?: number
}

const DEFAULT_MAX_ENTRIES = 32
const DEFAULT_MAX_BYTES = 48 * 1024 * 1024 // 48 MB

interface CacheRecord {
  files: SkillBundleFileEntry[]
  bytes: number
}

function entryBytes(files: SkillBundleFileEntry[]): number {
  let total = 0
  for (const f of files) total += f.size
  return total
}

export function createVersionBodyCache(options: VersionBodyCacheOptions = {}): VersionBodyCache {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  // A JS Map preserves insertion order; we treat the FRONT (oldest) as LRU and
  // re-insert on access to mark an entry most-recently-used.
  const store = new Map<string, CacheRecord>()
  let totalBytes = 0

  function evictWhileOver(): void {
    while (store.size > maxEntries || totalBytes > maxBytes) {
      const oldest = store.keys().next()
      if (oldest.done) break
      const rec = store.get(oldest.value)
      store.delete(oldest.value)
      if (rec) totalBytes -= rec.bytes
    }
  }

  return {
    get(hash) {
      const rec = store.get(hash)
      if (!rec) return undefined
      // Mark most-recently-used.
      store.delete(hash)
      store.set(hash, rec)
      return rec.files
    },
    set(hash, files) {
      const existing = store.get(hash)
      if (existing) {
        totalBytes -= existing.bytes
        store.delete(hash)
      }
      const bytes = entryBytes(files)
      // A single body larger than the whole budget is not cached (it would evict
      // everything and still not fit); serve it through without caching.
      if (bytes > maxBytes) {
        evictWhileOver()
        return
      }
      store.set(hash, { files, bytes })
      totalBytes += bytes
      evictWhileOver()
    },
    delete(hash) {
      const rec = store.get(hash)
      if (rec) {
        store.delete(hash)
        totalBytes -= rec.bytes
      }
    },
    size() {
      return store.size
    },
    clear() {
      store.clear()
      totalBytes = 0
    },
  }
}

/** Process-wide singleton used by {@link getSkillBundleContent}. */
export const versionBodyCache: VersionBodyCache = createVersionBodyCache()
