import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProposalSignature } from '@/lib/create-proposal'
import type { BundleFiles } from '@/lib/skill-bundle'

const SIG: ProposalSignature = { alg: 'ed25519', key_id: 'a'.repeat(64), sig: 'c2ln' }
const FILES: BundleFiles = { 'SKILL.md': { enc: 'utf8', data: '# Deploy\n' } }

/** Build a Response-like object good enough for the client's narrow usage. */
function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as unknown as Response
}

/** Reset env between cases and re-import so REGISTRY_BASE_URL is re-read. */
async function load(registry = 'https://registry.test') {
  vi.stubEnv('NEXT_PUBLIC_REGISTRY_URL', registry)
  vi.resetModules()
  return import('@/lib/create-proposal')
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('createSkillProposal — happy path', () => {
  it('POSTs files + base_hash + signature through the BFF and returns the created proposal', async () => {
    const { createSkillProposal } = await load()
    const created = {
      proposal_id: 'p1',
      skill_id: 'taylor:deploy-ritual',
      proposed_hash: 'sha256:abc',
      state: 'pending',
      proposal_url: '/api/v1/skills/taylor/deploy-ritual/proposals/p1',
      scan: { status: 'pending' },
    }
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(201, created))
    vi.stubGlobal('fetch', fetchSpy)

    const result = await createSkillProposal('taylor', 'deploy-ritual', {
      files: FILES,
      baseHash: 'sha256:base',
      signature: SIG,
    })

    expect(result).toEqual(created)
    // Browser path (jsdom has window) → BFF proxy, cookie attached via credentials.
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('/api/registry/api/v1/skills/taylor/deploy-ritual/proposals')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    expect(JSON.parse(init.body)).toEqual({
      files: FILES,
      base_hash: 'sha256:base',
      signature: SIG,
    })
  })
})

describe('createSkillProposal — error mapping', () => {
  async function expectError(
    status: number,
    body: unknown,
    assertions: (err: import('@/lib/create-proposal').ProposalSubmitError) => void,
  ) {
    const { createSkillProposal, ProposalSubmitError } = await load()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(status, body)))
    try {
      await createSkillProposal('taylor', 'deploy-ritual', {
        files: FILES,
        baseHash: 'sha256:base',
        signature: SIG,
      })
      throw new Error('expected createSkillProposal to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(ProposalSubmitError)
      assertions(err as InstanceType<typeof ProposalSubmitError>)
    }
  }

  it('maps not_authorized → 403 / isUnauthorized with server copy', async () => {
    await expectError(
      403,
      { error: 'not_authorized', message: 'Only the owner may propose.' },
      (err) => {
        expect(err.code).toBe('not_authorized')
        expect(err.status).toBe(403)
        expect(err.isUnauthorized).toBe(true)
        expect(err.message).toBe('Only the owner may propose.')
      },
    )
  })

  it('treats any 403 as unauthorized even without a code', async () => {
    await expectError(403, {}, (err) => {
      expect(err.isUnauthorized).toBe(true)
    })
  })

  it('maps base_stale → isStaleBase with a rebase prompt', async () => {
    await expectError(409, { error: 'base_stale' }, (err) => {
      expect(err.code).toBe('base_stale')
      expect(err.isStaleBase).toBe(true)
      expect(err.message).toMatch(/rebase/i)
    })
  })

  it('maps scan_blocked → carries the inline finding', async () => {
    const finding = {
      category: 'credential',
      confidence: 'high',
      file: 'SKILL.md',
      lineStart: 3,
      lineEnd: 3,
      why: 'looks like an API key',
    }
    await expectError(422, { error: 'scan_blocked', finding }, (err) => {
      expect(err.code).toBe('scan_blocked')
      expect(err.finding).toEqual(finding)
      expect(err.message).toMatch(/credential/i)
    })
  })

  it('maps signature codes → isSignatureProblem', async () => {
    await expectError(422, { error: 'key_id_mismatch', message: 'wrong key' }, (err) => {
      expect(err.isSignatureProblem).toBe(true)
      expect(err.message).toBe('wrong key')
    })
  })

  it('maps author_not_claimed → isSignatureProblem with claim-key copy', async () => {
    await expectError(422, { error: 'author_not_claimed' }, (err) => {
      expect(err.isSignatureProblem).toBe(true)
      expect(err.message).toMatch(/signing key/i)
    })
  })

  it('surfaces BundleError codes verbatim (unsafe_path)', async () => {
    await expectError(422, { error: 'unsafe_path', message: 'Bundle missing SKILL.md' }, (err) => {
      expect(err.code).toBe('unsafe_path')
      expect(err.message).toBe('Bundle missing SKILL.md')
    })
  })

  it('maps handle_not_claimed with default copy when server omits a message', async () => {
    await expectError(403, { error: 'handle_not_claimed' }, (err) => {
      expect(err.code).toBe('handle_not_claimed')
      expect(err.message).toMatch(/claim/i)
    })
  })

  it('falls back to a status message for an unknown code', async () => {
    await expectError(500, { error: 'mystery' }, (err) => {
      expect(err.message).toMatch(/500/)
    })
  })

  it('survives a non-JSON error body', async () => {
    const { createSkillProposal, ProposalSubmitError } = await load()
    const res = {
      status: 502,
      ok: false,
      json: async () => {
        throw new Error('not json')
      },
    } as unknown as Response
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res))
    await expect(
      createSkillProposal('taylor', 'deploy-ritual', {
        files: FILES,
        baseHash: null,
        signature: SIG,
      }),
    ).rejects.toBeInstanceOf(ProposalSubmitError)
  })

  it('maps a network failure to a reachable-service error', async () => {
    const { createSkillProposal } = await load()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    await expect(
      createSkillProposal('taylor', 'deploy-ritual', {
        files: FILES,
        baseHash: null,
        signature: SIG,
      }),
    ).rejects.toMatchObject({ code: 'network' })
  })

  it('refuses to submit when no registry is configured', async () => {
    const { createSkillProposal } = await load('')
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    await expect(
      createSkillProposal('taylor', 'deploy-ritual', {
        files: FILES,
        baseHash: null,
        signature: SIG,
      }),
    ).rejects.toMatchObject({ code: 'no_registry' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('fetchSkillVersionBundle — base load', () => {
  it('returns the bundle + hash on 200', async () => {
    const { fetchSkillVersionBundle } = await load()
    const files: BundleFiles = { 'SKILL.md': { enc: 'utf8', data: '# v1\n' } }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(200, { hash: 'sha256:v1', files })),
    )

    const result = await fetchSkillVersionBundle('taylor', 'deploy-ritual', 'sha256:v1')
    expect(result).toEqual({ kind: 'ok', version: { hash: 'sha256:v1', files } })
  })

  it('reports notfound on 404', async () => {
    const { fetchSkillVersionBundle } = await load()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(404, { error: 'Version not found' })),
    )
    expect(await fetchSkillVersionBundle('taylor', 'deploy-ritual', 'x')).toEqual({
      kind: 'notfound',
    })
  })

  it('reports unavailable when no registry is configured (never fabricates)', async () => {
    const { fetchSkillVersionBundle } = await load('')
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    expect(await fetchSkillVersionBundle('taylor', 'deploy-ritual', 'x')).toEqual({
      kind: 'unavailable',
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('checkProposeAccess', () => {
  it('returns allowed on 200', async () => {
    const { checkProposeAccess } = await load()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { proposals: [] })))
    expect(await checkProposeAccess('taylor', 'deploy-ritual')).toEqual({ kind: 'allowed' })
  })

  it('returns denied on 403', async () => {
    const { checkProposeAccess } = await load()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(403, { error: 'not_authorized' })),
    )
    expect(await checkProposeAccess('taylor', 'deploy-ritual')).toEqual({ kind: 'denied' })
  })
})
