import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  setUpdateMode,
  getMyUpdates,
  getSkillDiff,
  approveUpdate,
  approveAll,
  rejectUpdate,
} from '@/lib/account-updates'

function mockFetch(body: unknown, ok = true, status = 200) {
  const fn = vi.fn(async () => ({
    ok,
    status,
    json: async () => body,
  })) as unknown as typeof fetch
  vi.stubGlobal('fetch', fn)
  return fn as unknown as ReturnType<typeof vi.fn>
}

afterEach(() => vi.unstubAllGlobals())

describe('account-updates client', () => {
  it('setUpdateMode PATCHes the proxy path with the mode and returns the applied count', async () => {
    const f = mockFetch({ mode: 'manual', applied: 0 })
    expect(await setUpdateMode('manual')).toBe(0)
    const [url, init] = f.mock.calls[0]
    expect(String(url)).toBe('/api/registry/api/v1/me/update-mode')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body)).toEqual({ mode: 'manual' })
  })

  it('getMyUpdates returns the partitioned shape', async () => {
    mockFetch({ update_mode: 'manual', pending: [{ skill_id: 'a:b' }], recently_applied: [] })
    const out = await getMyUpdates()
    expect(out.pending).toHaveLength(1)
  })

  it('passes an abort timeout signal to fetch so a hung request cannot wedge the UI', async () => {
    const f = mockFetch({ mode: 'manual', applied: 0 })
    await setUpdateMode('manual')
    const init = f.mock.calls[0][1]
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('the bulk + per-item write wrappers also carry the timeout signal', async () => {
    const a = mockFetch({ approved: 0 })
    await approveAll()
    expect(a.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
    const u = mockFetch({ ok: true })
    await approveUpdate('a:b', 'sha256:aa')
    expect(u.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
  })

  it('rejects when the underlying fetch aborts/rejects', async () => {
    const fn = vi.fn(async () => {
      throw new Error('aborted')
    }) as unknown as typeof fetch
    vi.stubGlobal('fetch', fn)
    await expect(getMyUpdates()).rejects.toThrow()
  })

  it('approveUpdate / rejectUpdate POST the canonical body', async () => {
    const f = mockFetch({ ok: true })
    await approveUpdate('a:b', 'sha256:aa')
    expect(String(f.mock.calls[0][0])).toBe('/api/registry/api/v1/approvals')
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({
      skill_id: 'a:b',
      version_hash: 'sha256:aa',
    })
    await rejectUpdate('a:b', 'sha256:aa')
    expect(String(f.mock.calls[1][0])).toBe('/api/registry/api/v1/rejections')
  })

  it('approveAll returns the count', async () => {
    mockFetch({ approved: 3 })
    expect(await approveAll()).toBe(3)
  })

  it('getSkillDiff hits the skill diff route with hashes', async () => {
    const f = mockFetch({ from: 'sha256:a', to: 'sha256:b', files: [] })
    await getSkillDiff('alice/tool', 'sha256:b', 'sha256:a')
    expect(String(f.mock.calls[0][0])).toContain('/api/registry/api/v1/skills/alice/tool/diff?')
    expect(String(f.mock.calls[0][0])).toContain('to=sha256%3Ab')
  })

  it('throws on a non-ok response', async () => {
    mockFetch({ error: 'x' }, false, 401)
    await expect(setUpdateMode('auto')).rejects.toThrow()
  })
})
