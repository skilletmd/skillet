/**
 * Linked device bearer rejection on union manifest pull (web disconnect).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';

const TEST_ROOT = vi.hoisted(() => {
  const { redirectHome } = require('./helpers/redirect-home.cjs')
  return redirectHome('skillet-auth-reject')
})

import { mkdir, writeFile } from 'node:fs/promises';
import { pullFromUnionManifest } from '../src/registry/pull.js';
import { sync } from '../src/commands/sync.js';
import type { KitState } from '../src/kit/types.js';

describe('pullFromUnionManifest auth rejection', () => {
  let state: KitState;

  beforeEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true });
    state = { version: 1, skills: {} } as KitState;
  });

  afterEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('flags authRejected when a linked device token gets 401', async () => {
    const fetchImpl = vi.fn(async () => new Response('unauthorized', { status: 401 })) as unknown as typeof fetch;

    const res = await pullFromUnionManifest(state, {
      registryUrl: 'https://registry.test',
      token: 'skillet_d_deadbeef',
      pinDir: join(TEST_ROOT, 'pins'),
      fetchImpl,
    });

    expect(res.authRejected).toBe(true);
    expect(res.manifestRefs).toBeNull();
  });

  it('does not flag authRejected for session 401 (legacy swallow)', async () => {
    const fetchImpl = vi.fn(async () => new Response('unauthorized', { status: 401 })) as unknown as typeof fetch;

    const res = await pullFromUnionManifest(state, {
      registryUrl: 'https://registry.test',
      token: 'skillet_s_deadbeef',
      pinDir: join(TEST_ROOT, 'pins'),
      fetchImpl,
    });

    expect(res.authRejected).toBeUndefined();
  });
});

describe('sync() disconnect error code', () => {
  beforeEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true });
    const skilletDir = process.env['SKILLET_DIR'] as string;
    await mkdir(skilletDir, { recursive: true });
    await writeFile(
      join(skilletDir, 'device.json'),
      `${JSON.stringify({ device_id: 'dev-1', device_token: 'skillet_d_test' })}\n`,
    );
  });

  afterEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true });
  });

  const fetch401 = () =>
    vi.fn(async () => new Response('unauthorized', { status: 401 })) as unknown as typeof fetch;

  it('throws machine_disconnected when a linked device token gets 401', async () => {
    await expect(
      sync(TEST_ROOT, [], {
        token: 'skillet_d_test',
        registryUrl: 'https://registry.test',
        fetchImpl: fetch401(),
        pullMode: 'interactive',
      }),
    ).rejects.toMatchObject({
      code: 'machine_disconnected',
      message: expect.stringContaining('disconnected from your account'),
    });
  });

  it('throws machine_disconnected on the checkOnly path too', async () => {
    await expect(
      sync(TEST_ROOT, [], {
        token: 'skillet_d_test',
        registryUrl: 'https://registry.test',
        fetchImpl: fetch401(),
        checkOnly: true,
        pullMode: 'interactive',
      }),
    ).rejects.toMatchObject({ code: 'machine_disconnected' });
  });

  it('network failure does not carry the disconnect code', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;

    await expect(
      sync(TEST_ROOT, [], {
        token: 'skillet_d_test',
        registryUrl: 'https://registry.test',
        fetchImpl,
        pullMode: 'interactive',
      }),
    ).rejects.toMatchObject({ code: 'network_error' });
  });
});
