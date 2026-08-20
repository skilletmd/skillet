import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { listDevices } from '../src/commands/device.js';
import { skilletDir } from '../src/session-token.js';

describe('listDevices', () => {
  let prevSkilletDir: string | undefined;
  let prevRegistryUrl: string | undefined;
  let prevRegistry: string | undefined;

  beforeEach(async () => {
    prevSkilletDir = process.env['SKILLET_DIR'];
    prevRegistryUrl = process.env['SKILLET_REGISTRY_URL'];
    prevRegistry = process.env['SKILLET_REGISTRY'];
    process.env['SKILLET_DIR'] = join(await mkdtemp(join(tmpdir(), 'skillet-device-list-')), '.skillet');
    // No registry env by default: each test opts in so precedence is explicit.
    delete process.env['SKILLET_REGISTRY_URL'];
    delete process.env['SKILLET_REGISTRY'];
  });

  afterEach(() => {
    if (prevSkilletDir !== undefined) process.env['SKILLET_DIR'] = prevSkilletDir;
    else delete process.env['SKILLET_DIR'];
    if (prevRegistryUrl !== undefined) process.env['SKILLET_REGISTRY_URL'] = prevRegistryUrl;
    else delete process.env['SKILLET_REGISTRY_URL'];
    if (prevRegistry !== undefined) process.env['SKILLET_REGISTRY'] = prevRegistry;
    else delete process.env['SKILLET_REGISTRY'];
  });

  it('lists bearer sync devices with session only (no delegations fetch)', async () => {
    const dir = skilletDir();
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'session.json'),
      JSON.stringify({ session_token: 'skillet_s_devlist' }) + '\n',
      'utf8',
    );

    const fetchImpl = async (url: string | URL, init?: RequestInit) => {
      const path = String(url);
      expect(init?.headers && (init.headers as Record<string, string>)['authorization']).toBe(
        'Bearer skillet_s_devlist',
      );
      if (path.endsWith('/api/v1/delegations')) {
        throw new Error('listDevices must not fetch delegations');
      }
      if (path.endsWith('/api/v1/devices')) {
        return new Response(
          JSON.stringify({
            devices: [
              {
                device_id: 'device-sync-1',
                label: 'Thiago Laptop',
                created_at: 1718659200,
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      throw new Error(`unexpected fetch: ${path}`);
    };

    const result = await listDevices({
      registryUrl: 'https://registry.test',
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(result.delegations).toEqual([]);
    expect(result.sync_devices).toHaveLength(1);
    expect(result.sync_devices[0]?.label).toBe('Thiago Laptop');
  });

  it('honors SKILLET_REGISTRY_URL when no explicit registry is passed', async () => {
    // Regression: `skillet device list` used to resolve to the prod default and
    // 401 as "anonymous devices are no longer supported" when the dev binary
    // (SKILLET_REGISTRY_URL set, no pinned identity) sent its dev device token.
    process.env['SKILLET_REGISTRY_URL'] = 'http://localhost:3481';

    const dir = skilletDir();
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'device.json'),
      JSON.stringify({ device_id: 'dev-1', device_token: 'skillet_d_dev' }) + '\n',
      'utf8',
    );

    let seenUrl: string | null = null;
    const fetchImpl = async (url: string | URL) => {
      seenUrl = String(url);
      return new Response(JSON.stringify({ devices: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    await listDevices({ fetchImpl: fetchImpl as typeof fetch });

    expect(seenUrl).toBe('http://localhost:3481/api/v1/devices');
  });
});
