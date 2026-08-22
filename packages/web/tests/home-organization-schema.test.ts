import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The homepage JSON-LD graph.
 *
 * Two nodes doing two jobs, both easy to break silently: the Organization node
 * feeds knowledge-panel and AI-answer attribution, and the WebSite node's
 * SearchAction is what makes a sitelinks search box eligible for the brand
 * query. Nothing renders differently if either one drifts.
 *
 * Deliberately no `address`. Schema audits score its absence, and the only
 * honest fix is a PostalAddress this project does not have. See the note in
 * lib/home-json-ld.ts.
 *
 * The graph is built at module scope, so each case re-imports with its own env.
 */

type Node = {
  '@type': string
  '@id'?: string
  address?: unknown
  contactPoint?: Array<Record<string, unknown>>
  potentialAction?: Record<string, unknown>
  publisher?: { '@id': string }
}

async function graph(): Promise<Node[]> {
  vi.resetModules()
  const mod = (await import('@/lib/home-json-ld')) as unknown as {
    HOME_JSON_LD: { '@graph': Node[] }
  }
  return mod.HOME_JSON_LD['@graph']
}

const nodeOfType = async (type: string): Promise<Node> => {
  const found = (await graph()).find((n) => n['@type'] === type)
  if (!found) throw new Error(`no ${type} node in the homepage graph`)
  return found
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SITE_URL = 'https://skillet.md'
  delete process.env.NEXT_PUBLIC_CONTACT_EMAIL
})

afterEach(() => {
  delete process.env.NEXT_PUBLIC_SITE_URL
  delete process.env.NEXT_PUBLIC_CONTACT_EMAIL
})

describe('Organization node', () => {
  it('offers both contact routes an answer engine looks for', async () => {
    const org = await nodeOfType('Organization')
    const types = (org.contactPoint ?? []).map((c) => c.contactType)
    expect(types).toEqual(['customer support', 'technical support'])
  })

  // Every address on this site renders through ObfuscatedEmail and never
  // reaches the SSR HTML, so publishing one into structured data has to stay a
  // deliberate opt-in rather than a default.
  it('publishes a support email only when one is configured', async () => {
    expect((await nodeOfType('Organization')).contactPoint![0]!.email).toBeUndefined()
    process.env.NEXT_PUBLIC_CONTACT_EMAIL = 'hi@example.test'
    expect((await nodeOfType('Organization')).contactPoint![0]!.email).toBe('hi@example.test')
  })

  it('carries no address, rather than a fabricated one', async () => {
    expect((await nodeOfType('Organization')).address).toBeUndefined()
  })
})

describe('WebSite node', () => {
  it('declares the SearchAction that makes a sitelinks search box eligible', async () => {
    const site = await nodeOfType('WebSite')
    const action = site.potentialAction as {
      '@type': string
      target: { urlTemplate: string }
      'query-input': string
    }
    expect(action['@type']).toBe('SearchAction')
    expect(action.target.urlTemplate).toBe('https://skillet.md/search?q={search_term_string}')
    expect(action['query-input']).toBe('required name=search_term_string')
  })

  // A dangling @id silently costs the publisher link between the two nodes.
  it('links its publisher to the Organization node by @id', async () => {
    const nodes = await graph()
    const site = nodes.find((n) => n['@type'] === 'WebSite')!
    const org = nodes.find((n) => n['@type'] === 'Organization')!
    expect(site.publisher!['@id']).toBe(org['@id'])
  })

  it('follows the configured origin', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://staging.example.test'
    const org = await nodeOfType('Organization')
    expect(org['@id']).toBe('https://staging.example.test/#organization')
  })
})
