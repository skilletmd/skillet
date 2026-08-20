import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLOUDFLARE_CATALOG_PURGE_PREFIXES,
  invalidateCatalogCachesAfterPublish,
} from '../src/lib/cloudflare-catalog-purge.js';
import { catalogListMemo, clearCatalogListMemo } from '../src/lib/catalog-list-memo.js';

describe('invalidateCatalogCachesAfterPublish', () => {
  it('clears the process memo even when CF credentials are unset', async () => {
    await catalogListMemo.getOrLoad('purge-test-key', async () => 'v1');
    assert.ok(catalogListMemo.size() >= 1);

    const result = await invalidateCatalogCachesAfterPublish({
      env: {},
      fetchImpl: async () => {
        throw new Error('fetch must not run without credentials');
      },
    });

    assert.equal(result.memoCleared, true);
    assert.equal(result.purged, false);
    assert.equal(result.skippedReason, 'credentials_unset');
    assert.equal(catalogListMemo.size(), 0);
  });

  it('calls Cloudflare purge_cache with catalog prefixes when configured', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const result = await invalidateCatalogCachesAfterPublish({
      env: {
        zoneId: 'zone-1',
        apiToken: 'token-1',
        publicOrigin: 'https://registry.example.com',
      },
      fetchImpl: async (input, init) => {
        const url = String(input);
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        calls.push({ url, body });
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      },
    });

    assert.equal(result.purged, true);
    assert.equal(calls.length, 1);
    assert.match(calls[0]!.url, /zones\/zone-1\/purge_cache/);
    const prefixes = (calls[0]!.body as { prefixes: string[] }).prefixes;
    for (const p of CLOUDFLARE_CATALOG_PURGE_PREFIXES) {
      assert.ok(
        prefixes.some((u) => u.includes(p)),
        `missing prefix ${p} in ${JSON.stringify(prefixes)}`,
      );
    }
  });

  it('does not throw when the CF API returns an error', async () => {
    const result = await invalidateCatalogCachesAfterPublish({
      env: {
        zoneId: 'zone-1',
        apiToken: 'token-1',
        publicOrigin: 'https://registry.example.com',
      },
      fetchImpl: async () => new Response('nope', { status: 500 }),
    });
    assert.equal(result.memoCleared, true);
    assert.equal(result.purged, false);
    assert.equal(result.skippedReason, 'http_500');
  });
});

describe('clearCatalogListMemo', () => {
  it('empties the shared memo', async () => {
    await catalogListMemo.getOrLoad('shared', async () => 1);
    clearCatalogListMemo();
    assert.equal(catalogListMemo.size(), 0);
  });
});
