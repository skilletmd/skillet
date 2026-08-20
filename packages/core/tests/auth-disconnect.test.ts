/**
 * authDisconnectLocal — clears session, device, and identity files.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, chmod, access, readFile as readFileText } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('authDisconnectLocal', () => {
  let skilletDir: string;
  const prevDir = process.env['SKILLET_DIR'];

  beforeEach(async () => {
    vi.resetModules();
    skilletDir = await mkdtemp(join(tmpdir(), 'skillet-auth-disconnect-'));
    process.env['SKILLET_DIR'] = skilletDir;
  });

  afterEach(async () => {
    if (prevDir === undefined) delete process.env['SKILLET_DIR'];
    else process.env['SKILLET_DIR'] = prevDir;
    await rm(skilletDir, { recursive: true, force: true });
  });

  it('removes session, device, and identity files', async () => {
    await mkdir(skilletDir, { recursive: true });
    const sessionPath = join(skilletDir, 'session.json');
    const devicePath = join(skilletDir, 'device.json');
    const identityFile = join(skilletDir, 'identity.json');
    await writeFile(
      sessionPath,
      JSON.stringify({ session_token: 'skillet_s_testtoken123', saved_at: new Date().toISOString() }),
      'utf8',
    );
    await writeFile(
      devicePath,
      JSON.stringify({
        device_token: 'skillet_d_devtoken123',
        device_id: 'dev-1',
        saved_at: new Date().toISOString(),
      }),
      'utf8',
    );
    await writeFile(
      identityFile,
      JSON.stringify({
        handle: 'thiago',
        keyId: 'abc',
        registryUrl: 'https://registry.example',
        createdAt: new Date().toISOString(),
      }),
      'utf8',
    );
    await chmod(identityFile, 0o600);

    const { fetch, requests } = mockFetch(() => ({ status: 204, body: null }));
    const { authDisconnectLocal: disconnect } = await import('../src/commands/auth-disconnect.js');
    const result = await disconnect({ registryUrl: 'https://registry.example', fetchImpl: fetch });

    await expect(access(sessionPath)).rejects.toThrow();
    await expect(access(devicePath)).rejects.toThrow();
    await expect(access(identityFile)).rejects.toThrow();

    // Unregisters the machine server-side so it disappears from web Settings —
    // preferring the device token (never expires) over the session.
    const del = requests.find((r) => r.method === 'DELETE');
    expect(del?.url).toBe('https://registry.example/api/v1/devices/dev-1');
    expect(del?.authorization).toBe('Bearer skillet_d_devtoken123');
    expect(result.unregistered).toBe(true);
    expect(result.warning).toBeUndefined();

    // A 204 cascades the device-bound session revoke, so we skip the follow-on
    // POST /auth/logout that would 401 on the just-killed session.
    expect(requests.some((r) => r.url.endsWith('/auth/logout'))).toBe(false);
  });

  it('falls back to the session token when the device token is rejected (old registry)', async () => {
    await mkdir(skilletDir, { recursive: true });
    await writeFile(
      join(skilletDir, 'session.json'),
      JSON.stringify({ session_token: 'skillet_s_sess', saved_at: new Date().toISOString() }),
      'utf8',
    );
    await writeFile(
      join(skilletDir, 'device.json'),
      JSON.stringify({
        device_token: 'skillet_d_dead',
        device_id: 'dev-9',
        saved_at: new Date().toISOString(),
      }),
      'utf8',
    );

    // First DELETE (device token) → 401; retry (session token) → 204.
    // requests already includes the current call, so the 1st DELETE sees count 1.
    const { fetch, requests } = mockFetch(() => {
      const deleteCount = requests.filter((r) => r.method === 'DELETE').length;
      return { status: deleteCount === 1 ? 401 : 204, body: null };
    });
    const { authDisconnectLocal: disconnect } = await import('../src/commands/auth-disconnect.js');
    const result = await disconnect({ registryUrl: 'https://registry.example', fetchImpl: fetch });

    const dels = requests.filter((r) => r.method === 'DELETE');
    expect(dels.length).toBe(2);
    expect(dels[0]?.authorization).toBe('Bearer skillet_d_dead');
    expect(dels[1]?.authorization).toBe('Bearer skillet_s_sess');
    expect(result.unregistered).toBe(true);
    expect(result.warning).toBeUndefined();
  });

  it('treats a 404 (row already removed on web) as success, no warning', async () => {
    await mkdir(skilletDir, { recursive: true });
    await writeFile(
      join(skilletDir, 'session.json'),
      JSON.stringify({ session_token: 'skillet_s_sess', saved_at: new Date().toISOString() }),
      'utf8',
    );
    await writeFile(
      join(skilletDir, 'device.json'),
      JSON.stringify({
        device_token: 'skillet_d_dev',
        device_id: 'dev-gone',
        saved_at: new Date().toISOString(),
      }),
      'utf8',
    );

    const { fetch } = mockFetch(() => ({ status: 404, body: { error: 'device_not_found' } }));
    const { authDisconnectLocal: disconnect } = await import('../src/commands/auth-disconnect.js');
    const result = await disconnect({ registryUrl: 'https://registry.example', fetchImpl: fetch });
    expect(result.unregistered).toBe(true);
    expect(result.warning).toBeUndefined();
  });

  it('warns when the registry is unreachable, but still clears local files', async () => {
    await mkdir(skilletDir, { recursive: true });
    const sessionPath = join(skilletDir, 'session.json');
    const devicePath = join(skilletDir, 'device.json');
    await writeFile(
      sessionPath,
      JSON.stringify({ session_token: 'skillet_s_sess', saved_at: new Date().toISOString() }),
      'utf8',
    );
    await writeFile(
      devicePath,
      JSON.stringify({
        device_token: 'skillet_d_dev',
        device_id: 'dev-1',
        saved_at: new Date().toISOString(),
      }),
      'utf8',
    );

    const fetchImpl = async (): Promise<Response> => {
      throw new Error('network down');
    };
    const { authDisconnectLocal: disconnect } = await import('../src/commands/auth-disconnect.js');
    const result = await disconnect({
      registryUrl: 'https://registry.example',
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(result.unregistered).toBe(false);
    expect(result.warning).toBeTruthy();
    await expect(access(sessionPath)).rejects.toThrow();
    await expect(access(devicePath)).rejects.toThrow();
  });

  it('no device_id present → local-only sign-out, no DELETE, no warning', async () => {
    await mkdir(skilletDir, { recursive: true });
    await writeFile(
      join(skilletDir, 'session.json'),
      JSON.stringify({ session_token: 'skillet_s_sess', saved_at: new Date().toISOString() }),
      'utf8',
    );

    const { fetch, requests } = mockFetch(() => ({ status: 204, body: null }));
    const { authDisconnectLocal: disconnect } = await import('../src/commands/auth-disconnect.js');
    const result = await disconnect({ registryUrl: 'https://registry.example', fetchImpl: fetch });
    expect(requests.some((r) => r.method === 'DELETE')).toBe(false);
    expect(result.unregistered).toBe(true);
    expect(result.warning).toBeUndefined();
  });

  it('keeps a machine_id stub behind so re-pairing reclaims the same device row', async () => {
    await mkdir(skilletDir, { recursive: true });
    const devicePath = join(skilletDir, 'device.json');
    await writeFile(
      devicePath,
      JSON.stringify({
        device_token: 'skillet_d_devtoken123',
        device_id: 'dev-1',
        machine_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        saved_at: new Date().toISOString(),
      }),
      'utf8',
    );

    const { fetch } = mockFetch(() => ({ status: 204, body: null }));
    const { authDisconnectLocal: disconnect } = await import('../src/commands/auth-disconnect.js');
    await disconnect({ registryUrl: 'https://registry.example', fetchImpl: fetch });

    const stub = JSON.parse(await readFileText(devicePath, 'utf8')) as Record<string, unknown>;
    expect(stub['machine_id']).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(stub['device_token']).toBeUndefined();
    expect(stub['device_id']).toBeUndefined();

    // Credential readers treat the stub as signed-out.
    const { readDeviceFile, readActiveDeviceFile } = await import('../src/device-token.js');
    expect(await readDeviceFile()).toBeNull();
    expect(await readActiveDeviceFile()).toBeNull();
  });

  it('unlinks device.json on sign-out when it is corrupt, without throwing', async () => {
    await mkdir(skilletDir, { recursive: true });
    const devicePath = join(skilletDir, 'device.json');
    await writeFile(devicePath, '{not json', 'utf8');

    const { fetch } = mockFetch(() => ({ status: 204, body: null }));
    const { authDisconnectLocal: disconnect } = await import('../src/commands/auth-disconnect.js');
    await disconnect({ registryUrl: 'https://registry.example', fetchImpl: fetch });

    await expect(access(devicePath)).rejects.toThrow();
  });

  it('succeeds when no credential files exist', async () => {
    const { authDisconnectLocal: disconnect } = await import('../src/commands/auth-disconnect.js');
    const result = await disconnect();
    expect(result.unregistered).toBe(true);
    expect(result.warning).toBeUndefined();
  });

  it('still clears local files when registry logout fails', async () => {
    await mkdir(skilletDir, { recursive: true });
    const sessionPath = join(skilletDir, 'session.json');
    await writeFile(
      sessionPath,
      JSON.stringify({ session_token: 'skillet_s_testtoken123', saved_at: new Date().toISOString() }),
      'utf8',
    );

    const { fetch } = mockFetch(() => ({ status: 500, body: { error: 'nope' } }));
    const { authDisconnectLocal: disconnect } = await import('../src/commands/auth-disconnect.js');
    await disconnect({ registryUrl: 'https://registry.example', fetchImpl: fetch });

    await expect(access(sessionPath)).rejects.toThrow();
  });

  it('still clears local files when the device DELETE throws', async () => {
    await mkdir(skilletDir, { recursive: true });
    const sessionPath = join(skilletDir, 'session.json');
    const devicePath = join(skilletDir, 'device.json');
    await writeFile(
      sessionPath,
      JSON.stringify({ session_token: 'skillet_s_testtoken123', saved_at: new Date().toISOString() }),
      'utf8',
    );
    await writeFile(
      devicePath,
      JSON.stringify({
        device_token: 'skillet_d_devtoken123',
        device_id: 'dev-1',
        saved_at: new Date().toISOString(),
      }),
      'utf8',
    );

    const fetchImpl = async (): Promise<Response> => {
      throw new Error('network down');
    };
    const { authDisconnectLocal: disconnect } = await import('../src/commands/auth-disconnect.js');
    await disconnect({ registryUrl: 'https://registry.example', fetchImpl: fetchImpl as typeof fetch });

    await expect(access(sessionPath)).rejects.toThrow();
    await expect(access(devicePath)).rejects.toThrow();
  });
});

interface RecordedRequest {
  url: string;
  method: string;
  authorization: string | undefined;
}

function mockFetch(
  responder: () => { status: number; body: unknown },
): { fetch: typeof fetch; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    requests.push({
      url: String(input),
      method: init?.method ?? 'GET',
      authorization: headers.get('authorization') ?? undefined,
    });
    const { status, body } = responder();
    // Null-body statuses (204) must not carry a body, or the Response ctor throws.
    const bodyInit = body == null ? null : JSON.stringify(body);
    return new Response(bodyInit, { status, headers: { 'content-type': 'application/json' } });
  };
  return { fetch: fetchImpl as typeof fetch, requests };
}
