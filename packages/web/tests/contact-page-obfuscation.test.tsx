import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import AboutPage from '@/app/about/page'
import ContactPage from '@/app/contact/page'
import { buildOpenApiDocument } from '@skillet/protocol/openapi'

/**
 * Addresses must never reach the wire.
 *
 * `ObfuscatedEmail` assembles the `mailto:` only after mount, so a harvester
 * reading server output (or running no JS) sees `user [at] domain [dot] tld`
 * and nothing usable. That protection is only worth anything if every address
 * on the public pages goes through it, and if the machine-readable files an
 * agent fetches do not quietly publish one alongside.
 */

const EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/

describe('public pages never ship a usable address', () => {
  it('renders no email in the server output of /contact', () => {
    const html = renderToStaticMarkup(<ContactPage />)
    expect(html).not.toMatch(EMAIL)
    // The pre-hydration fallback is what a harvester actually sees.
    expect(html).toContain('[at]')
    expect(html).toContain('[dot]')
  })

  it('renders no email in the server output of /about', () => {
    expect(renderToStaticMarkup(<AboutPage />)).not.toMatch(EMAIL)
  })

  it('publishes no address in the OpenAPI document', () => {
    const doc = buildOpenApiDocument({
      siteUrl: 'https://skillet.md',
      registryUrl: 'https://registry.skillet.md',
    })
    expect(JSON.stringify(doc)).not.toMatch(EMAIL)
    // It still routes mail, via the page that obfuscates.
    expect((doc.info.contact as { url: string }).url).toBe('https://skillet.md/contact')
  })
})
