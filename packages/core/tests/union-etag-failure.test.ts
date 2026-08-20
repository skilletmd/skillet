/**
 * The union manifest etag must not be cached when the pull had hard failures —
 * an eagerly-cached etag turns an all-failed pull into a permanent silent
 * no-op (every later sync 304s and reports "unchanged").
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

const TEST_ROOT = vi.hoisted(() => {
  const { redirectHome } = require('./helpers/redirect-home.cjs');
  return redirectHome('skillet-union-etag');
});

import { pullFromUnionManifest } from '../src/registry/pull.js';
import type { KitState } from '../src/kit/types.js';

const MANIFEST = {
  schema_version: 1,
  etag: 'sha256:manifest-etag',
  sync_interval_seconds: 86400,
  account_scope: 'user',
  items: [
    {
      ref: '@mirror/tool',
      version: 1,
      content_hash: `sha256:${'a'.repeat(64)}`,
      signature: null,
      author_key_id: null,
      policy: 'manual',
      source_kit: '@mirror/kit',
    },
  ],
};

describe('union etag caching vs pull failures', () => {
  const etagPath = join(TEST_ROOT, 'etag-cache.json');
  let state: KitState;

  beforeEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
    state = { version: 1, skills: {} } as KitState;
  });

  afterEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true });
  });

  async function unionEtags(): Promise<Record<string, string>> {
    try {
      const raw = JSON.parse(await readFile(etagPath, 'utf8')) as {
        union?: Record<string, string>;
      };
      return raw.union ?? {};
    } catch {
      return {};
    }
  }

  it('does not cache the etag when items fail (unsigned version)', async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/sync/manifest')) {
        return new Response(JSON.stringify(MANIFEST), {
          status: 200,
          headers: { etag: '"union-etag-1"', 'content-type': 'application/json' },
        });
      }
      // Per-skill manifest: latest version exists but is unsigned → pull fails.
      if (url.includes('/skills/mirror/tool/versions/')) {
        return new Response(
          JSON.stringify({
            hash: 'a'.repeat(64),
            files: [],
            content_hash: `sha256:${'a'.repeat(64)}`,
            signature: null,
            author_key_id: null,
            author_public_key: null,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('/skills/mirror/tool')) {
        return new Response(
          JSON.stringify({
            latest_hash: `sha256:${'a'.repeat(64)}`,
            versions: [{ hash: 'a'.repeat(64), signature: null }],
            author_key_id: null,
            author_public_key: null,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;

    const res = await pullFromUnionManifest(state, {
      registryUrl: 'https://registry.test',
      token: 'skillet_d_test',
      pinDir: join(TEST_ROOT, 'pins'),
      etagCachePath: etagPath,
      fetchImpl,
    });

    expect(res.outcomes.some((o) => o.status === 'failed')).toBe(true);
    expect(await unionEtags()).toEqual({});
  });

  it('caches the etag when the pull has no failures', async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/sync/manifest')) {
        return new Response(JSON.stringify({ ...MANIFEST, items: [] }), {
          status: 200,
          headers: { etag: '"union-etag-2"', 'content-type': 'application/json' },
        });
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;

    await pullFromUnionManifest(state, {
      registryUrl: 'https://registry.test',
      token: 'skillet_d_test',
      pinDir: join(TEST_ROOT, 'pins'),
      etagCachePath: etagPath,
      fetchImpl,
    });

    const etags = await unionEtags();
    expect(Object.values(etags)).toContain('"union-etag-2"');
  });
});
