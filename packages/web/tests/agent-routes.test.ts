import { describe, expect, it } from 'vitest'
import { readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  classifyRoute,
  hasMarkdownVariant,
  KNOWN_TOP_LEVEL_SEGMENTS,
} from '@/lib/agent-routes'
import { DOC_NAV } from '@/lib/docs-nav'
import { PROTECTED_RESOURCE_WELL_KNOWN } from '@skillet/protocol/protected-resource'

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const APP_DIR = join(WEB_ROOT, 'src', 'app')
const DOCS_DIR = join(WEB_ROOT, 'content', 'docs')
const PUBLIC_DIR = join(WEB_ROOT, 'public')

/**
 * Every first path segment `public/` can serve. proxy.ts answers before Next's
 * static handler, so an asset folder missing from the table is a 404 even
 * though the file is on disk.
 */
function publicTopLevelSegments(): string[] {
  if (!existsSync(PUBLIC_DIR)) return []
  return readdirSync(PUBLIC_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
}

/**
 * Every first path segment `src/app` can serve, walked from the filesystem.
 * Route groups `(name)` are transparent, so their children are top-level too;
 * dynamic segments `[name]` are not static routes and are excluded.
 */
function filesystemTopLevelSegments(): string[] {
  const out = new Set<string>()
  const walk = (dir: string, insideGroup: boolean): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const name = entry.name
      // Next ignores `_`-prefixed folders (private); `@name` are parallel routes.
      if (name.startsWith('_') || name.startsWith('@')) continue
      if (name.startsWith('(') && name.endsWith(')')) {
        walk(join(dir, name), true)
        continue
      }
      if (name.startsWith('[')) continue
      out.add(name)
      void insideGroup
    }
  }
  walk(APP_DIR, false)
  // File-convention routes that are files, not folders.
  for (const [file, segment] of [
    ['sitemap.ts', 'sitemap.xml'],
    ['icon.tsx', 'icon'],
    ['apple-icon.tsx', 'apple-icon'],
    ['opengraph-image.tsx', 'opengraph-image'],
  ] as const) {
    if (existsSync(join(APP_DIR, file))) out.add(segment)
  }
  return [...out]
}

describe('known route table', () => {
  // proxy.ts has no filesystem, so the table is hand-maintained. This is the
  // thing that stops a new page from silently 404ing for logged-out visitors.
  it('covers every top-level segment src/app actually serves', () => {
    const missing = filesystemTopLevelSegments().filter(
      (segment) => !KNOWN_TOP_LEVEL_SEGMENTS.has(segment),
    )
    expect(
      missing,
      `Add these to KNOWN_TOP_LEVEL_SEGMENTS in src/lib/agent-routes.ts, or proxy.ts will 404 them:\n${missing.join('\n')}`,
    ).toEqual([])
  })

  // Same trap as src/app, one directory over. brand/ and avatars/ were both
  // missing here, which 404'd the wordmark and every generated cover on a
  // fresh checkout while prod (which had not shipped proxy.ts yet) was fine.
  it('covers every top-level folder in public/', () => {
    const missing = publicTopLevelSegments().filter(
      (segment) => !KNOWN_TOP_LEVEL_SEGMENTS.has(segment),
    )
    expect(
      missing,
      `Add these to KNOWN_TOP_LEVEL_SEGMENTS in src/lib/agent-routes.ts, or proxy.ts will 404 your static assets:\n${missing.join('\n')}`,
    ).toEqual([])
  })

  // The docs route table is derived from the sidebar, so an unlisted doc page
  // would 404 despite its file existing.
  it('has a nav entry for every file in content/docs', () => {
    const navHrefs = new Set(DOC_NAV.flatMap((s) => s.items.map((i) => i.href)))
    navHrefs.add('/docs')
    const missing: string[] = []
    const walk = (dir: string, base: string[]): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          walk(join(dir, entry.name), [...base, entry.name])
          continue
        }
        if (!entry.name.endsWith('.md')) continue
        const slug = [...base, entry.name.replace(/\.md$/, '')]
        const href = slug.length === 1 && slug[0] === 'index' ? '/docs' : `/docs/${slug.join('/')}`
        if (!navHrefs.has(href)) missing.push(href)
      }
    }
    walk(DOCS_DIR, [])
    expect(
      missing,
      `Add these to DOC_NAV in src/lib/docs-nav.ts — they are unreachable in the sidebar and 404 in proxy.ts:\n${missing.join('\n')}`,
    ).toEqual([])
  })
})

describe('classifyRoute', () => {
  it('passes through the root and every static route', () => {
    for (const path of ['/', '/browse', '/docs', '/docs/install', '/stats', '/legal/terms']) {
      expect(classifyRoute(path), path).toEqual({ kind: 'known' })
    }
  })

  it('rejects a path that matches no route shape', () => {
    for (const path of [
      '/openapi.yaml',
      '/.well-known/nope.json',
      '/wp-admin/setup-config.php',
      '/a/b/c/d/e',
      '/gtm/some-skill/nope',
    ]) {
      expect(classifyRoute(path), path).toEqual({ kind: 'unknown' })
    }
  })

  it('rejects an unknown browse category without asking the registry', () => {
    expect(classifyRoute('/browse/frontend')).toEqual({ kind: 'known' })
    expect(classifyRoute('/browse/all')).toEqual({ kind: 'known' })
    expect(classifyRoute('/browse/not-a-category')).toEqual({ kind: 'unknown' })
  })

  it('rejects an unknown docs page without asking the registry', () => {
    expect(classifyRoute('/docs/cli')).toEqual({ kind: 'known' })
    expect(classifyRoute('/docs/runtimes/claude')).toEqual({ kind: 'known' })
    expect(classifyRoute('/docs/does-not-exist')).toEqual({ kind: 'unknown' })
  })

  it('routes handle-shaped paths to a registry lookup', () => {
    expect(classifyRoute('/gtm')).toEqual({
      kind: 'registry',
      check: { type: 'author', author: 'gtm' },
    })
    expect(classifyRoute('/gtm/followers')).toEqual({
      kind: 'registry',
      check: { type: 'author', author: 'gtm' },
    })
    expect(classifyRoute('/gtm/kit')).toEqual({
      kind: 'registry',
      check: { type: 'author', author: 'gtm' },
    })
    expect(classifyRoute('/gtm/my-skill')).toEqual({
      kind: 'registry',
      check: { type: 'skill', author: 'gtm', slug: 'my-skill' },
    })
    expect(classifyRoute('/gtm/my-skill/edit')).toEqual({
      kind: 'registry',
      check: { type: 'skill', author: 'gtm', slug: 'my-skill' },
    })
    expect(classifyRoute('/gtm/kit/my-kit')).toEqual({
      kind: 'registry',
      check: { type: 'kit', owner: 'gtm', slug: 'my-kit' },
    })
  })

  // The registry resolves a handle case-insensitively, so /GTM renders the same
  // profile as /gtm. Classifying on the raw segment would 404 a working URL.
  it('classifies handles case-insensitively', () => {
    expect(classifyRoute('/GTM')).toEqual({
      kind: 'registry',
      check: { type: 'author', author: 'gtm' },
    })
    expect(classifyRoute('/GTM/My-Skill')).toEqual({
      kind: 'registry',
      check: { type: 'skill', author: 'gtm', slug: 'my-skill' },
    })
    expect(classifyRoute('/Docs/Install')).toEqual({ kind: 'known' })
  })

  it('rejects segments that cannot be a handle or a slug', () => {
    // Leading hyphen, over-length, and encoded bytes are all outside the grammar.
    expect(classifyRoute('/-nope')).toEqual({ kind: 'unknown' })
    expect(classifyRoute(`/${'a'.repeat(40)}`)).toEqual({ kind: 'unknown' })
    expect(classifyRoute('/gtm/%2e%2e')).toEqual({ kind: 'unknown' })
    expect(classifyRoute('/gtm/skill.md')).toEqual({ kind: 'unknown' })
  })

  it('rejects a deeper path under a profile sub-page', () => {
    expect(classifyRoute('/gtm/followers/extra')).toEqual({ kind: 'unknown' })
    expect(classifyRoute('/gtm/kit/my-kit/nope')).toEqual({ kind: 'unknown' })
    expect(classifyRoute('/gtm/kit/my-kit/edit')).toEqual({
      kind: 'registry',
      check: { type: 'kit', owner: 'gtm', slug: 'my-kit' },
    })
  })

  // proxy.ts renders the branded 404 body by fetching /404. If that path were
  // ever classified as unknown, serving a 404 would recurse.
  it('always treats /404 as a real route', () => {
    expect(classifyRoute('/404')).toEqual({ kind: 'known' })
  })
})

describe('hasMarkdownVariant', () => {
  it('covers the prose surfaces', () => {
    for (const path of ['/', '/docs', '/docs/install', '/blog', '/blog/hello', '/browse']) {
      expect(hasMarkdownVariant(path), path).toBe(true)
    }
  })

  it('covers profiles and skills, which resolve at request time', () => {
    expect(hasMarkdownVariant('/gtm')).toBe(true)
    expect(hasMarkdownVariant('/gtm/my-skill')).toBe(true)
  })

  it('does not claim a variant for app surfaces or unknown paths', () => {
    for (const path of ['/settings', '/login', '/gtm/kit', '/nope/nope/nope', '/browse/frontend']) {
      expect(hasMarkdownVariant(path), path).toBe(false)
    }
  })

  // The Agent Skills artifacts end in `.md` but are served verbatim by their own
  // route; negotiating them would break the published SHA-256 digests.
  it('never claims a .well-known artifact', () => {
    expect(hasMarkdownVariant('/.well-known/agent-skills/write-a-skill/SKILL')).toBe(false)
  })
})

describe('.well-known suffixes', () => {
  it('serves only the manifests this origin publishes', () => {
    expect(classifyRoute('/.well-known/mcp.json')).toEqual({ kind: 'known' })
    expect(classifyRoute('/.well-known/agent-skills/index.json')).toEqual({ kind: 'known' })
    expect(classifyRoute('/.well-known/agent-skills/write-a-skill/SKILL.md')).toEqual({
      kind: 'known',
    })
  })

  // A 401's WWW-Authenticate header points a client at these. If proxy.ts
  // classified them `unknown` the challenge would resolve to a 404 and the
  // whole discovery chain would dead-end.
  it('serves both RFC 9728 protected-resource documents', () => {
    for (const path of Object.values(PROTECTED_RESOURCE_WELL_KNOWN)) {
      expect(classifyRoute(path), path).toEqual({ kind: 'known' })
    }
  })

  it('does not treat a protected-resource prefix as a wildcard', () => {
    for (const path of [
      '/.well-known/oauth-protected-resource/api',
      '/.well-known/oauth-protected-resource/api/v1',
      '/.well-known/oauth-protected-resource/api/v1/mcp/extra',
      '/.well-known/oauth-authorization-server',
    ]) {
      expect(classifyRoute(path), path).toEqual({ kind: 'unknown' })
    }
  })

  it('404s every other well-known probe', () => {
    for (const path of [
      '/.well-known/security.txt',
      '/.well-known/openapi.json',
      '/.well-known/agent-skills',
      '/.well-known/agent-skills/write-a-skill',
      '/.well-known/agent-skills/write-a-skill/README.md',
    ]) {
      expect(classifyRoute(path), path).toEqual({ kind: 'unknown' })
    }
  })
})
