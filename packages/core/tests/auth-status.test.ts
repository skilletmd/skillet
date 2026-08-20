/**
 * authStatus — session vs signing identity (whoami UX).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('authStatus', () => {
  let skilletDir: string;
  const prevDir = process.env['SKILLET_DIR'];

  beforeEach(async () => {
    vi.resetModules();
    skilletDir = await mkdtemp(join(tmpdir(), 'skillet-auth-status-'));
    process.env['SKILLET_DIR'] = skilletDir;
  });

  afterEach(async () => {
    if (prevDir === undefined) delete process.env['SKILLET_DIR'];
    else process.env['SKILLET_DIR'] = prevDir;
    await rm(skilletDir, { recursive: true, force: true });
  });

  it('resolves registry handle from session when no signing identity exists', async () => {
    await mkdir(skilletDir, { recursive: true });
    await writeFile(
      join(skilletDir, 'session.json'),
      JSON.stringify({ session_token: 'skillet_s_testtoken123', saved_at: new Date().toISOString() }),
      'utf8',
    );

    const { fetch } = mockFetch(() => ({
      status: 200,
      body: {
        handle: 'thiago',
        user_id: 'user-abc',
        device_id: null,
        scopes: ['publish'],
      },
    }));

    const { authStatus: loadStatus } = await import('../src/commands/auth-status.js');
    const status = await loadStatus({
      registryUrl: 'https://registry.example',
      fetchImpl: fetch,
    });

    expect(status.identity).toBeNull();
    expect(status.whoami?.handle).toBe('thiago');
    expect(status.bearer.kind).toBe('session');
    expect(status.hints.some((h) => h.includes('session publish'))).toBe(true);
    expect(status.hints.some((h) => h.includes('sync only'))).toBe(false);
    expect(status.linked_machine).toBe(false);
  });

  it('explains stale local key when it does not match registry primary', async () => {
    await mkdir(skilletDir, { recursive: true });
    await writeFile(
      join(skilletDir, 'session.json'),
      JSON.stringify({ session_token: 'skillet_s_testtoken123', saved_at: new Date().toISOString() }),
      'utf8',
    );
    await writeFile(
      join(skilletDir, 'identity.json'),
      JSON.stringify({
        handle: 'thiago',
        keyId: '663bfe913b0d3a717935602774b3fcf7b78c6df262e5711bb7bee93ded87cc93',
        registryUrl: 'https://registry.example',
        createdAt: new Date().toISOString(),
      }),
      'utf8',
    );
    await chmod(join(skilletDir, 'identity.json'), 0o600);

    const { fetch } = mockFetch(() => ({
      status: 200,
      body: {
        handle: 'thiago',
        user_id: 'user-abc',
        author_key_id: 'b297af30c96602daabb84652b68a91548ed16001f4084bb8dc5d14244f5b0d08',
        scopes: ['publish'],
      },
    }));

    const { authStatus: loadStatus } = await import('../src/commands/auth-status.js');
    const status = await loadStatus({
      registryUrl: 'https://registry.example',
      fetchImpl: fetch,
    });

    expect(status.identity?.keyId).toBe(
      '663bfe913b0d3a717935602774b3fcf7b78c6df262e5711bb7bee93ded87cc93',
    );
    expect(status.hints.some((h) => h.includes('session-linked, not primary'))).toBe(true);
    expect(status.hints.some((h) => h.includes('sync only'))).toBe(false);
    expect(
      status.hints.some((h) => h.includes('Session publish does not')),
    ).toBe(true);
  });

  it('reports linked_machine when pair credentials exist but whoami is offline', async () => {
    await mkdir(skilletDir, { recursive: true });
    await writeFile(
      join(skilletDir, 'session.json'),
      JSON.stringify({ session_token: 'skillet_s_testtoken123', saved_at: new Date().toISOString() }),
      'utf8',
    );
    await writeFile(
      join(skilletDir, 'device.json'),
      JSON.stringify({
        device_token: 'skillet_d_devtoken123',
        device_id: 'dev-abc',
        label: "Test Mac",
        saved_at: new Date().toISOString(),
      }),
      'utf8',
    );

    const { fetch } = mockFetch(() => ({ status: 503, body: { message: 'offline' } }));

    const { authStatus: loadStatus } = await import('../src/commands/auth-status.js');
    const status = await loadStatus({
      registryUrl: 'https://registry.example',
      fetchImpl: fetch,
    });

    expect(status.bearer.kind).toBe('device');
    expect(status.linked_machine).toBe(true);
    expect(status.whoami).toBeNull();
    // 5xx/network is offline, not a rejection — stays linked, no re-pair prompt.
    expect(status.credential_rejected).toBe(false);
    expect(status.hints.some((h) => h.includes('Anonymous device'))).toBe(false);
    expect(status.hints.some((h) => h.includes('Device linked'))).toBe(true);
  });

  it('flags a rejected credential as disconnected, not offline', async () => {
    await mkdir(skilletDir, { recursive: true });
    await writeFile(
      join(skilletDir, 'session.json'),
      JSON.stringify({ session_token: 'skillet_s_testtoken123', saved_at: new Date().toISOString() }),
      'utf8',
    );
    await writeFile(
      join(skilletDir, 'device.json'),
      JSON.stringify({
        device_token: 'skillet_d_devtoken123',
        device_id: 'dev-abc',
        label: 'Test Mac',
        saved_at: new Date().toISOString(),
      }),
      'utf8',
    );

    const { fetch } = mockFetch(() => ({ status: 401, body: { error: 'auth_required' } }));

    const { authStatus: loadStatus } = await import('../src/commands/auth-status.js');
    const status = await loadStatus({
      registryUrl: 'https://registry.example',
      fetchImpl: fetch,
    });

    expect(status.bearer.kind).toBe('device');
    expect(status.whoami).toBeNull();
    expect(status.credential_rejected).toBe(true);
    // A revoked/stale token is NOT a linked machine — it must re-pair.
    expect(status.linked_machine).toBe(false);
    expect(status.hints.some((h) => h.includes('was disconnected'))).toBe(true);
    expect(status.hints.some((h) => h.includes('skillet connect'))).toBe(true);
    // Must not fall through to the offline "Device linked" reassurance.
    expect(status.hints.some((h) => h.includes('Device linked'))).toBe(false);
  });

  it('gives pairing guidance for an unpaired machine, with no anonymous wording', async () => {
    await mkdir(skilletDir, { recursive: true });
    const prevToken = process.env['SKILLET_TOKEN'];
    delete process.env['SKILLET_TOKEN'];

    let fetchCalls = 0;
    const { fetch } = mockFetch(() => {
      fetchCalls += 1;
      return { status: 200, body: {} };
    });

    try {
      const { authStatus: loadStatus } = await import('../src/commands/auth-status.js');
      const status = await loadStatus({
        registryUrl: 'https://registry.example',
        fetchImpl: fetch,
      });

      expect(status.bearer.kind).toBe('none');
      expect(status.linked_machine).toBe(false);
      expect(fetchCalls).toBe(0);
      expect(status.hints.some((h) => h.includes('skillet connect'))).toBe(true);
      expect(status.hints.some((h) => h.toLowerCase().includes('sign in'))).toBe(true);
      expect(status.hints.some((h) => h.toLowerCase().includes('anonymous'))).toBe(false);
    } finally {
      if (prevToken !== undefined) process.env['SKILLET_TOKEN'] = prevToken;
    }
  });
});

function mockFetch(
  responder: () => { status: number; body: unknown },
): { fetch: typeof fetch } {
  const fetchImpl = async (): Promise<Response> => {
    const { status, body } = responder();
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetch: fetchImpl as typeof fetch };
}
