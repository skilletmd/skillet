import { describe, it, expect } from 'vitest'
import { scoreDocs, searchDocs, type DocRecord } from '@/lib/docs-search'

const RECORDS: DocRecord[] = [
  {
    docId: 'get-started/publish',
    title: 'Publishing skills',
    description: '',
    section: 'Get started',
    href: '/docs/publish',
    headings: [{ text: 'Setup', id: 'setup' }],
    body: 'How to publish a skill from the CLI.',
  },
  {
    docId: 'using/teams',
    title: 'Teams',
    description: '',
    section: 'Using',
    href: '/docs/teams',
    headings: [],
    body: 'Collaborate and publish together with your team.',
  },
  {
    docId: 'runtimes/chatgpt',
    title: 'ChatGPT',
    description: 'Use Skillet in ChatGPT.',
    section: 'Runtimes',
    href: '/docs/runtimes/chatgpt',
    headings: [{ text: 'Install the connector', id: 'install-the-connector' }],
    body: 'Skillet runs in ChatGPT and Claude.',
  },
]

describe('scoreDocs', () => {
  it('ranks a title match above a body-only match', () => {
    const results = scoreDocs(RECORDS, 'publish', 10)
    expect(results[0].doc_id).toBe('get-started/publish') // title "Publishing"
    expect(results.map((r) => r.doc_id)).toContain('using/teams') // body-only also returned
    expect(results[0].score).toBeGreaterThan(results[1].score)
  })

  it('deep-links to the matched heading anchor', () => {
    const results = scoreDocs(RECORDS, 'connector', 10)
    expect(results[0].doc_id).toBe('runtimes/chatgpt')
    expect(results[0].url).toBe('/docs/runtimes/chatgpt#install-the-connector')
  })

  it('uses the bare page href for a body-only match (no heading hit)', () => {
    const results = scoreDocs(RECORDS, 'collaborate', 10)
    expect(results[0].doc_id).toBe('using/teams')
    expect(results[0].url).toBe('/docs/teams')
  })

  it('matches tokens that appear only in the body (full-text)', () => {
    const results = scoreDocs(RECORDS, 'claude', 10)
    expect(results.map((r) => r.doc_id)).toContain('runtimes/chatgpt')
  })

  it('matches the section so e.g. "runtimes" finds Runtimes pages', () => {
    const results = scoreDocs(RECORDS, 'runtimes', 10)
    expect(results.map((r) => r.doc_id)).toContain('runtimes/chatgpt')
  })

  it('sums scores across multiple tokens', () => {
    const results = scoreDocs(RECORDS, 'publish skill', 10)
    expect(results[0].doc_id).toBe('get-started/publish') // matches both tokens in title+body
  })

  it('caps results at the limit, sorted by score desc', () => {
    const results = scoreDocs(RECORDS, 'publish', 1)
    expect(results).toHaveLength(1)
    expect(results[0].doc_id).toBe('get-started/publish')
  })

  it('returns [] for empty/whitespace and no-match queries', () => {
    expect(scoreDocs(RECORDS, '   ', 10)).toEqual([])
    expect(scoreDocs(RECORDS, 'zzznotfound', 10)).toEqual([])
  })

  it('builds a snippet from the first body line containing a token', () => {
    const results = scoreDocs(RECORDS, 'collaborate', 10)
    expect(results[0].snippet).toContain('Collaborate')
  })
})

// Smoke tests against the real content/docs corpus, to catch index-build wiring
// regressions (frontmatter parsing, slug→href, bespoke-page coverage).
describe('searchDocs (real corpus)', () => {
  it('finds the ChatGPT runtime doc', () => {
    const results = searchDocs('chatgpt', 5)
    expect(results.length).toBeGreaterThan(0)
    expect(results.some((d) => d.url.includes('/docs/runtimes/chatgpt'))).toBe(true)
  })

  it('finds Runtimes pages by section, including the bespoke overview page', () => {
    const results = searchDocs('runtimes', 20)
    expect(results.some((d) => d.url === '/docs/runtimes' || d.url.startsWith('/docs/runtimes#'))).toBe(
      true,
    )
  })
})
