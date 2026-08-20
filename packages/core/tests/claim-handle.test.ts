/**
 * claimHandle — auth login → claim without prior login --handle.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const TEST_ROOT = vi.hoisted(() => {
  const osMod = require('node:os') as typeof import('node:os');
  const cryptoMod = require('node:crypto') as typeof import('node:crypto');
  const pathMod = require('node:path') as typeof import('node:path');
  const root = pathMod.join(
    osMod.tmpdir(),
    `skillet-claim-test-${cryptoMod.randomBytes(4).toString('hex')}`,
  );
  process.env['SKILLET_DIR'] = pathMod.join(root, '.skillet');
  process.env['XDG_CONFIG_HOME'] = pathMod.join(root, '.config');
  return root;
});

describe('claimHandle', () => {
  let skilletDir: string;
  let configDir: string;

  beforeEach(async () => {
    vi.resetModules();
    skilletDir = process.env['SKILLET_DIR'] as string;
    configDir = process.env['XDG_CONFIG_HOME'] as string;
    await mkdir(skilletDir, { recursive: true });
    await mkdir(configDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('binds session handle and mints a local key when identity is missing', async () => {
    await writeFile(
      join(skilletDir, 'session.json'),
      JSON.stringify({ session_token: 'skillet_s_testclaim' }),
      'utf8',
    );

    const calls: string[] = [];
    const { fetch } = mockFetch((url, method) => {
      calls.push(`${method} ${url}`);
      if (url.endsWith('/api/v1/whoami')) {
        return { status: 200, body: { handle: 'thiago', user_id: 'u1' } };
      }
      if (url.endsWith('/api/v1/claim')) {
        return {
          status: 200,
          body: { handle: 'thiago', key_id: 'abc123' },
        };
      }
      return { status: 404, body: { error: 'not_found' } };
    });

    const { claimHandle: runClaim } = await import('../src/commands/claim.js');
    const { loadIdentity } = await import('../src/identity/index.js');

    const result = await runClaim({
      registryUrl: 'https://registry.example',
      fetchImpl: fetch,
      configDir,
    });

    expect(result.handle).toBe('thiago');
    expect(calls.some((c) => c.startsWith('GET ') && c.includes('/whoami'))).toBe(true);
    expect(calls.some((c) => c.startsWith('POST ') && c.includes('/claim'))).toBe(true);

    const identity = await loadIdentity();
    expect(identity?.handle).toBe('thiago');
    expect(identity?.registryUrl).toBe('https://registry.example');
  });

  it('treats key_change_forbidden as linked secondary device when session handle matches', async () => {
    await writeFile(
      join(skilletDir, 'session.json'),
      JSON.stringify({ session_token: 'skillet_s_secondary' }),
      'utf8',
    );

    const { fetch } = mockFetch((url, method) => {
      if (url.endsWith('/api/v1/whoami')) {
        return {
          status: 200,
          body: { handle: 'thiago', user_id: 'u1', author_key_id: 'remotekey123' },
        };
      }
      if (url.endsWith('/api/v1/claim') && method === 'POST') {
        return {
          status: 409,
          body: {
            error: 'key_change_forbidden',
            message: 'Handle is already bound to a different author key.',
          },
        };
      }
      return { status: 404, body: { error: 'not_found' } };
    });

    const { claimHandle: runClaim } = await import('../src/commands/claim.js');
    const { loadIdentity } = await import('../src/identity/index.js');

    const result = await runClaim({
      registryUrl: 'https://registry.example',
      fetchImpl: fetch,
      configDir,
    });

    expect(result.handle).toBe('thiago');
    expect(result.key_id).toBe('remotekey123');
    expect(result.primaryElsewhere).toBe(true);
    expect(await loadIdentity()).toBeNull();
  });
});

function mockFetch(
  responder: (url: string, method: string) => { status: number; body: unknown },
): { fetch: typeof fetch } {
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    const { status, body } = responder(url, method);
    return new Response(body == null ? '' : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetch: fetchImpl as typeof fetch };
}
