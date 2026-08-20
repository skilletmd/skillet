// Best-effort Cloudflare prefix purge for public catalog list URLs.
// When zone / token env is unset, purge is a silent no-op so local/dev still works.

import { clearCatalogListMemo } from './catalog-list-memo.js';

export const CLOUDFLARE_CATALOG_PURGE_PREFIXES = [
  '/api/v1/skills',
  '/api/v1/discover/',
  '/api/v1/search',
] as const;

export type CloudflareCatalogPurgeEnv = {
  zoneId?: string;
  apiToken?: string;
  /** Public registry origin used to expand prefixes into absolute URLs for CF. */
  publicOrigin?: string;
};

export type CloudflareCatalogPurgeDeps = {
  fetchImpl?: typeof fetch;
  env?: CloudflareCatalogPurgeEnv;
  log?: (message: string) => void;
};

function readEnv(): CloudflareCatalogPurgeEnv {
  return {
    zoneId: process.env.SKILLET_CF_ZONE_ID?.trim() || undefined,
    apiToken: process.env.SKILLET_CF_API_TOKEN?.trim() || undefined,
    publicOrigin:
      process.env.SKILLET_CF_PURGE_ORIGIN?.trim() ||
      process.env.NEXT_PUBLIC_REGISTRY_PUBLIC_URL?.trim() ||
      process.env.REGISTRY_PUBLIC_URL?.trim() ||
      undefined,
  };
}

function expandPrefixes(origin: string, prefixes: readonly string[]): string[] {
  const base = origin.replace(/\/+$/, '');
  return prefixes.map((p) => `${base}${p.startsWith('/') ? p : `/${p}`}`);
}

/**
 * Clear in-process catalog memo, then best-effort purge CF prefixes.
 * Never throws; publish paths must stay reliable if purge fails.
 */
export async function invalidateCatalogCachesAfterPublish(
  deps: CloudflareCatalogPurgeDeps = {},
): Promise<{ memoCleared: true; purged: boolean; skippedReason?: string }> {
  clearCatalogListMemo();

  const env = deps.env ?? readEnv();
  const log = deps.log ?? (() => undefined);
  const fetchImpl = deps.fetchImpl ?? fetch;

  if (!env.zoneId || !env.apiToken) {
    log('cloudflare catalog purge skipped: SKILLET_CF_ZONE_ID / SKILLET_CF_API_TOKEN unset');
    return { memoCleared: true, purged: false, skippedReason: 'credentials_unset' };
  }
  if (!env.publicOrigin) {
    log('cloudflare catalog purge skipped: SKILLET_CF_PURGE_ORIGIN unset');
    return { memoCleared: true, purged: false, skippedReason: 'origin_unset' };
  }

  const prefixes = expandPrefixes(env.publicOrigin, CLOUDFLARE_CATALOG_PURGE_PREFIXES);
  try {
    const res = await fetchImpl(
      `https://api.cloudflare.com/client/v4/zones/${env.zoneId}/purge_cache`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${env.apiToken}`,
          'content-type': 'application/json',
        },
        // CF accepts prefixes for cache purge on many plans; URL list covers exact paths too.
        body: JSON.stringify({ prefixes }),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      log(`cloudflare catalog purge failed: HTTP ${res.status} ${body.slice(0, 200)}`);
      return { memoCleared: true, purged: false, skippedReason: `http_${res.status}` };
    }
    return { memoCleared: true, purged: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`cloudflare catalog purge error: ${message}`);
    return { memoCleared: true, purged: false, skippedReason: 'fetch_error' };
  }
}
