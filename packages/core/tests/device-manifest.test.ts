import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp } from 'node:fs/promises';
import { ARTIFACT_SCHEMA_VERSION } from '@skillet/protocol';
import { resolveDeviceScopedManifest } from '../src/registry/device-manifest.js';
import { skilletDir } from '../src/session-token.js';

const baseUrl = 'https://registry.example.com';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers as Record<string, string>) },
  });
}

describe('resolveDeviceScopedManifest', () => {
  let prevSkilletDir: string | undefined;
  let tempHome: string;

  beforeEach(async () => {
    prevSkilletDir = process.env['SKILLET_DIR'];
    tempHome = await mkdtemp(join(tmpdir(), 'skillet-device-manifest-'));
    process.env['SKILLET_DIR'] = join(tempHome, '.skillet');
    delete process.env['SKILLET_TOKEN'];
  });

  afterEach(() => {
    if (prevSkilletDir !== undefined) process.env['SKILLET_DIR'] = prevSkilletDir;
    else delete process.env['SKILLET_DIR'];
    vi.restoreAllMocks();
  });

  it('returns fetched:false when no bearer is configured', async () => {
    const res = await resolveDeviceScopedManifest({ registryUrl: baseUrl });
    expect(res).toEqual({ items: undefined, fetched: false, reached: false });
  });

  it('passes ?device= for session bearer with a linked device id', async () => {
    const dir = skilletDir();
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'session.json'),
      JSON.stringify({ session_token: 'skillet_s_sess' }) + '\n',
    );
    await writeFile(
      join(dir, 'device.json'),
      JSON.stringify({ device_id: 'dev-abc', label: 'Laptop' }) + '\n',
    );

    const fetchImpl = vi.fn(async (url: string | URL) => {
      expect(String(url)).toBe(
        'https://registry.example.com/api/v1/sync/manifest?device=dev-abc',
      );
      return jsonResponse({
        schema_version: ARTIFACT_SCHEMA_VERSION,
        etag: 'sha256:0',
        sync_interval_seconds: 86400,
        account_scope: 'user',
        items: [
          {
            ref: '@thiago/skill',
            version: 1,
            content_hash: 'sha256:abc',
            signature: null,
            author_key_id: null,
            policy: 'manual',
            source_kit: '@thiago/cli-kit',
            external_author: false,
          },
        ],
      });
    }) as unknown as typeof fetch;

    const res = await resolveDeviceScopedManifest({ registryUrl: baseUrl, fetchImpl });
    expect(res.fetched).toBe(true);
    expect(res.items?.map((i) => i.ref)).toEqual(['@thiago/skill']);
  });

  it('does not pass ?device= for device bearer (server scopes via principal)', async () => {
    const dir = skilletDir();
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'session.json'),
      JSON.stringify({ session_token: 'skillet_s_sess' }) + '\n',
    );
    await writeFile(
      join(dir, 'device.json'),
      JSON.stringify({
        device_token: 'skillet_d_dev',
        device_id: 'dev-linked',
        label: 'Laptop',
      }) + '\n',
    );

    const fetchImpl = vi.fn(async (url: string | URL) => {
      expect(String(url)).toBe('https://registry.example.com/api/v1/sync/manifest');
      return jsonResponse({
        schema_version: ARTIFACT_SCHEMA_VERSION,
        etag: 'sha256:0',
        sync_interval_seconds: 86400,
        account_scope: 'user',
        items: [],
      });
    }) as unknown as typeof fetch;

    const res = await resolveDeviceScopedManifest({ registryUrl: baseUrl, fetchImpl });
    expect(res).toEqual({ items: [], fetched: true, reached: true });
  });

  it('returns fetched:false on registry 401', async () => {
    const dir = skilletDir();
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'session.json'),
      JSON.stringify({ session_token: 'skillet_s_sess' }) + '\n',
    );

    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: 'auth_required' }, { status: 401 }),
    ) as unknown as typeof fetch;

    const res = await resolveDeviceScopedManifest({ registryUrl: baseUrl, fetchImpl });
    expect(res).toEqual({ items: undefined, fetched: false, reached: false });
  });
});
