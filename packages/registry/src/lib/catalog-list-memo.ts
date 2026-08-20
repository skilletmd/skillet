// In-process singleflight + TTL memo for public catalog list loads.
// Process-local only (no Redis). Bounded so unique search keys cannot grow forever.

export const CATALOG_LIST_MEMO_TTL_MS = 60_000;
export const CATALOG_LIST_MEMO_MAX_ENTRIES = 512;

type Clock = () => number;

type MemoEntry<T> = {
  value: T;
  expiresAt: number;
};

type Inflight<T> = Promise<T>;

export type CatalogListMemoOptions = {
  ttlMs?: number;
  maxEntries?: number;
  now?: Clock;
};

export function createCatalogListMemo(opts: CatalogListMemoOptions = {}) {
  const ttlMs = opts.ttlMs ?? CATALOG_LIST_MEMO_TTL_MS;
  const maxEntries = opts.maxEntries ?? CATALOG_LIST_MEMO_MAX_ENTRIES;
  const now = opts.now ?? (() => Date.now());

  const store = new Map<string, MemoEntry<unknown>>();
  const inflight = new Map<string, Inflight<unknown>>();

  function pruneExpired(at: number): void {
    for (const [key, entry] of store) {
      if (entry.expiresAt <= at) store.delete(key);
    }
  }

  function evictOldestIfNeeded(): void {
    while (store.size > maxEntries) {
      const oldest = store.keys().next().value;
      if (oldest === undefined) break;
      store.delete(oldest);
    }
  }

  async function getOrLoad<T>(key: string, loader: () => Promise<T>): Promise<T> {
    const at = now();
    pruneExpired(at);

    const hit = store.get(key) as MemoEntry<T> | undefined;
    if (hit && hit.expiresAt > at) {
      // Refresh insertion order for a crude LRU among hits.
      store.delete(key);
      store.set(key, hit);
      return hit.value;
    }

    const pending = inflight.get(key) as Inflight<T> | undefined;
    if (pending) return pending;

    const load = (async () => {
      try {
        const value = await loader();
        store.set(key, { value, expiresAt: now() + ttlMs });
        evictOldestIfNeeded();
        return value;
      } finally {
        inflight.delete(key);
      }
    })();

    inflight.set(key, load);
    return load;
  }

  function clear(): void {
    store.clear();
    inflight.clear();
  }

  function size(): number {
    return store.size;
  }

  return { getOrLoad, clear, size };
}

/** Process-wide memo shared by catalog list routes. */
export const catalogListMemo = createCatalogListMemo();

export function clearCatalogListMemo(): void {
  catalogListMemo.clear();
}

/** Stable memo key from a route id and query object (sorted keys). */
export function catalogListMemoKey(
  routeId: string,
  query: Record<string, string | number | undefined | null>,
): string {
  const parts: string[] = [routeId];
  for (const key of Object.keys(query).sort()) {
    const raw = query[key];
    if (raw === undefined || raw === null || raw === '') continue;
    parts.push(`${key}=${String(raw)}`);
  }
  return parts.join('&');
}
