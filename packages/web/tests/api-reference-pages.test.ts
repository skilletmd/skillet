import { describe, expect, it } from 'vitest'
import { buildOpenApiDocument } from '@skillet/protocol/openapi'
import { getDoc, extractHeadings } from '@/lib/docs'
import { API_REFERENCE_ITEMS } from '@/lib/docs-nav-api.generated'
import { DOC_NAV } from '@/lib/docs-nav'

/**
 * The /docs/api/* pages are a projection of the OpenAPI document
 * (scripts/gen-api-docs.mjs). CI runs the generator with `--check`, which is
 * what stops the pages drifting from the spec; these assert the properties that
 * make the projection *usable* — every operation reachable, every heading
 * anchored, every page in the nav.
 */

const doc = buildOpenApiDocument({
  siteUrl: 'https://skillet.md',
  registryUrl: 'https://registry.skillet.md',
})

const operations = Object.entries(doc.paths).flatMap(([path, item]) =>
  Object.entries(item).map(([method, op]) => ({
    path,
    method: method.toUpperCase(),
    op: op as { operationId: string; tags: string[]; summary: string },
  })),
)

/** The generated page for a tag, or null. */
const pageFor = (tag: string) => getDoc(['api', tag])

describe('generated API reference', () => {
  it('has a page for every tag the spec declares', () => {
    for (const tag of doc.tags) {
      expect(pageFor(tag.name), tag.name).not.toBeNull()
    }
  })

  // The whole reason for generating: the hand-written page covered 6 of 20.
  it('documents every operation in the spec, exactly once', () => {
    const bodies = doc.tags.map((t) => pageFor(t.name)?.content ?? '').join('\n')
    // Match whole heading lines: `## GET /skills` is a prefix of
    // `## GET /skills/{author}/{slug}`, so a substring count reads 7 for one.
    const headings = bodies.split('\n').filter((line) => /^## (GET|POST|PUT|PATCH|DELETE) /.test(line))
    for (const { path, method, op } of operations) {
      const heading = `## ${method} ${path}`
      const hits = headings.filter((line) => line === heading).length
      expect(hits, `${heading} appears ${hits} times`).toBe(1)
      expect(bodies, op.operationId).toContain(`\`${op.operationId}\``)
    }
    expect(headings.length, 'a page documents something the spec does not').toBe(
      operations.length,
    )
  })

  it('gives every operation a curl on the public base URL', () => {
    for (const tag of doc.tags) {
      const content = pageFor(tag.name)!.content
      const curls = content.match(/curl -s "https:\/\/skillet\.md\/api\/v1[^"]*"/g) ?? []
      const count = operations.filter((o) => o.op.tags.includes(tag.name)).length
      expect(curls.length, tag.name).toBe(count)
      // Placeholders must be substituted, or the sample is not copy-pasteable.
      for (const curl of curls) expect(curl, curl).not.toMatch(/[{}]/)
    }
  })

  // Two columns in a ~790px measure. The five-column form gave every column a
  // sliver and broke descriptions into ragged four-word lines.
  it('folds parameter facts into the name cell rather than one column each', () => {
    const content = pageFor('skills')!.content
    expect(content).toContain('| Parameter | Description |')
    expect(content).not.toContain('| Parameter | In | Type | Required | Description |')
    // The name is the only code pill in the cell; a primitive type name is
    // plain text, so the parameter you are looking up is what stands out.
    expect(content).toContain('`author` string · path · required')
    // Enum members stay code — they are literals you type, not type names.
    expect(content).toContain('`new` \\| `alpha` · query · optional')
    // react-markdown runs without rehype-raw; raw HTML would render as text.
    for (const tag of doc.tags) {
      expect(pageFor(tag.name)!.content, tag.name).not.toMatch(/<br\s*\/?>/)
    }
  })

  it('says whether each operation needs a token', () => {
    for (const tag of doc.tags) {
      const content = pageFor(tag.name)!.content
      const marks = content.match(/\*\*Auth\*\* — /g) ?? []
      expect(marks.length, tag.name).toBe(
        operations.filter((o) => o.op.tags.includes(tag.name)).length,
      )
    }
  })

  // Each page opens with an index of its endpoints. Those links are only useful
  // if they resolve to the heading ids the renderer emits.
  it('links its endpoint index to anchors that exist on the page', () => {
    for (const tag of doc.tags) {
      const content = pageFor(tag.name)!.content
      const ids = new Set(extractHeadings(content).map((h) => h.id))
      const links = [...content.matchAll(/\]\(#([a-z0-9-]+)\)/g)].map((m) => m[1]!)
      expect(links.length, `${tag.name} has no index`).toBeGreaterThan(0)
      for (const link of links) {
        expect(ids.has(link), `${tag.name}: #${link} matches no heading`).toBe(true)
      }
    }
  })

  it('is wired into the sidebar under one section', () => {
    const section = DOC_NAV.find((s) => s.title === 'API reference')
    expect(section).toBeDefined()
    expect(section!.items).toBe(API_REFERENCE_ITEMS)
    expect(section!.items.map((i) => i.href)).toEqual(
      doc.tags.map((t) => `/docs/api/${t.name}`),
    )
  })

  it('hands off to the overview rather than restating auth and errors', () => {
    for (const tag of doc.tags) {
      const content = pageFor(tag.name)!.content
      expect(content, tag.name).toContain('/docs/api')
      expect(content, tag.name).toContain('openapi.json')
    }
  })
})
