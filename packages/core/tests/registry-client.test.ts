/**
 * Unit tests for the typed registry client.
 *
 * Scope:
 *   - parseSkillRef strict grammar + path-escape rejection
 *   - RegistryClient: URL composition, header forwarding, 304 handling,
 *     bundle normalisation (files vs legacy content), error surfacing.
 *
 * Fetch is injected via opts.fetchImpl so these tests run with no network
 * and no Fastify boot — the contract is "we send the right request and
 * shape the response right." The actual server-side surface is covered
 * separately by packages/registry/test/registry.test.ts.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  parseSkillRef,
  SkillRefError,
  RegistryClient,
  RegistryError,
} from '../src/registry/index.js'
import { canonicalContentHash } from '@skillet/protocol'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    ...init,
  })
}

describe('parseSkillRef', () => {
  it('accepts a canonical ref', () => {
    const r = parseSkillRef('@taylor/festival-ops')
    expect(r).toEqual({
      author: 'taylor',
      slug: 'festival-ops',
      canonical: '@taylor/festival-ops',
    })
  })

  it('rejects missing @', () => {
    expect(() => parseSkillRef('taylor/skill')).toThrowError(SkillRefError)
  })

  it('rejects path traversal in slug', () => {
    expect(() => parseSkillRef('@taylor/../etc')).toThrowError(SkillRefError)
    expect(() => parseSkillRef('@taylor/skill/../x')).toThrowError(SkillRefError)
  })

  it('rejects uppercase', () => {
    expect(() => parseSkillRef('@Taylor/skill')).toThrowError(SkillRefError)
    expect(() => parseSkillRef('@taylor/SKILL')).toThrowError(SkillRefError)
  })

  it('rejects shell metacharacters', () => {
    expect(() => parseSkillRef('@taylor/skill;ls')).toThrowError(SkillRefError)
    expect(() => parseSkillRef('@taylor/skill?x=1')).toThrowError(SkillRefError)
    expect(() => parseSkillRef('@taylor/skill%2e')).toThrowError(SkillRefError)
  })

  it('rejects empty / whitespace / null', () => {
    expect(() => parseSkillRef('')).toThrowError(SkillRefError)
    expect(() => parseSkillRef('@taylor/skill\n')).toThrowError(SkillRefError)
    expect(() => parseSkillRef('@taylor/skill\0x')).toThrowError(SkillRefError)
  })

  it('rejects extra path components', () => {
    expect(() => parseSkillRef('@taylor/skill/extra')).toThrowError(SkillRefError)
  })

  it('error carries a structured code', () => {
    try {
      parseSkillRef('bad')
    } catch (err) {
      expect(err).toBeInstanceOf(SkillRefError)
      expect((err as SkillRefError).code).toBe('invalid_ref')
    }
  })
})

describe('RegistryClient', () => {
  const baseUrl = 'https://registry.example.com'

  function clientWith(fetchImpl: typeof fetch, token?: string): RegistryClient {
    return new RegistryClient({ baseUrl, fetchImpl, token })
  }

  it('targets /api/v1 and forwards Bearer + If-None-Match', async () => {
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe(
        'https://registry.example.com/api/v1/skills/taylor/festival-ops/manifest',
      )
      const headers = init?.headers as Record<string, string>
      expect(headers.authorization).toBe('Bearer abc123')
      expect(headers['if-none-match']).toBe('"sha256:deadbeef"')
      return new Response(null, {
        status: 304,
        headers: { etag: '"sha256:deadbeef"' },
      })
    }) as unknown as typeof fetch
    const client = clientWith(fetchImpl, 'abc123')
    const res = await client.getSkillManifest('@taylor/festival-ops', {
      etag: '"sha256:deadbeef"',
    })
    expect(res.notModified).toBe(true)
    expect(res.value).toBeNull()
    expect(res.etag).toBe('"sha256:deadbeef"')
  })

  it('sends X-Skillet-Client-Version when clientVersion is set', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>)['x-skillet-client-version']).toBe('0.2.0')
      return new Response(null, { status: 304, headers: { etag: '"x"' } })
    }) as unknown as typeof fetch
    const client = new RegistryClient({ baseUrl, fetchImpl, clientVersion: '0.2.0' })
    const res = await client.getSkillManifest('@taylor/festival-ops', { etag: '"x"' })
    expect(res.notModified).toBe(true)
  })

  it('omits X-Skillet-Client-Version when no version is available', async () => {
    const saved = process.env.SKILLET_CLIENT_VERSION
    delete process.env.SKILLET_CLIENT_VERSION
    try {
      const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
        expect(
          (init?.headers as Record<string, string>)['x-skillet-client-version'],
        ).toBeUndefined()
        return new Response(null, { status: 304, headers: { etag: '"x"' } })
      }) as unknown as typeof fetch
      const client = new RegistryClient({ baseUrl, fetchImpl })
      await client.getSkillManifest('@taylor/festival-ops', { etag: '"x"' })
    } finally {
      if (saved !== undefined) process.env.SKILLET_CLIENT_VERSION = saved
    }
  })

  it('sends identity headers: client kind (env-driven) and machine id when derivable', async () => {
    const savedKind = process.env.SKILLET_CLIENT_KIND
    process.env.SKILLET_CLIENT_KIND = 'desktop'
    try {
      const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
        const headers = init?.headers as Record<string, string>
        expect(headers['x-skillet-client-kind']).toBe('desktop')
        // machine id is present iff this host's OS identity is derivable;
        // when present it must be the 64-hex digest, never a raw OS id.
        const machineId = headers['x-skillet-machine-id']
        if (machineId !== undefined) expect(machineId).toMatch(/^[a-f0-9]{64}$/)
        return new Response(null, { status: 304, headers: { etag: '"x"' } })
      }) as unknown as typeof fetch
      const client = new RegistryClient({ baseUrl, fetchImpl })
      await client.getSkillManifest('@taylor/festival-ops', { etag: '"x"' })
      expect(fetchImpl).toHaveBeenCalled()
    } finally {
      if (savedKind !== undefined) process.env.SKILLET_CLIENT_KIND = savedKind
      else delete process.env.SKILLET_CLIENT_KIND
    }
  })

  it('defaults the client kind to cli when the env var is unset or junk', async () => {
    const savedKind = process.env.SKILLET_CLIENT_KIND
    process.env.SKILLET_CLIENT_KIND = 'toaster'
    try {
      const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
        expect((init?.headers as Record<string, string>)['x-skillet-client-kind']).toBe('cli')
        return new Response(null, { status: 304, headers: { etag: '"x"' } })
      }) as unknown as typeof fetch
      const client = new RegistryClient({ baseUrl, fetchImpl })
      await client.getSkillManifest('@taylor/festival-ops', { etag: '"x"' })
    } finally {
      if (savedKind !== undefined) process.env.SKILLET_CLIENT_KIND = savedKind
      else delete process.env.SKILLET_CLIENT_KIND
    }
  })

  it('setUpdateMode PATCHes /me/update-mode and returns mode + applied count', async () => {
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe('https://registry.example.com/api/v1/me/update-mode')
      expect(init?.method).toBe('PATCH')
      expect((init?.headers as Record<string, string>).authorization).toBe('Bearer tok')
      expect(JSON.parse(String(init?.body))).toEqual({ mode: 'auto' })
      return jsonResponse({ mode: 'auto', applied: 3 })
    }) as unknown as typeof fetch
    const client = clientWith(fetchImpl, 'tok')
    const result = await client.setUpdateMode('auto')
    expect(result).toEqual({ mode: 'auto', applied: 3 })
  })

  it('setUpdateMode surfaces a server error', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: 'mode must be "auto" or "manual"' }, { status: 400 }),
    ) as unknown as typeof fetch
    const client = clientWith(fetchImpl, 'tok')
    await expect(client.setUpdateMode('auto')).rejects.toThrowError(RegistryError)
  })

  it('returns parsed manifest on 200 with strong ETag', async () => {
    const body = {
      author: 'taylor',
      slug: 'festival-ops',
      skill_id: 'taylor:festival-ops',
      latest_hash: 'aa'.repeat(32),
      install_count: 0,
      author_key_id: 'bb'.repeat(32),
      author_public_key: 'cAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      versions: [
        {
          hash: 'aa'.repeat(32),
          published_at: 100,
          url: '/api/v1/skills/taylor/festival-ops/versions/...',
          signature: { alg: 'ed25519', key_id: 'bb'.repeat(32), sig: 'sig' },
        },
      ],
    }
    const fetchImpl = vi.fn(async () =>
      jsonResponse(body, { headers: { etag: `"${body.latest_hash}"` } }),
    ) as unknown as typeof fetch
    const client = clientWith(fetchImpl)
    const res = await client.getSkillManifest('@taylor/festival-ops')
    expect(res.notModified).toBe(false)
    expect(res.value?.latest_hash).toBe(body.latest_hash)
    expect(res.value?.author_public_key).toBe(body.author_public_key)
  })

  it('getVersion decodes multi-file bundles into a DecodedBundle', async () => {
    const files = {
      'SKILL.md': { enc: 'utf8' as const, data: '---\nname: T\ndescription: x\n---\nbody' },
      'agents/r.md': { enc: 'utf8' as const, data: 'r' },
    }
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        hash: 'cc'.repeat(32),
        skill_id: 'taylor:festival-ops',
        author: 'taylor',
        slug: 'festival-ops',
        files,
        content_hash: `sha256:${'cc'.repeat(32)}`,
        signature: { alg: 'ed25519', key_id: 'bb'.repeat(32), sig: 'sig' },
        author_key_id: 'bb'.repeat(32),
        author_public_key: 'AAAA',
        metadata: { foo: 1 },
        published_at: 100,
        published_by: 'taylor',
      }),
    ) as unknown as typeof fetch
    const client = clientWith(fetchImpl)
    const v = await client.getVersion('@taylor/festival-ops', 'cc'.repeat(32))
    expect(v.bundle.size).toBe(2)
    expect(v.bundle.has('SKILL.md')).toBe(true)
    expect(v.bundle.has('agents/r.md')).toBe(true)
    // content_hash always normalised to `sha256:<hex>`.
    expect(v.content_hash.startsWith('sha256:')).toBe(true)
  })

  it('getVersion falls back to legacy single-file `content`', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        hash: 'cc'.repeat(32),
        skill_id: 'taylor:festival-ops',
        author: 'taylor',
        slug: 'festival-ops',
        // No `files`, only legacy `content`
        content: '---\nname: T\ndescription: x\n---\nbody',
        content_hash: `sha256:${'cc'.repeat(32)}`,
        signature: { alg: 'ed25519', key_id: 'bb'.repeat(32), sig: 'sig' },
        author_key_id: 'bb'.repeat(32),
        metadata: {},
        published_at: 100,
        published_by: 'taylor',
      }),
    ) as unknown as typeof fetch
    const client = clientWith(fetchImpl)
    const v = await client.getVersion('@taylor/festival-ops', 'cc'.repeat(32))
    expect(v.bundle.size).toBe(1)
    expect(v.bundle.has('SKILL.md')).toBe(true)
  })

  it('rejects malformed hashes before issuing a request', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({})) as unknown as typeof fetch
    const client = clientWith(fetchImpl)
    await expect(client.getVersion('@taylor/festival-ops', 'not-a-hex')).rejects.toBeInstanceOf(
      RegistryError,
    )
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects malformed refs before issuing a request', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({})) as unknown as typeof fetch
    const client = clientWith(fetchImpl)
    await expect(client.getSkillManifest('taylor/skill')).rejects.toBeInstanceOf(SkillRefError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('surfaces server error code from JSON body', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: 'not_found', message: 'no such skill' }, { status: 404 }),
    ) as unknown as typeof fetch
    const client = clientWith(fetchImpl)
    try {
      await client.getSkillManifest('@taylor/festival-ops')
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(RegistryError)
      expect((err as RegistryError).code).toBe('not_found')
      expect((err as RegistryError).status).toBe(404)
    }
  })

  it('getSyncManifest appends ?owner stub for the pre-auth dev path', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      expect(String(url)).toBe('https://registry.example.com/api/v1/sync/manifest?owner=taylor')
      return jsonResponse({ etag: 'sha256:0', sync_interval_seconds: 86400, items: [] })
    }) as unknown as typeof fetch
    const client = clientWith(fetchImpl)
    const res = await client.getSyncManifest({ owner: 'taylor' })
    expect(res.value?.items).toEqual([])
  })

  it('getSyncManifest appends ?device for per-machine kit routing', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      expect(String(url)).toBe(
        'https://registry.example.com/api/v1/sync/manifest?device=dev-abc',
      )
      return jsonResponse({
        etag: 'sha256:0',
        sync_interval_seconds: 86400,
        account_scope: 'user',
        items: [],
      })
    }) as unknown as typeof fetch
    const client = clientWith(fetchImpl)
    const res = await client.getSyncManifest({ device: 'dev-abc' })
    expect(res.value?.account_scope).toBe('user')
  })

  it('getContentBundle verifies recomputed hash matches request', async () => {
    const content = '# hello\n'
    const hash = canonicalContentHash(new Map([['SKILL.md', Buffer.from(content, 'utf8')]]))
    const fetchImpl = vi.fn(async (url: string | URL) => {
      expect(String(url)).toContain('/sync/content/')
      return jsonResponse({
        schema_version: 1,
        content,
        content_hash: hash,
      })
    }) as unknown as typeof fetch
    const client = clientWith(fetchImpl)
    const res = await client.getContentBundle(hash)
    expect(res.contentHash).toBe(hash)
    expect(res.bundle.get('SKILL.md')?.toString()).toBe(content)
  })

  it('getContentBundle throws integrity_failed on hash mismatch', async () => {
    const good = canonicalContentHash(
      new Map([['SKILL.md', Buffer.from('good', 'utf8')]]),
    )
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        schema_version: 1,
        content: 'bad',
        content_hash: good,
      }),
    ) as unknown as typeof fetch
    const client = clientWith(fetchImpl)
    await expect(client.getContentBundle(good)).rejects.toMatchObject({
      code: 'integrity_failed',
    })
  })
})

describe('RegistryClient account decisions', () => {
  const baseUrl = 'https://registry.example.com'

  it('getMyDecisions forwards Bearer and parses the feed', async () => {
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe('https://registry.example.com/api/v1/me/decisions')
      expect((init?.headers as Record<string, string>).authorization).toBe('Bearer t0')
      return jsonResponse({
        update_mode: 'manual',
        decisions: [
          {
            skill_id: 'a:b',
            version_hash: 'sha256:aa',
            state: 'approved',
            source: 'web',
            decided_at: 1,
          },
        ],
      })
    })
    const client = new RegistryClient({ baseUrl, fetchImpl, token: 't0' })
    const out = await client.getMyDecisions()
    expect(out.update_mode).toBe('manual')
    expect(out.decisions[0].state).toBe('approved')
  })

  it('postApproval / postRejection POST the canonical body', async () => {
    const calls: Array<{ url: string; body: unknown }> = []
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) })
      return jsonResponse({ ok: true })
    })
    const client = new RegistryClient({ baseUrl, fetchImpl, token: 't0' })
    await client.postApproval('a:b', 'sha256:aa')
    await client.postRejection('a:b', 'sha256:aa')
    expect(calls[0].url).toBe('https://registry.example.com/api/v1/approvals')
    expect(calls[0].body).toEqual({ skill_id: 'a:b', version_hash: 'sha256:aa' })
    expect(calls[1].url).toBe('https://registry.example.com/api/v1/rejections')
  })

  it('getMyDecisions surfaces a non-200 as an error', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'auth_required' }, { status: 401 }))
    const client = new RegistryClient({ baseUrl, fetchImpl })
    await expect(client.getMyDecisions()).rejects.toBeInstanceOf(RegistryError)
  })
})
