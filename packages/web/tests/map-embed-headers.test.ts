import { describe, expect, it } from 'vitest'
import { buildSecurityHeaders, type CspMode, type SecurityHeader } from '@/lib/security-headers'

// /map/embed is the one page another origin may frame: the page `skillet map`
// serves on the person's computer. Production enforces the site CSP, and a
// second header can't loosen an enforced one (browsers apply every enforced
// policy), so the embed gets its own variant of the one site policy. The
// framing rule and the two privacy rules hold in every WEB_CSP_MODE.

const EMBED = '/map/embed'
const MODES: CspMode[] = ['enforce', 'report-only', 'off']
const LOOPBACK_ANCESTORS = 'frame-ancestors http://127.0.0.1:* http://localhost:*'

const named = (headers: SecurityHeader[], key: string) => headers.filter((h) => h.key === key)
const enforced = (headers: SecurityHeader[]) => named(headers, 'Content-Security-Policy')
const directives = (policy: string) => policy.split(';').map((d) => d.trim()).filter(Boolean)

describe('security headers on /map/embed', () => {
  for (const mode of MODES) {
    for (const isDev of [false, true]) {
      it(`${mode}${isDev ? ' (dev)' : ''}: an enforced policy frames from loopback only, blocks every connection and every image that isn't inline`, () => {
        const headers = buildSecurityHeaders({ mode, isDev, pathname: EMBED })
        const policies = enforced(headers)
        expect(policies).toHaveLength(1)
        const rules = directives(policies[0]!.value)
        expect(rules).toContain(LOOPBACK_ANCESTORS)
        expect(rules).not.toContain("frame-ancestors 'none'")
        // Dev keeps the HMR websocket and nothing else.
        expect(rules).toContain(isDev ? 'connect-src ws: wss:' : "connect-src 'none'")
        expect(rules).toContain('img-src data: blob:')
        expect(rules.filter((r) => r.startsWith('frame-ancestors'))).toHaveLength(1)
        expect(rules.filter((r) => r.startsWith('connect-src'))).toHaveLength(1)
        expect(rules.filter((r) => r.startsWith('img-src'))).toHaveLength(1)
      })

      it(`${mode}${isDev ? ' (dev)' : ''}: no X-Frame-Options, companions kept`, () => {
        const headers = buildSecurityHeaders({ mode, isDev, pathname: EMBED })
        expect(named(headers, 'X-Frame-Options')).toEqual([])
        expect(named(headers, 'X-Content-Type-Options')).toEqual([{ key: 'X-Content-Type-Options', value: 'nosniff' }])
        expect(named(headers, 'Referrer-Policy')).toHaveLength(1)
      })
    }
  }

  it('enforce: the embed policy is the one site policy with the three rules swapped, everything else intact', () => {
    const site = directives(enforced(buildSecurityHeaders({ mode: 'enforce', isDev: false }))[0]!.value)
    const embed = directives(enforced(buildSecurityHeaders({ mode: 'enforce', isDev: false, pathname: EMBED }))[0]!.value)
    const swapped = (r: string) => r.startsWith('frame-ancestors') || r.startsWith('connect-src') || r.startsWith('img-src')
    expect(embed.filter((r) => !swapped(r))).toEqual(site.filter((r) => !swapped(r)))
    expect(embed).toContain("default-src 'self'")
    expect(embed).toContain("object-src 'none'")
    expect(embed).toContain("frame-src 'none'")
    expect(embed).toContain('upgrade-insecure-requests')
    expect(named(buildSecurityHeaders({ mode: 'enforce', isDev: false, pathname: EMBED }), 'Content-Security-Policy-Report-Only')).toEqual([])
  })

  it('report-only: the embed variant reports, and the three rules are enforced on their own', () => {
    const headers = buildSecurityHeaders({ mode: 'report-only', isDev: false, pathname: EMBED })
    const reported = named(headers, 'Content-Security-Policy-Report-Only')
    expect(reported).toHaveLength(1)
    expect(directives(reported[0]!.value)).toContain(LOOPBACK_ANCESTORS)
    expect(directives(reported[0]!.value)).toContain("script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com")
    expect(directives(enforced(headers)[0]!.value)).toEqual([LOOPBACK_ANCESTORS, "connect-src 'none'", 'img-src data: blob:'])
  })

  it('off: only the three rules, enforced', () => {
    const headers = buildSecurityHeaders({ mode: 'off', isDev: false, pathname: EMBED })
    expect(named(headers, 'Content-Security-Policy-Report-Only')).toEqual([])
    expect(directives(enforced(headers)[0]!.value)).toEqual([LOOPBACK_ANCESTORS, "connect-src 'none'", 'img-src data: blob:'])
  })
})

describe('security headers everywhere else', () => {
  it("/ still sends frame-ancestors 'none' and DENY", () => {
    for (const mode of ['enforce', 'report-only'] as const) {
      const headers = buildSecurityHeaders({ mode, isDev: false, pathname: '/' })
      const policy = headers.find((h) => h.key.startsWith('Content-Security-Policy'))!
      expect(directives(policy.value)).toContain("frame-ancestors 'none'")
      expect(named(headers, 'X-Frame-Options')).toEqual([{ key: 'X-Frame-Options', value: 'DENY' }])
    }
    expect(named(buildSecurityHeaders({ mode: 'off', isDev: false, pathname: '/' }), 'X-Frame-Options')).toEqual([
      { key: 'X-Frame-Options', value: 'DENY' },
    ])
  })

  it('every other route, /map/save and paths under the embed included, keeps exactly today’s headers', () => {
    for (const mode of MODES) {
      for (const isDev of [false, true]) {
        const today = buildSecurityHeaders({ mode, isDev })
        for (const pathname of ['/', '/packs/kit', '/map', '/map/save', '/map/embed/x', '/map/embedded', '/Map/Embed']) {
          expect(buildSecurityHeaders({ mode, isDev, pathname }), `${mode} ${pathname}`).toEqual(today)
        }
      }
    }
  })
})
