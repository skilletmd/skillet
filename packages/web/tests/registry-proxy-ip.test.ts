import { describe, it, expect } from 'vitest'
import { forwardedClientIp } from '@/app/api/registry/[...path]/route'

// cf-connecting-ip is forgeable unless the deployment is behind Cloudflare, so
// forwarding is gated behind an explicit trust flag.
describe('forwardedClientIp', () => {
  it('forwards nothing when trust is off, even with a cf-connecting-ip', () => {
    expect(forwardedClientIp('1.2.3.4', false)).toBeNull()
  })

  it('forwards the cf-connecting-ip when trust is on', () => {
    expect(forwardedClientIp('1.2.3.4', true)).toBe('1.2.3.4')
  })

  it('forwards nothing when there is no cf-connecting-ip', () => {
    expect(forwardedClientIp(null, true)).toBeNull()
  })
})
