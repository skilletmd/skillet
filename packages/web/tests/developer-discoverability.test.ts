import { describe, expect, it } from 'vitest'
import { getDoc } from '@/lib/docs'
import { docStructuredData } from '@/lib/docs-structured-data'
import { DOC_NAV } from '@/lib/docs-nav'

/**
 * The audit finding behind this file: "Agent searched for `skillet` developer
 * resources but found nothing relevant."
 *
 * The resources all existed. What they lacked was a name a search could match:
 * a page titled "API · Skillet" is the right label in the sidebar and the wrong
 * string in a result list, and a CLI described only in prose is not a typed
 * entity any answer engine can return. These pin both fixes.
 */

const SITE = 'https://skillet.md'

describe('developer docs name the product in their title', () => {
  it.each([
    ['cli', 'Skillet CLI (skilletmd) reference'],
    ['api', 'Skillet API reference'],
    ['mcp', 'Skillet MCP server'],
  ])('/docs/%s', (slug, expected) => {
    const doc = getDoc([slug])
    expect(doc).not.toBeNull()
    expect(doc!.searchTitle).toBe(expected)
    // The sidebar label is deliberately NOT the search title: inside the docs
    // the product name is already established by every other pixel.
    expect(doc!.title).not.toBe(expected)
  })

  it('leaves conceptual pages on the plain `Title · Skillet` form', () => {
    expect(getDoc(['faq'])?.searchTitle).toBeUndefined()
    expect(getDoc(['publish'])?.searchTitle).toBeUndefined()
  })
})

describe('typed records for the artifacts Skillet ships', () => {
  it('describes the CLI as a SoftwareApplication with its npm package', () => {
    process.env.NEXT_PUBLIC_SITE_URL = SITE
    const doc = docStructuredData(['cli'])!
    expect(doc['@type']).toBe('SoftwareApplication')
    expect(doc.name).toBe('Skillet CLI')
    expect(doc.alternateName).toBe('skilletmd')
    expect(doc.downloadUrl).toBe('https://www.npmjs.com/package/skilletmd')
    expect(doc.isAccessibleForFree).toBe(true)
    expect(doc.operatingSystem).toContain('macOS')
    delete process.env.NEXT_PUBLIC_SITE_URL
  })

  it('describes the API and the MCP server as WebAPIs pointing at their manifests', () => {
    process.env.NEXT_PUBLIC_SITE_URL = SITE
    const api = docStructuredData(['api'])!
    expect(api['@type']).toBe('WebAPI')
    expect((api.potentialAction as { target: string }).target).toBe(`${SITE}/openapi.json`)

    const mcp = docStructuredData(['mcp'])!
    expect(mcp['@type']).toBe('WebAPI')
    expect((mcp.potentialAction as { target: string }).target).toBe(
      `${SITE}/.well-known/mcp.json`,
    )
    delete process.env.NEXT_PUBLIC_SITE_URL
  })

  it('emits nothing for a page that documents a concept rather than an artifact', () => {
    expect(docStructuredData(['faq'])).toBeNull()
    expect(docStructuredData(['runtimes', 'claude'])).toBeNull()
  })
})

describe('the versioning policy is a real, navigable page', () => {
  it('is in the sidebar, which is what puts it in the sitemap and llms.txt', () => {
    const hrefs = DOC_NAV.flatMap((s) => s.items.map((i) => i.href))
    expect(hrefs).toContain('/docs/versioning')
  })

  it('names the headers a client should watch for', () => {
    const doc = getDoc(['versioning'])
    expect(doc).not.toBeNull()
    for (const token of ['Deprecation', 'Sunset', 'rel="deprecation"', 'RFC 8594']) {
      expect(doc!.content, token).toContain(token)
    }
  })
})
