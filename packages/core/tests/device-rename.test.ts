import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { renameDevice, DeviceCommandError } from '../src/commands/device.js';
import { skilletDir } from '../src/session-token.js';

const DEVICE = {
  device_token: 'skillet_d_selftoken',
  device_id: 'dev-42',
  label: 'test-machine',
  machine_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  saved_at: new Date().toISOString(),
};

async function seedDeviceFile(): Promise<void> {
  const dir = skilletDir();
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'device.json'), JSON.stringify(DEVICE));
}

describe('renameDevice', () => {
  let prevHome: string | undefined;
  let prevProfile: string | undefined;
  let prevDir: string | undefined;

  beforeEach(async () => {
    prevHome = process.env['HOME'];
    prevProfile = process.env['USERPROFILE'];
    prevDir = process.env['SKILLET_DIR'];
    const root = await mkdtemp(join(tmpdir(), 'skillet-rename-'));
    process.env['HOME'] = root;
    // skilletDir() reads SKILLET_DIR, which overrides HOME — isolate it too or
    // the seeded device.json clobbers the developer's real ~/.skillet.
    process.env['SKILLET_DIR'] = join(root, '.skillet');
    if (process.platform === 'win32') process.env['USERPROFILE'] = root;
  });

  afterEach(() => {
    if (prevHome !== undefined) process.env['HOME'] = prevHome;
    else delete process.env['HOME'];
    if (prevDir !== undefined) process.env['SKILLET_DIR'] = prevDir;
    else delete process.env['SKILLET_DIR'];
    if (prevProfile !== undefined) process.env['USERPROFILE'] = prevProfile;
    else if (process.platform === 'win32') delete process.env['USERPROFILE'];
  });

  it('PATCHes the registry with the device bearer and updates device.json', async () => {
    await seedDeviceFile();
    let method = '';
    let url = '';
    let auth = '';
    let body: unknown = null;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      url = String(input);
      method = init?.method ?? 'GET';
      auth = String((init?.headers as Record<string, string>)?.['authorization'] ?? '');
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ device_id: 'dev-42', label: 'studio mac' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const result = await renameDevice('  studio mac  ', {
      registryUrl: 'https://registry.test',
      fetchImpl,
    });

    expect(result).toEqual({ device_id: 'dev-42', label: 'studio mac' });
    expect(method).toBe('PATCH');
    expect(url).toBe('https://registry.test/api/v1/devices/dev-42');
    // Device token is the durable machine credential; it must carry the call.
    expect(auth).toBe('Bearer skillet_d_selftoken');
    expect(body).toEqual({ label: 'studio mac' });

    const saved = JSON.parse(
      await readFile(join(skilletDir(), 'device.json'), 'utf8'),
    ) as typeof DEVICE;
    expect(saved.label).toBe('studio mac');
    expect(saved.device_id).toBe('dev-42');
    expect(saved.device_token).toBe('skillet_d_selftoken');
    expect(saved.machine_id).toBe(DEVICE.machine_id);
  });

  it('rejects empty/whitespace labels before any network call', async () => {
    await seedDeviceFile();
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    await expect(renameDevice('   ', { fetchImpl })).rejects.toThrow(DeviceCommandError);
    expect(called).toBe(false);

    const saved = JSON.parse(
      await readFile(join(skilletDir(), 'device.json'), 'utf8'),
    ) as typeof DEVICE;
    expect(saved.label).toBe('test-machine');
  });

  it('errors clearly when unpaired, without a network call', async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    await expect(renameDevice('x', { fetchImpl })).rejects.toThrow(/not paired/);
    expect(called).toBe(false);
  });

  it('surfaces a registry failure and leaves device.json unchanged', async () => {
    await seedDeviceFile();
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ error: 'device_not_found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;

    await expect(
      renameDevice('new name', { registryUrl: 'https://registry.test', fetchImpl }),
    ).rejects.toThrow();

    const saved = JSON.parse(
      await readFile(join(skilletDir(), 'device.json'), 'utf8'),
    ) as typeof DEVICE;
    expect(saved.label).toBe('test-machine');
  });
});
