/**
 * authLogout — clears local session even when registry revoke fails.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('authLogout', () => {
  let skilletDir: string;
  const prevDir = process.env['SKILLET_DIR'];

  beforeEach(async () => {
    vi.resetModules();
    skilletDir = await mkdtemp(join(tmpdir(), 'skillet-auth-logout-'));
    process.env['SKILLET_DIR'] = skilletDir;
  });

  afterEach(async () => {
    if (prevDir === undefined) delete process.env['SKILLET_DIR'];
    else process.env['SKILLET_DIR'] = prevDir;
    await rm(skilletDir, { recursive: true, force: true });
  });

  it('removes session file when registry logout succeeds', async () => {
    await mkdir(skilletDir, { recursive: true });
    const sessionPath = join(skilletDir, 'session.json');
    await writeFile(
      sessionPath,
      JSON.stringify({ session_token: 'skillet_s_testtoken123', saved_at: new Date().toISOString() }),
      'utf8',
    );

    const { fetch } = mockFetch(() => ({ status: 204, body: null }));
    const { authLogout } = await import('../src/commands/auth-logout.js');
    const result = await authLogout({ registryUrl: 'https://registry.example', fetchImpl: fetch });

    expect(result.serverRevoked).toBe(true);
    await expect(access(sessionPath)).rejects.toThrow();
  });

  it('still clears local session when registry logout fails', async () => {
    await mkdir(skilletDir, { recursive: true });
    const sessionPath = join(skilletDir, 'session.json');
    await writeFile(
      sessionPath,
      JSON.stringify({ session_token: 'skillet_s_testtoken123', saved_at: new Date().toISOString() }),
      'utf8',
    );

    const { fetch } = mockFetch(() => ({ status: 500, body: { error: 'nope' } }));
    const { authLogout } = await import('../src/commands/auth-logout.js');
    const result = await authLogout({ registryUrl: 'https://registry.example', fetchImpl: fetch });

    expect(result.serverRevoked).toBe(false);
    expect(result.serverWarning).toMatch(/HTTP 500/);
    await expect(access(sessionPath)).rejects.toThrow();
  });

  it('succeeds when no session file exists', async () => {
    const { authLogout } = await import('../src/commands/auth-logout.js');
    await expect(authLogout()).resolves.toMatchObject({ serverRevoked: true });
  });

  it('revokes the current device and clears device.json (#464)', async () => {
    await mkdir(skilletDir, { recursive: true });
    await writeFile(
      join(skilletDir, 'session.json'),
      JSON.stringify({ session_token: 'skillet_s_sess', saved_at: new Date().toISOString() }),
      'utf8',
    );
    await writeFile(
      join(skilletDir, 'device.json'),
      JSON.stringify({ device_token: 'skillet_d_dev', device_id: 'dev-123', saved_at: new Date().toISOString() }),
      'utf8',
    );

    const calls: string[] = [];
    const fetch = (async (url: string) => {
      calls.push(String(url));
      return new Response(null, { status: 204 });
    }) as unknown as typeof globalThis.fetch;

    const { authLogout } = await import('../src/commands/auth-logout.js');
    const result = await authLogout({ registryUrl: 'https://registry.example', fetchImpl: fetch });

    expect(result.serverRevoked).toBe(true);
    expect(calls).toContain('https://registry.example/api/v1/auth/logout');
    expect(calls).toContain('https://registry.example/api/v1/devices/dev-123/revoke');
    // Both local credentials cleared (device.json had no machine_id → removed).
    await expect(access(join(skilletDir, 'session.json'))).rejects.toThrow();
    await expect(access(join(skilletDir, 'device.json'))).rejects.toThrow();
  });

  it('clears local credentials even when the device revoke fails (#464)', async () => {
    await mkdir(skilletDir, { recursive: true });
    await writeFile(
      join(skilletDir, 'device.json'),
      JSON.stringify({ device_token: 'skillet_d_dev', device_id: 'dev-123', saved_at: new Date().toISOString() }),
      'utf8',
    );

    const fetch = (async () => new Response(null, { status: 500 })) as unknown as typeof globalThis.fetch;
    const { authLogout } = await import('../src/commands/auth-logout.js');
    const result = await authLogout({ registryUrl: 'https://registry.example', fetchImpl: fetch });

    expect(result.serverRevoked).toBe(false);
    await expect(access(join(skilletDir, 'device.json'))).rejects.toThrow();
  });
});

function mockFetch(
  responder: () => { status: number; body: unknown },
): { fetch: typeof fetch } {
  const fetchImpl = async (): Promise<Response> => {
    const { status, body } = responder();
    if (body == null) {
      return new Response(null, { status });
    }
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetch: fetchImpl as typeof fetch };
}
