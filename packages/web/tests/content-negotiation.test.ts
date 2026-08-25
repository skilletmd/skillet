import { describe, expect, it } from 'vitest'
import {
  isSingleRepresentationPath,
  appendVaryAccept,
  fullRequested,
  isNotAcceptable,
  markdownAlternateLink,
  preferredType,
  wantsMarkdown,
} from '@/lib/content-negotiation'
import { hasMarkdownVariant } from '@/lib/agent-routes'

// The four conformance checks acceptmarkdown.com runs against an origin:
// serves Markdown for `Accept: text/markdown`, sets `Vary: Accept`, returns
// 406 when nothing is acceptable, and honors q-values.
describe('preferredType', () => {
  it('defaults to HTML when the client states no preference', () => {
    expect(preferredType(null)).toBe('text/html')
    expect(preferredType('')).toBe('text/html')
    expect(preferredType('   ')).toBe('text/html')
    expect(preferredType('*/*')).toBe('text/html')
  })

  it('serves HTML to a browser', () => {
    expect(
      preferredType(
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      ),
    ).toBe('text/html')
  })

  it('serves Markdown when the client asks for it', () => {
    expect(preferredType('text/markdown')).toBe('text/markdown')
    expect(wantsMarkdown('text/markdown')).toBe(true)
    expect(wantsMarkdown('text/markdown, text/html;q=0.5')).toBe(true)
  })

  it('ranks by q-value, not by order', () => {
    expect(preferredType('text/markdown;q=0.2, text/html;q=0.9')).toBe('text/html')
    expect(preferredType('text/html;q=0.2, text/markdown;q=0.9')).toBe('text/markdown')
  })

  it('breaks a q tie on the order the client listed', () => {
    expect(preferredType('text/markdown, text/html')).toBe('text/markdown')
    expect(preferredType('text/html, text/markdown')).toBe('text/html')
  })

  // RFC 9110 §12.5.1: the most specific matching range decides, so a wildcard
  // cannot resurrect a type the client explicitly refused.
  it('honors q=0 as a refusal even against a wildcard', () => {
    expect(preferredType('text/html;q=0, */*')).toBe('text/markdown')
    expect(preferredType('text/markdown;q=0, */*')).toBe('text/html')
    expect(preferredType('text/html;q=0, text/markdown;q=0')).toBeNull()
  })

  it('matches a subtype wildcard', () => {
    expect(preferredType('text/*')).toBe('text/html')
    expect(preferredType('text/*;q=0.4, text/markdown;q=0.9')).toBe('text/markdown')
  })

  it('reports 406 only when the client can take nothing we produce', () => {
    expect(isNotAcceptable('application/pdf')).toBe(true)
    expect(isNotAcceptable('image/png, image/webp')).toBe(true)
    expect(isNotAcceptable('text/html;q=0, text/markdown;q=0')).toBe(true)
    // An absent Accept is "no preference", never a failure.
    expect(isNotAcceptable(null)).toBe(false)
    expect(isNotAcceptable('*/*')).toBe(false)
  })

  it('ignores unparseable parameters rather than throwing', () => {
    expect(preferredType('text/markdown;q=banana')).toBe('text/markdown')
    expect(preferredType(',,,')).toBe('text/html')
    expect(preferredType('text/markdown;q=9')).toBe('text/markdown')
  })
})

describe('appendVaryAccept', () => {
  it('sets Accept when nothing is there', () => {
    const h = new Headers()
    appendVaryAccept(h)
    expect(h.get('Vary')).toBe('Accept')
  })

  // Next writes its own RSC routing tokens onto Vary. Clobbering them breaks
  // client navigation caching, so this has to append.
  it('appends without disturbing existing tokens', () => {
    const h = new Headers({ Vary: 'rsc, next-router-state-tree, Accept-Encoding' })
    appendVaryAccept(h)
    expect(h.get('Vary')).toBe('rsc, next-router-state-tree, Accept-Encoding, Accept')
  })

  it('is idempotent, case-insensitively', () => {
    const h = new Headers({ Vary: 'accept, Accept-Encoding' })
    appendVaryAccept(h)
    expect(h.get('Vary')).toBe('accept, Accept-Encoding')
  })

  it('leaves Vary: * alone', () => {
    const h = new Headers({ Vary: '*' })
    appendVaryAccept(h)
    expect(h.get('Vary')).toBe('*')
  })
})

// `Vary: Accept` is a message to caches. This is the message to clients: the
// twin exists, at this URL, in this media type. Without it an agent had to
// already know the convention to find the JavaScript-free representation.
describe('markdownAlternateLink', () => {
  it('is a well-formed RFC 8288 link to the same URL', () => {
    expect(markdownAlternateLink('https://skillet.md/docs/api')).toBe(
      '<https://skillet.md/docs/api>; rel="alternate"; type="text/markdown"',
    )
  })

  it('is only ever emitted for a URL that actually has a twin', () => {
    // proxy.ts gates on this pair; a link advertised on a path with no Markdown
    // representation would be a link to the HTML page, which is a lie.
    expect(hasMarkdownVariant('/')).toBe(true)
    expect(hasMarkdownVariant('/docs/api')).toBe(true)
    expect(hasMarkdownVariant('/openapi.json')).toBe(false)
    expect(hasMarkdownVariant('/settings')).toBe(false)
  })
})

// Lenient on the value, strict on the default: an agent that writes `?full=true`
// meant `?full=1`, but the flag stays opt-in so the default response keeps a
// predictable size.
describe('fullRequested', () => {
  // Three states, not two. "Did not ask" hands the decision to the surface,
  // which sizes the response to the resource; "asked for the small form" does
  // not. Collapsing them would make every default response a link-only one.
  it('reports absence as undefined, never as false', () => {
    expect(fullRequested(null)).toBeUndefined()
    expect(fullRequested(undefined)).toBeUndefined()
  })

  it('accepts the spellings an agent is likely to write', () => {
    for (const value of ['1', '', 'true', 'TRUE', 'yes', 'on']) {
      expect(fullRequested(value), value).toBe(true)
    }
  })

  it('honors an explicit negative', () => {
    for (const value of ['0', 'false', 'no', ' FALSE ']) {
      expect(fullRequested(value), value).toBe(false)
    }
  })
})


describe('isSingleRepresentationPath', () => {
  // The regression this exists for: tauri-plugin-updater fetches its manifest
  // with `Accept: application/json`. PRODUCES lists only text/html and
  // text/markdown, so isNotAcceptable(accept) was true and the proxy returned
  // 406 before the route ran. Every installed desktop app got a 406 on every
  // check, the client swallowed it, and auto-update never worked for anyone.
  it('exempts the desktop updater manifest', () => {
    expect(isSingleRepresentationPath('/desktop/latest.json')).toBe(true)
  })

  it('exempts installer redirects and the machine-readable statics', () => {
    for (const p of [
      '/download',
      '/download/mac',
      '/download/windows',
      '/desktop',
      '/llms.txt',
      '/sitemap.xml',
      '/robots.txt',
      '/favicon.ico',
      '/site.webmanifest',
    ]) {
      expect(isSingleRepresentationPath(p), p).toBe(true)
    }
  })

  it('leaves real document routes negotiating', () => {
    for (const p of ['/', '/docs', '/docs/install', '/@taylor', '/@taylor/some-skill', '/updates']) {
      expect(isSingleRepresentationPath(p), p).toBe(false)
    }
  })

  it('never claims a .md path — that IS a negotiated representation', () => {
    expect(isSingleRepresentationPath('/docs/install.md')).toBe(false)
  })

  it('does not swallow a route that merely starts with the same letters', () => {
    expect(isSingleRepresentationPath('/downloads-page')).toBe(false)
    expect(isSingleRepresentationPath('/desktop-app')).toBe(false)
  })
})
