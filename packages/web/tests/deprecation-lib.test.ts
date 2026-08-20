import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deprecateSkill, undeprecateSkill, SkillLifecycleError } from '@/lib/deprecation'

// hasRegistry() reads process.env at call time, so toggling REGISTRY_URL here
// flips the lib between "no registry configured" and "talk to the BFF proxy".
const ORIGINAL_REGISTRY_URL = process.env.REGISTRY_URL

beforeEach(() => {
  process.env.REGISTRY_URL = 'http://127.0.0.1:3481'
})

afterEach(() => {
  if (ORIGINAL_REGISTRY_URL === undefined) delete process.env.REGISTRY_URL
  else process.env.REGISTRY_URL = ORIGINAL_REGISTRY_URL
  vi.restoreAllMocks()
})

function mockResponse(init: { ok: boolean; status: number; body?: unknown }): Response {
  return {
    ok: init.ok,
    status: init.status,
    json: async () => {
      if (init.body === undefined) throw new Error('no body')
      return init.body
    },
  } as unknown as Response
}

describe('deprecateSkill', () => {
  it('POSTs to the BFF proxy with the trimmed message and credentials', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(mockResponse({ ok: true, status: 200, body: { deprecated: true } }))

    const res = await deprecateSkill('taylor', 'deploy-ritual', { message: '  bye  ' })

    expect(res.deprecated).toBe(true)
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/registry/api/v1/skills/taylor/deploy-ritual/deprecate')
    expect((opts as RequestInit).method).toBe('POST')
    expect((opts as RequestInit).credentials).toBe('include')
    expect(JSON.parse((opts as RequestInit).body as string)).toEqual({ message: 'bye' })
  })

  it('omits an empty message from the body', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(mockResponse({ ok: true, status: 200, body: { deprecated: true } }))
    await deprecateSkill('taylor', 'deploy-ritual', { message: '   ' })
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({})
  })

  it('maps a 403 with a server message to SkillLifecycleError', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse({
        ok: false,
        status: 403,
        body: { error: 'owner_only', message: 'Not your skill.' },
      }),
    )
    await expect(deprecateSkill('taylor', 'deploy-ritual')).rejects.toMatchObject({
      name: 'SkillLifecycleError',
      code: 'owner_only',
      status: 403,
      message: 'Not your skill.',
    })
  })

  it('falls back to a permission message on a bare 403', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse({ ok: false, status: 403 }))
    await expect(deprecateSkill('taylor', 'deploy-ritual')).rejects.toThrow(/don’t have permission/)
  })

  it('maps a network failure to a network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('boom'))
    await expect(deprecateSkill('taylor', 'deploy-ritual')).rejects.toMatchObject({
      code: 'network',
    })
  })

  it('reports no_registry when nothing is configured', async () => {
    delete process.env.REGISTRY_URL
    await expect(deprecateSkill('taylor', 'deploy-ritual')).rejects.toMatchObject({
      code: 'no_registry',
    })
  })
})

describe('undeprecateSkill', () => {
  it('POSTs to the undeprecate path and infers restored state from a bare 200', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(mockResponse({ ok: true, status: 200 }))
    const res = await undeprecateSkill('taylor', 'deploy-ritual')
    expect(res.deprecated).toBe(false)
    expect(fetchMock.mock.calls[0][0]).toBe(
      '/api/registry/api/v1/skills/taylor/deploy-ritual/undeprecate',
    )
  })
})

describe('SkillLifecycleError', () => {
  it('carries code and status', () => {
    const err = new SkillLifecycleError('nope', 'owner_only', 403)
    expect(err.code).toBe('owner_only')
    expect(err.status).toBe(403)
    expect(err.name).toBe('SkillLifecycleError')
  })
})
