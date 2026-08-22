import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hasMarkdownVariant } from '@/lib/agent-routes'
import { markdownAlternates } from '@/lib/markdown-alternate'

/**
 * Every page whose URL answers `Accept: text/markdown` must also SAY so in its
 * HTML, not just in the `Link` header proxy.ts adds. An agent that parses
 * documents and ignores response headers is exactly the reader the twin exists
 * for, and the skill page — where the twin returns the published SKILL.md — is
 * the one it most needs to find.
 *
 * This walks the route tree rather than listing pages, so adding a new surface
 * to `hasMarkdownVariant` without advertising it fails here instead of shipping
 * a twin nobody can discover.
 */

const APP = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'app')

/** Placeholders that satisfy the handle and slug grammars in agent-routes. */
const SEGMENT_SAMPLE: Record<string, string> = {
  '[author]': 'someone',
  '[skill]': 'some-skill',
  '[slug]': 'some-post',
  // A real docs page: `hasMarkdownVariant` only claims docs paths that resolve.
  '[...slug]': 'api',
}

/** Map a `page.tsx` path to the URL it serves, or null if it is not routable here. */
function routeFor(file: string): string | null {
  const segments = relative(APP, dirname(file)).split(sep).filter(Boolean)
  const out: string[] = []
  for (const segment of segments) {
    // Route groups — `(consumer)`, `(profile)` — do not appear in the URL.
    if (segment.startsWith('(') && segment.endsWith(')')) continue
    if (segment.startsWith('[')) {
      const sample = SEGMENT_SAMPLE[segment]
      if (!sample) return null
      out.push(sample)
      continue
    }
    out.push(segment)
  }
  return `/${out.join('/')}`.replace(/\/+$/, '') || '/'
}

function pageFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...pageFiles(full))
    else if (entry.name === 'page.tsx') out.push(full)
  }
  return out
}

describe('markdownAlternates', () => {
  it('points the twin at the page URL it was given', () => {
    expect(markdownAlternates('/docs/api')).toEqual({
      canonical: '/docs/api',
      types: { 'text/markdown': '/docs/api' },
    })
  })

  // The blog pages already advertise RSS here. Gaining Markdown must not cost it.
  it('merges with types a page already declares', () => {
    const rss = [{ url: '/blog/rss.xml', title: 'Skillet Blog' }]
    expect(markdownAlternates('/blog', { 'application/rss+xml': rss })).toEqual({
      canonical: '/blog',
      types: { 'application/rss+xml': rss, 'text/markdown': '/blog' },
    })
  })
})

describe('every page with a Markdown twin advertises it', () => {
  const pages = pageFiles(APP)
    .map((file) => ({ file, route: routeFor(file) }))
    .filter((p): p is { file: string; route: string } => p.route !== null)

  it('finds the route tree', () => {
    expect(pages.length).toBeGreaterThan(20)
  })

  it('declares the alternate on each one, through the shared helper', () => {
    const missing: string[] = []
    for (const { file, route } of pages) {
      if (!hasMarkdownVariant(route)) continue
      const source = readFileSync(file, 'utf8')
      if (!source.includes('markdownAlternates')) {
        missing.push(`${relative(APP, file)} serves ${route}`)
      }
    }
    expect(
      missing,
      `These routes serve Markdown at their own URL but never say so in their HTML.\n` +
        `Add \`alternates: markdownAlternates(<href>)\` to generateMetadata:\n  ${missing.join('\n  ')}`,
    ).toEqual([])
  })

  // The other half of the guard: a page with no twin must not claim one.
  it('never claims an alternate on a page that has no twin', () => {
    const lying: string[] = []
    for (const { file, route } of pages) {
      if (hasMarkdownVariant(route)) continue
      if (readFileSync(file, 'utf8').includes('markdownAlternates')) {
        lying.push(`${relative(APP, file)} serves ${route}`)
      }
    }
    expect(lying).toEqual([])
  })
})
