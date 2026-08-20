import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('idb-store error cleanup', () => {
  const close = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    close.mockReset()

    vi.stubGlobal('indexedDB', {
      open: () => {
        const openReq = {
          result: {
            close,
            objectStoreNames: { contains: () => true },
            transaction: () => {
              const tx = {
                oncomplete: null as (() => void) | null,
                onerror: null as (() => void) | null,
                onabort: null as (() => void) | null,
                objectStore: () => ({
                  get: () => {
                    const getReq = {
                      result: undefined,
                      error: new Error('request failed'),
                      onsuccess: null as (() => void) | null,
                      onerror: null as (() => void) | null,
                    }
                    queueMicrotask(() => getReq.onerror?.())
                    return getReq
                  },
                }),
              }
              return tx
            },
          },
          onsuccess: null as (() => void) | null,
          onupgradeneeded: null as (() => void) | null,
          onerror: null as (() => void) | null,
        }
        queueMicrotask(() => openReq.onsuccess?.())
        return openReq
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('closes the database when a request fails', async () => {
    const { idbGet } = await import('./idb-store')
    await expect(idbGet('device-key')).rejects.toThrow('request failed')
    expect(close).toHaveBeenCalledTimes(1)
  })
})
