/**
 * Union manifest ETag caching on GET /sync/manifest.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pullFromUnionManifest } from '../src/registry/pull.js';
import type { KitState } from '../src/kit/types.js';

const TEST_ROOT = vi.hoisted(() => {
  const { redirectHome } = require('./helpers/redirect-home.cjs');
  return redirectHome('skillet-union-etag');
});

function manifestBody(items: unknown[] = []) {
  return JSON.stringify({
    schema_version: 1,
    etag: 'sha256:' + 'a'.repeat(64),
    sync_interval_seconds: 86400,
    account_scope: 'user',
    items,
  });
}

describe('pullFromUnionManifest union ETag', () => {
  let state: KitState;
  const etagPath = join(TEST_ROOT, 'etag-cache.json');
  const registryUrl = 'https://registry.test';

  beforeEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true });
    state = { version: 1, skills: {} } as KitState;
  });

  afterEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('persists union ETag on 200 and sends If-None-Match on the next pull', async () => {
    let call = 0;
    const fetchImpl = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      call += 1;
      if (call === 2) {
        const headers = init?.headers as Record<string, string> | undefined;
        expect(headers?.['if-none-match']).toBe('"union-etag-1"');
      }
      if (call === 1) {
        return new Response(manifestBody([]), {
          status: 200,
          headers: { etag: '"union-etag-1"', 'content-type': 'application/json' },
        });
      }
      return new Response(null, {
        status: 304,
        headers: { etag: '"union-etag-1"' },
      });
    }) as unknown as typeof fetch;

    const first = await pullFromUnionManifest(state, {
      registryUrl,
      token: 'skillet_d_test',
      deviceId: 'dev-1',
      pinDir: join(TEST_ROOT, 'pins'),
      etagCachePath: etagPath,
      fetchImpl,
    });
    expect(first.unionNotModified).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const cache = JSON.parse(await readFile(etagPath, 'utf8')) as {
      union: Record<string, string>;
    };
    expect(cache.union[`${registryUrl}|dev-1|device`]).toBe('"union-etag-1"');

    const second = await pullFromUnionManifest(state, {
      registryUrl,
      token: 'skillet_d_test',
      deviceId: 'dev-1',
      pinDir: join(TEST_ROOT, 'pins'),
      etagCachePath: etagPath,
      fetchImpl,
    });
    expect(second.unionNotModified).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('uses separate cache keys per device id', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(manifestBody([]), {
        status: 200,
        headers: { etag: '"e"', 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    await pullFromUnionManifest(state, {
      registryUrl,
      token: 'skillet_d_a',
      deviceId: 'dev-a',
      pinDir: join(TEST_ROOT, 'pins'),
      etagCachePath: etagPath,
      fetchImpl,
    });
    await pullFromUnionManifest(state, {
      registryUrl,
      token: 'skillet_d_b',
      deviceId: 'dev-b',
      pinDir: join(TEST_ROOT, 'pins'),
      etagCachePath: etagPath,
      fetchImpl,
    });

    const cache = JSON.parse(await readFile(etagPath, 'utf8')) as {
      union: Record<string, string>;
    };
    expect(Object.keys(cache.union).sort()).toEqual(
      [`${registryUrl}|dev-a|device`, `${registryUrl}|dev-b|device`].sort(),
    );
  });
});
