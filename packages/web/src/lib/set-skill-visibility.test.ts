import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setSkillVisibility, SkillLifecycleError } from '@/lib/deprecation'

// A registry must be configured for the URL to build (mirrors deprecation.ts's
// hasRegistry gate). jsdom provides window, so the URL is the /api/registry BFF.
describe('setSkillVisibility', () => {
  beforeEach(() => {
    vi.stubEnv('REGISTRY_URL', 'http://127.0.0.1:3481')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ skill_id: 's1', visibility: 'public' }, { status: 200 })),
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('POSTs the visibility endpoint with credentials and the visibility body', async () => {
    const out = await setSkillVisibility('me', 'my-skill', 'public')
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/skills/me/my-skill/visibility'),
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ visibility: 'public' }),
      }),
    )
    expect(out).toEqual({ visibility: 'public' })
  })

  it('targets the visibility path, never the deprecate path', async () => {
    await setSkillVisibility('me', 'my-skill', 'private')
    const url = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(url).toContain('/visibility')
    expect(url).not.toContain('/deprecate')
  })

  it('throws SkillLifecycleError with the server reason on rejection', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: 'owner_only', message: 'Only the owner can do this' }, { status: 403 })),
    )
    await expect(setSkillVisibility('me', 'x', 'public')).rejects.toBeInstanceOf(SkillLifecycleError)
    await expect(setSkillVisibility('me', 'x', 'public')).rejects.toThrow(/Only the owner/)
  })

  it('echoes the value it set when the server returns no body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })))
    const out = await setSkillVisibility('me', 'x', 'private')
    expect(out).toEqual({ visibility: 'private' })
  })
})
