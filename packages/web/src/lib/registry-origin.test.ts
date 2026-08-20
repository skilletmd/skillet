import { afterEach, describe, expect, it, vi } from 'vitest'

describe('registry-origin', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('prefers REGISTRY_URL over NEXT_PUBLIC_REGISTRY_URL for fetches', async () => {
    vi.stubEnv('REGISTRY_URL', 'http://127.0.0.1:3481')
    vi.stubEnv('NEXT_PUBLIC_REGISTRY_URL', 'https://registry.skillet.md')
    const { registryFetchOrigin } = await import('./registry-origin')
    expect(registryFetchOrigin()).toBe('http://127.0.0.1:3481')
  })

  it('uses NEXT_PUBLIC_REGISTRY_PUBLIC_URL for printed public origin', async () => {
    vi.stubEnv('REGISTRY_URL', 'http://127.0.0.1:3481')
    vi.stubEnv('NEXT_PUBLIC_REGISTRY_PUBLIC_URL', 'https://registry.skillet.md')
    vi.stubEnv('NEXT_PUBLIC_REGISTRY_URL', 'https://wrong.example')
    const { registryPublicOrigin } = await import('./registry-origin')
    expect(registryPublicOrigin()).toBe('https://registry.skillet.md')
  })

  it('falls back to NEXT_PUBLIC_REGISTRY_URL for public origin when PUBLIC unset', async () => {
    vi.stubEnv('NEXT_PUBLIC_REGISTRY_URL', 'https://registry.skillet.md')
    const { registryPublicOrigin } = await import('./registry-origin')
    expect(registryPublicOrigin()).toBe('https://registry.skillet.md')
  })
})
