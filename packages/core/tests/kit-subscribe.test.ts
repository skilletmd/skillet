import { describe, it, expect, vi } from 'vitest';
import {
  parseKitHandle,
  KitHandleError,
  RegistryClient,
} from '../src/registry/index.js';
import { subscribeKitByHandle } from '../src/commands/kit-subscribe.js';

describe('parseKitHandle', () => {
  it('accepts @owner/slug', () => {
    expect(parseKitHandle('@alice/essentials')).toEqual({
      owner: 'alice',
      slug: 'essentials',
      canonical: '@alice/essentials',
    });
  });

  it('accepts owner/slug without @', () => {
    expect(parseKitHandle('bob/starter')).toEqual({
      owner: 'bob',
      slug: 'starter',
      canonical: '@bob/starter',
    });
  });

  it('rejects malformed handles', () => {
    expect(() => parseKitHandle('')).toThrow(KitHandleError);
    expect(() => parseKitHandle('alice')).toThrow(KitHandleError);
    expect(() => parseKitHandle('@Alice/kit')).toThrow(KitHandleError);
  });
});

describe('RegistryClient.subscribeKit', () => {
  const baseUrl = 'https://registry.example.com';

  it('POSTs to /kits/:id/subscribe', async () => {
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe(
        'https://registry.example.com/api/v1/kits/kit-123/subscribe',
      );
      expect(init?.method).toBe('POST');
      const headers = init?.headers as Record<string, string>;
      expect(headers.authorization).toBe('Bearer sess');
      return new Response(JSON.stringify({ subscribed: true, kit_id: 'kit-123' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    const client = new RegistryClient({ baseUrl, token: 'sess', fetchImpl });
    const out = await client.subscribeKit('kit-123');
    expect(out).toEqual({ subscribed: true, kit_id: 'kit-123' });
  });
});

describe('subscribeKitByHandle', () => {
  it('resolves handle then subscribes', async () => {
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const path = String(url);
      const method = init?.method ?? 'GET';
      if (path.endsWith('/kits/by-handle/alice/essentials') && method === 'GET') {
        return new Response(
          JSON.stringify({
            id: 'k1',
            owner: 'alice',
            name: 'Essentials',
            slug: 'essentials',
            description: null,
            visibility: 'public',
            subscribed: false,
            skills: [{ skill_id: 'alice:a' }, { skill_id: 'alice:b' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (path.endsWith('/kits/k1/subscribe')) {
        return new Response(JSON.stringify({ subscribed: true, kit_id: 'k1' }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected fetch ${path}`);
    }) as unknown as typeof fetch;

    const result = await subscribeKitByHandle('@alice/essentials', {
      registryUrl: 'https://registry.example.com',
      token: 'sess',
      fetchImpl,
    });
    expect(result.kitName).toBe('Essentials');
    expect(result.skillCount).toBe(2);
    expect(result.skillRefs).toEqual(['@alice/a', '@alice/b']);
    expect(result.alreadySubscribed).toBe(false);
  });

  it('skips POST when already subscribed', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const path = String(url);
      if (path.includes('/subscribe')) {
        throw new Error('should not subscribe');
      }
      return new Response(
        JSON.stringify({
          id: 'k1',
          owner: 'alice',
          name: 'Essentials',
          slug: 'essentials',
          description: null,
          visibility: 'public',
          subscribed: true,
          skills: [],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const result = await subscribeKitByHandle('alice/essentials', {
      registryUrl: 'https://registry.example.com',
      token: 'sess',
      fetchImpl,
    });
    expect(result.alreadySubscribed).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
