import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Default null = OS identity unavailable, which exercises the stored-id and
// random-UUID fallbacks the pre-derivation tests below were written against.
const stableMachineIdMock = vi.fn<() => string | null>(() => null);
vi.mock('../src/machine-identity.js', () => ({
  stableMachineId: () => stableMachineIdMock(),
}));

import { authConnectPair, clientPlatformFromProcess } from '../src/commands/auth-connect-pair.js';
import { skilletDir } from '../src/session-token.js';

describe('authConnectPair', () => {
  let prevHome: string | undefined;
  let prevProfile: string | undefined;

  beforeEach(async () => {
    prevHome = process.env['HOME'];
    prevProfile = process.env['USERPROFILE'];
    const root = await mkdtemp(join(tmpdir(), 'skillet-pair-'));
    process.env['HOME'] = root;
    if (process.platform === 'win32') {
      process.env['USERPROFILE'] = root;
    }
  });

  afterEach(() => {
    if (prevHome !== undefined) process.env['HOME'] = prevHome;
    else delete process.env['HOME'];
    if (prevProfile !== undefined) process.env['USERPROFILE'] = prevProfile;
    else if (process.platform === 'win32') delete process.env['USERPROFILE'];
    stableMachineIdMock.mockReset();
    stableMachineIdMock.mockReturnValue(null);
  });

  it('saves session and device tokens after a successful claim', async () => {
    const fetchImpl = async (url: string | URL, init?: RequestInit) => {
      if (String(url).endsWith('/api/v1/connect/claim')) {
        return new Response(
          JSON.stringify({
            session_token: 'skillet_s_testsession',
            device_token: 'skillet_d_testdevice',
            device_id: 'dev-123',
            user_id: 'user-456',
            handle: 'pair-cli',
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('not found', { status: 404 });
    };

    const result = await authConnectPair({
      code: 'abc2-3456',
      registryUrl: 'https://registry.test',
      label: 'test-machine',
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(result.user_id).toBe('user-456');
    expect(result.handle).toBe('pair-cli');
    expect(result.session_token).toBe('skillet_s_testsession');
    expect(result.device_token).toBe('skillet_d_testdevice');

    const dir = skilletDir();
    const sessionRaw = JSON.parse(await readFile(join(dir, 'session.json'), 'utf8')) as {
      session_token: string;
    };
    const deviceRaw = JSON.parse(await readFile(join(dir, 'device.json'), 'utf8')) as {
      device_token: string;
      device_id: string;
      label: string;
    };
    expect(sessionRaw.session_token).toBe('skillet_s_testsession');
    expect(deviceRaw.device_token).toBe('skillet_d_testdevice');
    expect(deviceRaw.device_id).toBe('dev-123');
    expect(deviceRaw.label).toBe('test-machine');
  });

  it('normalizes pair codes before claim', async () => {
    let postedCode = '';
    let postedLabel = '';
    let postedClientKind = '';
    const fetchImpl = async (url: string | URL, init?: RequestInit) => {
      if (String(url).endsWith('/api/v1/connect/claim')) {
        const body = JSON.parse(String(init?.body)) as {
          code: string;
          label: string;
          client_kind: string;
        };
        postedCode = body.code;
        postedLabel = body.label;
        postedClientKind = body.client_kind;
        return new Response(
          JSON.stringify({
            session_token: 'skillet_s_x',
            device_token: 'skillet_d_x',
            device_id: 'd',
            user_id: 'u',
            handle: null,
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('not found', { status: 404 });
    };

    await authConnectPair({
      code: 'ab-c2 3456',
      registryUrl: 'https://registry.test',
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(postedCode).toBe('ABC23456');
    expect(postedLabel.length).toBeGreaterThan(0);
    expect(postedLabel).not.toBe('cli-device');
    expect(postedClientKind).toBe('cli');
  });

  it('sends desktop client_kind when requested', async () => {
    let postedClientKind = '';
    const fetchImpl = async (url: string | URL, init?: RequestInit) => {
      if (String(url).endsWith('/api/v1/connect/claim')) {
        const body = JSON.parse(String(init?.body)) as { client_kind: string };
        postedClientKind = body.client_kind;
        return new Response(
          JSON.stringify({
            session_token: 'skillet_s_x',
            device_token: 'skillet_d_x',
            device_id: 'd',
            user_id: 'u',
            handle: null,
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('not found', { status: 404 });
    };

    await authConnectPair({
      code: 'ABCD2345',
      registryUrl: 'https://registry.test',
      clientKind: 'desktop',
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(postedClientKind).toBe('desktop');
  });

  it('sends client_platform for desktop pairs on Windows', async () => {
    let postedBody: Record<string, string> = {};
    const fetchImpl = async (url: string | URL, init?: RequestInit) => {
      if (String(url).endsWith('/api/v1/connect/claim')) {
        postedBody = JSON.parse(String(init?.body)) as Record<string, string>;
        return new Response(
          JSON.stringify({
            session_token: 'skillet_s_x',
            device_token: 'skillet_d_x',
            device_id: 'd',
            user_id: 'u',
            handle: null,
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('not found', { status: 404 });
    };

    const platform = process.platform;
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' });
    try {
      await authConnectPair({
        code: 'ABCD2345',
        registryUrl: 'https://registry.test',
        clientKind: 'desktop',
        fetchImpl: fetchImpl as typeof fetch,
      });
    } finally {
      Object.defineProperty(process, 'platform', { configurable: true, value: platform });
    }
    expect(postedBody.client_platform).toBe('windows');
    expect(postedBody.client_kind).toBe('desktop');
  });

  it('sends macos client_platform for desktop pairs on darwin', async () => {
    let postedBody: Record<string, string> = {};
    const fetchImpl = async (url: string | URL, init?: RequestInit) => {
      if (String(url).endsWith('/api/v1/connect/claim')) {
        postedBody = JSON.parse(String(init?.body)) as Record<string, string>;
        return new Response(
          JSON.stringify({
            session_token: 'skillet_s_x',
            device_token: 'skillet_d_x',
            device_id: 'd',
            user_id: 'u',
            handle: null,
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('not found', { status: 404 });
    };

    const platform = process.platform;
    Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' });
    try {
      await authConnectPair({
        code: 'ABCD2345',
        registryUrl: 'https://registry.test',
        clientKind: 'desktop',
        fetchImpl: fetchImpl as typeof fetch,
      });
    } finally {
      Object.defineProperty(process, 'platform', { configurable: true, value: platform });
    }
    expect(postedBody.client_platform).toBe('macos');
  });

  it('omits client_platform for CLI pairs', async () => {
    let postedBody: Record<string, string> = {};
    const fetchImpl = async (url: string | URL, init?: RequestInit) => {
      if (String(url).endsWith('/api/v1/connect/claim')) {
        postedBody = JSON.parse(String(init?.body)) as Record<string, string>;
        return new Response(
          JSON.stringify({
            session_token: 'skillet_s_x',
            device_token: 'skillet_d_x',
            device_id: 'd',
            user_id: 'u',
            handle: null,
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('not found', { status: 404 });
    };

    await authConnectPair({
      code: 'ABCD2345',
      registryUrl: 'https://registry.test',
      clientKind: 'cli',
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(postedBody.client_platform).toBeUndefined();
  });

  it('clientPlatformFromProcess maps known platforms', () => {
    expect(clientPlatformFromProcess('darwin')).toBe('macos');
    expect(clientPlatformFromProcess('win32')).toBe('windows');
    expect(clientPlatformFromProcess('linux')).toBeUndefined();
  });

  it('mints a random machine_id on first pair when OS identity is unavailable', async () => {
    let postedBody: Record<string, string> = {};
    const fetchImpl = async (url: string | URL, init?: RequestInit) => {
      if (String(url).endsWith('/api/v1/connect/claim')) {
        postedBody = JSON.parse(String(init?.body)) as Record<string, string>;
        return new Response(
          JSON.stringify({
            session_token: 'skillet_s_x',
            device_token: 'skillet_d_x',
            device_id: 'd',
            user_id: 'u',
            handle: null,
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('not found', { status: 404 });
    };

    await authConnectPair({
      code: 'ABCD2345',
      registryUrl: 'https://registry.test',
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(postedBody.machine_id).toMatch(/^[0-9a-f-]{36}$/);

    const saved = JSON.parse(
      await readFile(join(skilletDir(), 'device.json'), 'utf8'),
    ) as { machine_id: string };
    expect(saved.machine_id).toBe(postedBody.machine_id);
  });

  it('reuses the stored machine_id across re-pairs when OS identity is unavailable', async () => {
    const dir = skilletDir();
    await mkdir(dir, { recursive: true });
    // A device.json left by some other pairing (foreign token) — machine_id
    // must survive and be presented so the registry can reclaim the row.
    await writeFile(
      join(dir, 'device.json'),
      JSON.stringify({
        device_token: 'skillet_d_foreign',
        machine_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        saved_at: new Date().toISOString(),
      }),
    );

    let postedBody: Record<string, string> = {};
    const fetchImpl = async (url: string | URL, init?: RequestInit) => {
      if (String(url).endsWith('/api/v1/connect/claim')) {
        postedBody = JSON.parse(String(init?.body)) as Record<string, string>;
        return new Response(
          JSON.stringify({
            session_token: 'skillet_s_x',
            device_token: 'skillet_d_new',
            device_id: 'd2',
            user_id: 'u',
            handle: null,
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('not found', { status: 404 });
    };

    await authConnectPair({
      code: 'ABCD2345',
      registryUrl: 'https://registry.test',
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(postedBody.machine_id).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(postedBody.device_token).toBe('skillet_d_foreign');

    const saved = JSON.parse(await readFile(join(dir, 'device.json'), 'utf8')) as {
      machine_id: string;
      device_token: string;
    };
    expect(saved.machine_id).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(saved.device_token).toBe('skillet_d_new');
  });

  it('prefers the derived OS identity over a stored legacy machine_id', async () => {
    const derived = 'f'.repeat(64);
    stableMachineIdMock.mockReturnValue(derived);
    const dir = skilletDir();
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'device.json'),
      JSON.stringify({
        device_token: 'skillet_d_old',
        machine_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        saved_at: new Date().toISOString(),
      }),
    );

    let postedBody: Record<string, string> = {};
    const fetchImpl = async (url: string | URL, init?: RequestInit) => {
      if (String(url).endsWith('/api/v1/connect/claim')) {
        postedBody = JSON.parse(String(init?.body)) as Record<string, string>;
        return new Response(
          JSON.stringify({
            session_token: 'skillet_s_x',
            device_token: 'skillet_d_new',
            device_id: 'd3',
            user_id: 'u',
            handle: null,
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('not found', { status: 404 });
    };

    await authConnectPair({
      code: 'ABCD2345',
      registryUrl: 'https://registry.test',
      fetchImpl: fetchImpl as typeof fetch,
    });
    // The derived id converges the row; the token-rebind path still matches by
    // the presented device_token, so preferring derived never orphans a row.
    expect(postedBody.machine_id).toBe(derived);
    expect(postedBody.device_token).toBe('skillet_d_old');

    const saved = JSON.parse(await readFile(join(dir, 'device.json'), 'utf8')) as {
      machine_id: string;
    };
    expect(saved.machine_id).toBe(derived);
  });

  it('presents the sign-out stub machine_id on re-pair, with no token', async () => {
    const dir = skilletDir();
    await mkdir(dir, { recursive: true });
    // What clearDeviceToken leaves behind: identity without a credential.
    await writeFile(
      join(dir, 'device.json'),
      JSON.stringify({
        machine_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        saved_at: new Date().toISOString(),
      }),
    );

    let postedBody: Record<string, string> = {};
    const fetchImpl = async (url: string | URL, init?: RequestInit) => {
      if (String(url).endsWith('/api/v1/connect/claim')) {
        postedBody = JSON.parse(String(init?.body)) as Record<string, string>;
        return new Response(
          JSON.stringify({
            session_token: 'skillet_s_x',
            device_token: 'skillet_d_back',
            device_id: 'd4',
            user_id: 'u',
            handle: null,
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('not found', { status: 404 });
    };

    await authConnectPair({
      code: 'ABCD2345',
      registryUrl: 'https://registry.test',
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(postedBody.machine_id).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(postedBody.device_token).toBeUndefined();
  });

  it('rejects codes that are not 8 characters after normalization', async () => {
    await expect(
      authConnectPair({ code: 'AB', registryUrl: 'https://registry.test' }),
    ).rejects.toThrow(/8 characters/);
  });
});
