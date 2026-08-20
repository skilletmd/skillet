import { describe, it, expect } from 'vitest';
import { mintPairCode } from '../src/commands/mint-pair-code.js';

describe('mintPairCode', () => {
  it('mints a code with an explicit account token', async () => {
    let sentAuth = '';
    let hitUrl = '';
    const fetchImpl = async (url: string | URL, init?: RequestInit) => {
      hitUrl = String(url);
      sentAuth = String((init?.headers as Record<string, string>)?.authorization ?? '');
      return new Response(
        JSON.stringify({ code: 'ABCD2345', expires_at: 1234567890, ttl_sec: 300 }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      );
    };

    const result = await mintPairCode({
      token: 'skillet_s_session',
      registryUrl: 'https://registry.test',
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(hitUrl).toBe('https://registry.test/api/v1/connect/codes');
    expect(sentAuth).toBe('Bearer skillet_s_session');
    expect(result.code).toBe('ABCD2345');
    expect(result.ttl_sec).toBe(300);
  });

  it('works with a user-bound device token (symmetric join)', async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ code: 'WXYZ2345', expires_at: 1, ttl_sec: 300 }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    const result = await mintPairCode({
      token: 'skillet_d_device',
      registryUrl: 'https://registry.test',
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(result.code).toBe('WXYZ2345');
  });

  it('refuses a non-account token (e.g. kit)', async () => {
    await expect(
      mintPairCode({ token: 'skillet_k_kit', registryUrl: 'https://registry.test' }),
    ).rejects.toThrow(/Not signed in/);
  });

  it('surfaces a registry error message', async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ error: 'user_token_required', message: 'nope' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    await expect(
      mintPairCode({
        token: 'skillet_s_session',
        registryUrl: 'https://registry.test',
        fetchImpl: fetchImpl as typeof fetch,
      }),
    ).rejects.toThrow(/nope/);
  });
});
