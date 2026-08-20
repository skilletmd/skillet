/**
 * Per-device kit routing on the union-manifest pull path.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { reconcilePrune } from '../src/commands/sync.js';
import { pullFromUnionManifest } from '../src/registry/pull.js';
import type { KitState, SkillEntry } from '../src/kit/types.js';

const TEST_ROOT = vi.hoisted(() => {
  const { redirectHome } = require('./helpers/redirect-home.cjs')
  return redirectHome('skillet-kit-routing')
})

function manifestResponse(items: Array<Record<string, unknown>>): Response {
  return new Response(
    JSON.stringify({
      schema_version: 1,
      etag: 'sha256:' + '0'.repeat(64),
      sync_interval_seconds: null,
      account_scope: 'user',
      items,
    }),
    { status: 200, headers: { etag: '"x"', 'content-type': 'application/json' } },
  );
}

function entry(over: Partial<SkillEntry>): SkillEntry {
  return {
    slug: 'x',
    name: 'x',
    description: '',
    version: 1,
    hash: 'sha256:abc',
    source: 'registry',
    importedAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

describe('pullFromUnionManifest device routing', () => {
  let state: KitState;

  beforeEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true });
    state = { version: 1, skills: {} } as KitState;
  });

  afterEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('forwards deviceId as the device query param on manifest fetch', async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = String(input);
      expect(url).toContain('device=dev-machine-1');
      return manifestResponse([]);
    }) as unknown as typeof fetch;

    await pullFromUnionManifest(state, {
      registryUrl: 'https://registry.test',
      token: 'skillet_d_test',
      deviceId: 'dev-machine-1',
      pinDir: join(TEST_ROOT, 'pins'),
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('uses the device-scoped manifest items returned by the registry', async () => {
    const fullUnionRef = '@alice/in-full-union';
    const deviceOnlyRef = '@alice/on-this-machine';

    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = String(input);
      const scoped = url.includes('device=dev-scoped');
      const ref = scoped ? deviceOnlyRef : fullUnionRef;
      return manifestResponse([
        {
          ref,
          version: 1,
          content_hash: 'sha256:' + (scoped ? 'a'.repeat(64) : 'b'.repeat(64)),
          signature: null,
          author_key_id: null,
          policy: 'manual',
          source_kit: null,
          external_author: true,
        },
      ]);
    }) as unknown as typeof fetch;

    const withoutDevice = await pullFromUnionManifest(state, {
      registryUrl: 'https://registry.test',
      token: 'skillet_d_test',
      pinDir: join(TEST_ROOT, 'pins'),
      fetchImpl,
    });
    expect(withoutDevice.manifestRefs?.has(fullUnionRef)).toBe(true);

    const withDevice = await pullFromUnionManifest(state, {
      registryUrl: 'https://registry.test',
      token: 'skillet_d_test',
      deviceId: 'dev-scoped',
      pinDir: join(TEST_ROOT, 'pins'),
      fetchImpl,
    });
    expect(withDevice.manifestRefs?.has(deviceOnlyRef)).toBe(true);
    expect(withDevice.manifestRefs?.has(fullUnionRef)).toBe(false);
  });
});

describe('device kit routing (sync prune)', () => {
  it('drops kit skills excluded from the device-scoped manifest', async () => {
    const state: KitState = {
      version: 1,
      skills: {
        '@skillet/commit-message': entry({
          slug: '@skillet/commit-message',
          owner: 'skillet',
          sourceKit: '@thiago/partner-kit',
        }),
        '@thiago/cli-skill': entry({
          slug: '@thiago/cli-skill',
          owner: 'thiago',
          sourceKit: '@thiago/cli-kit',
        }),
      },
    };

    const manifestRefs = new Set(['@thiago/cli-skill']);
    const res = await reconcilePrune(state, manifestRefs, [], { allowZeroOut: true });

    expect(res.pruned).toEqual([]);
    expect(state.skills['@skillet/commit-message']).toBeUndefined();
    expect(state.skills['@thiago/cli-skill']).toBeDefined();
  });
});
