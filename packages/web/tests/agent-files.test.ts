import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { GET as llmsTxt } from '@/app/llms.txt/route'
import { GET as openApi } from '@/app/openapi.json/route'
import { GET as mcpJson } from '@/app/.well-known/mcp.json/route'
import { GET as agentSkillsIndexRoute } from '@/app/.well-known/agent-skills/index.json/route'
import { GET as agentSkillArtifact } from '@/app/.well-known/agent-skills/[name]/SKILL.md/route'
import { GET as protectedResourceApi } from '@/app/.well-known/oauth-protected-resource/route'
import { GET as protectedResourceMcp } from '@/app/.well-known/oauth-protected-resource/api/v1/mcp/route'
import {
  OPENAPI_SCOPES,
  PROTECTED_RESOURCE_WELL_KNOWN,
} from '@skillet/protocol/protected-resource'
import { AGENT_SKILLS_SCHEMA, listPublishedSkills } from '@/lib/agent-skills-index'
import { DOC_NAV } from '@/lib/docs-nav'

const SITE = 'https://skillet.md'

beforeEach(() => {
  process.env.NEXT_PUBLIC_SITE_URL = SITE
})
afterEach(() => {
  delete process.env.NEXT_PUBLIC_SITE_URL
})

describe('/llms.txt', () => {
  // llmstxt.org v2: an H1 with the project name is the only required section;
  // a blockquote summary and H2-delimited link lists are the parseable shape.
  it('follows the llmstxt.org structure', async () => {
    const body = await llmsTxt().text()
    const lines = body.split('\n')
    expect(lines[0]).toBe('# Skillet')
    expect(lines[2]?.startsWith('> ')).toBe(true)
    expect(body).toMatch(/^## /m)
    // Every link list entry is `- [name](url)`, optionally followed by notes.
    const bullets = lines.filter((l) => l.startsWith('- '))
    expect(bullets.length).toBeGreaterThan(10)
    for (const bullet of bullets) {
      expect(bullet, bullet).toMatch(/^- (\*\*|\[)/)
    }
  })

  it('serves as text/markdown', () => {
    expect(llmsTxt().headers.get('content-type')).toContain('text/markdown')
  })

  // The audit finding this exists to answer: an agent instruction file with no
  // explicit "when to use this" reads as marketing, not guidance.
  it('tells an agent when to reach for Skillet, with the call to make', async () => {
    const body = await llmsTxt().text()
    const section = body.split('## When to use Skillet')[1]?.split('\n## ')[0] ?? ''
    expect(section).toBeTruthy()
    // Named jobs, not positioning.
    expect(section).toMatch(/Before writing agent instructions from scratch/)
    expect(section).toMatch(/Before running a third-party skill/)
    // Each bullet names a concrete call. `<placeholder>` segments stay literal:
    // percent-encoding them would hand an agent a URL it cannot substitute into.
    expect(section).toContain('GET https://skillet.md/api/v1/search?q=<task>')
    expect(section).toContain('https://skillet.md/api/v1/profiles/<handle>')
    expect(section).not.toMatch(/%3C|%3E/)
    expect(section).toMatch(/Accept: text\/markdown|npx skilletmd/)
    // And what NOT to use it for.
    expect(body).toMatch(/Do not use Skillet to store secrets/)
  })

  it('points at every machine-readable file this origin publishes', async () => {
    const body = await llmsTxt().text()
    for (const path of [
      '/openapi.json',
      '/.well-known/mcp.json',
      '/.well-known/agent-skills/index.json',
      PROTECTED_RESOURCE_WELL_KNOWN.api,
      PROTECTED_RESOURCE_WELL_KNOWN.mcp,
      '/sitemap.xml',
    ]) {
      expect(body, path).toContain(`${SITE}${path}`)
    }
  })

  it('lists every docs page, so nothing is reachable only through the sidebar', async () => {
    const body = await llmsTxt().text()
    for (const section of DOC_NAV) {
      for (const item of section.items) {
        expect(body, item.href).toContain(`${SITE}${item.href}`)
      }
    }
  })

  it('emits absolute URLs on the configured origin', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://staging.example.test'
    const body = await llmsTxt().text()
    expect(body).toContain('https://staging.example.test/docs')
    expect(body).not.toContain('https://skillet.md/docs')
  })
})

describe('/openapi.json', () => {
  it('serves a parseable OpenAPI document with open CORS', async () => {
    const res = openApi()
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    const doc = JSON.parse(await res.text())
    expect(doc.openapi).toBe('3.1.0')
    expect(doc.paths['/search'].get.operationId).toBe('search')
    expect(doc.servers[0].url).toBe(`${SITE}/api/v1`)
  })
})

describe('/.well-known/mcp.json', () => {
  it('is valid JSON, not the app shell', async () => {
    const res = mcpJson()
    expect(res.headers.get('content-type')).toContain('application/json')
    const doc = JSON.parse(await res.text())
    expect(typeof doc).toBe('object')
  })

  // Two competing drafts (SEP-1649, SEP-1960) read different field names for
  // the same facts; the manifest carries both spellings.
  it('carries the fields both MCP discovery drafts read', async () => {
    const doc = JSON.parse(await mcpJson().text())
    expect(doc.name).toBe('skillet')
    expect(doc.mcp_version).toBeTruthy()
    expect(doc.transport).toBe('streamable-http')
    expect(doc.transports[0]).toEqual({ type: 'streamable-http', url: doc.endpoint })
    expect(doc.endpoint).toMatch(/\/api\/v1\/mcp$/)
    expect(doc.capabilities).toContain('tools')
    expect(doc.auth.type).toBe('bearer')
    expect(doc.auth.scopes).toEqual(['read'])
    expect(doc.documentation).toBe(`${SITE}/docs/mcp`)
  })

  it('describes each tool so a client knows what it gets before connecting', async () => {
    const doc = JSON.parse(await mcpJson().text())
    const names = doc.tools.map((t: { name: string }) => t.name)
    expect(names).toEqual(['list_skills', 'get_skill', 'search', 'fetch'])
    for (const tool of doc.tools) expect(tool.description.length).toBeGreaterThan(20)
  })
})

describe('/.well-known/agent-skills/', () => {
  it('publishes a v0.2.0 index of the skills in this repo', async () => {
    const doc = JSON.parse(await agentSkillsIndexRoute().text())
    expect(doc.$schema).toBe(AGENT_SKILLS_SCHEMA)
    expect(Array.isArray(doc.skills)).toBe(true)
    expect(doc.skills.length).toBeGreaterThan(0)
  })

  it('gives every entry the five required fields, in the spec’s shapes', async () => {
    const doc = JSON.parse(await agentSkillsIndexRoute().text())
    for (const entry of doc.skills) {
      expect(Object.keys(entry).sort()).toEqual([
        'description',
        'digest',
        'name',
        'type',
        'url',
      ])
      expect(entry.name, entry.name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      expect(entry.name.length).toBeLessThanOrEqual(64)
      expect(entry.type).toBe('skill-md')
      expect(entry.description.length).toBeGreaterThan(0)
      expect(entry.description.length).toBeLessThanOrEqual(1024)
      expect(entry.url).toBe(`/.well-known/agent-skills/${entry.name}/SKILL.md`)
      expect(entry.digest, entry.name).toMatch(/^sha256:[0-9a-f]{64}$/)
    }
  })

  // Clients MUST verify the digest and MUST NOT use content that fails. Serving
  // bytes that do not hash to the published digest breaks every conforming
  // client, so this is the load-bearing assertion of the whole file.
  it('serves artifact bytes that hash to the published digest', async () => {
    const doc = JSON.parse(await agentSkillsIndexRoute().text())
    for (const entry of doc.skills) {
      const res = await agentSkillArtifact(new Request('https://x.test'), {
        params: Promise.resolve({ name: entry.name }),
      })
      expect(res.status, entry.name).toBe(200)
      expect(res.headers.get('content-type')).toContain('text/markdown')
      const body = await res.text()
      expect(`sha256:${createHash('sha256').update(body, 'utf8').digest('hex')}`, entry.name).toBe(
        entry.digest,
      )
    }
  })

  it('404s an unpublished skill name', async () => {
    const res = await agentSkillArtifact(new Request('https://x.test'), {
      params: Promise.resolve({ name: 'not-a-real-skill' }),
    })
    expect(res.status).toBe(404)
  })

  it('rejects a traversal attempt in the name', async () => {
    for (const name of ['../../package', 'a/b', '.']) {
      const res = await agentSkillArtifact(new Request('https://x.test'), {
        params: Promise.resolve({ name }),
      })
      expect(res.status, name).toBe(404)
    }
  })

  it('agrees with the frontmatter name of each skill it publishes', () => {
    for (const skill of listPublishedSkills()) {
      expect(skill.content).toContain(`name: ${skill.name}`)
    }
  })
})

describe('/llms.txt developer resources', () => {
  // The audit this answers: an agent searching for "skillet" developer
  // resources found nothing relevant. Every one of them is now named, by
  // product name, in the file agents read first.
  it('names each developer resource with the product name in the label', async () => {
    const body = await llmsTxt().text()
    const section = body.split('## Developer resources')[1]?.split('\n## ')[0] ?? ''
    expect(section).toBeTruthy()
    for (const label of [
      'Skillet API reference',
      'Skillet OpenAPI description',
      'Skillet MCP server',
      'Skillet CLI (skilletmd)',
      'Skillet API versioning and deprecation policy',
    ]) {
      expect(section, label).toContain(label)
    }
    // The CLI is discoverable as a package, not just as prose.
    expect(section).toContain('https://www.npmjs.com/package/skilletmd')
  })

  // "Agents can't fill out contact-sales forms." Say the three facts that
  // decide whether one can integrate unattended.
  it('states that reads are anonymous, credentials are self-serve, and limits are in headers', async () => {
    const body = await llmsTxt().text()
    expect(body).toMatch(/every read above is anonymous/i)
    expect(body).toMatch(/no key to apply for/i)
    expect(body).toContain('RateLimit-Remaining')
  })
})

describe('/.well-known/oauth-protected-resource', () => {
  // RFC 9728. Before this, the scopes existed and were enforced but were
  // published only as prose, so an agent could not request least privilege.
  it('publishes every scope the API accepts', async () => {
    const doc = JSON.parse(await protectedResourceApi().text())
    expect(doc.scopes_supported).toEqual(Object.keys(OPENAPI_SCOPES))
    expect(doc.bearer_methods_supported).toEqual(['header'])
    expect(doc.resource).toMatch(/\/api\/v1$/)
    expect(doc.resource_documentation).toBe(`${SITE}/docs/api`)
  })

  it('scopes the MCP document to `read` and names the MCP endpoint as the resource', async () => {
    const doc = JSON.parse(await protectedResourceMcp().text())
    expect(doc.scopes_supported).toEqual(['read'])
    expect(doc.resource).toMatch(/\/api\/v1\/mcp$/)
    expect(doc.resource_documentation).toBe(`${SITE}/docs/mcp`)
  })

  it('is readable cross-origin and cached', () => {
    for (const res of [protectedResourceApi(), protectedResourceMcp()]) {
      expect(res.headers.get('content-type')).toContain('application/json')
      expect(res.headers.get('access-control-allow-origin')).toBe('*')
      expect(res.headers.get('cache-control')).toContain('max-age')
    }
  })

  // The route directory is a hand-built mirror of a path the protocol derives.
  // If REGISTRY_VERSION_PREFIX ever moves, this fails rather than leaving the
  // 401 challenge pointing at a 404.
  it('lives at the path RFC 9728 derives from the resource', () => {
    expect(PROTECTED_RESOURCE_WELL_KNOWN.api).toBe('/.well-known/oauth-protected-resource')
    expect(PROTECTED_RESOURCE_WELL_KNOWN.mcp).toBe(
      '/.well-known/oauth-protected-resource/api/v1/mcp',
    )
  })
})

describe('/openapi.json machine-readable declarations', () => {
  // "OpenAPI declares security schemes but no named OAuth scopes — agents get
  // all-or-nothing access." Every operation now names what it needs.
  it('names the scopes on every operation, not just the authenticated ones', async () => {
    const doc = JSON.parse(await openApi().text())
    const paths = doc.paths as Record<string, Record<string, { security?: unknown }>>
    const ops = Object.entries(paths).flatMap(([path, item]) =>
      Object.entries(item).map(([method, op]) => ({ path, method, op })),
    )
    expect(ops.length).toBeGreaterThan(15)
    for (const { path, method, op } of ops) {
      expect(op.security, `${method} ${path}`).toBeDefined()
    }
    // A public read says both things: no credential needed, `read` suffices.
    expect(doc.paths['/skills'].get.security).toEqual([{}, { bearerAuth: ['read'] }])
    // An authenticated operation keeps its own, narrower grant.
    expect(doc.paths['/sync/manifest'].get.security).toEqual([{ bearerAuth: ['sync'] }])
    // And the catalog itself is on the scheme.
    expect(doc.components.securitySchemes.bearerAuth['x-scopes']).toEqual(OPENAPI_SCOPES)
  })

  it('declares the versioning and deprecation policy', async () => {
    const doc = JSON.parse(await openApi().text())
    expect(doc.info['x-versioning']).toMatchObject({
      strategy: 'url-path',
      current: '/api/v1',
      deprecation_header: 'Deprecation',
      sunset_header: 'Sunset',
      policy_url: `${SITE}/docs/versioning`,
    })
  })

  it('declares the rate-limit headers by name', async () => {
    const doc = JSON.parse(await openApi().text())
    expect(doc.info['x-rate-limit-headers']).toMatchObject({
      limit: 'RateLimit-Limit',
      remaining: 'RateLimit-Remaining',
      reset: 'RateLimit-Reset',
      retry_after: 'Retry-After',
    })
  })

  // Onboarding friction, as a value rather than a paragraph.
  it('declares that onboarding is free, anonymous, and self-serve', async () => {
    const doc = JSON.parse(await openApi().text())
    expect(doc.info['x-onboarding']).toMatchObject({
      anonymous_reads: true,
      free_tier: true,
      self_serve_credentials: true,
      contact_sales_required: false,
      cli: 'npx skilletmd',
    })
  })

  it('points at its own protected-resource metadata', async () => {
    const doc = JSON.parse(await openApi().text())
    expect(doc.info['x-protected-resource-metadata']).toContain(
      PROTECTED_RESOURCE_WELL_KNOWN.api,
    )
  })
})
