import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { deleteBearerDevice } from '@/lib/disconnect-device'

describe('deleteBearerDevice', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 })),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('calls DELETE with credentials', async () => {
    await deleteBearerDevice('dev-123')
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/devices/dev-123'),
      expect.objectContaining({ method: 'DELETE', credentials: 'include' }),
    )
  })

  it('throws when the server rejects the request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ error: 'device_not_found' }, { status: 404 }),
      ),
    )
    await expect(deleteBearerDevice('missing')).rejects.toThrow(/device_not_found/)
  })
})
