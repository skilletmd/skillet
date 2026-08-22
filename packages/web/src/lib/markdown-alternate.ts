import type { Metadata } from 'next'

type AlternateTypes = NonNullable<NonNullable<Metadata['alternates']>['types']>

/**
 * The `alternates` block for a page that has a Markdown twin at its own URL.
 *
 * Every page whose URL answers `Accept: text/markdown` should emit
 * `<link rel="alternate" type="text/markdown">` pointing at itself. `proxy.ts`
 * already sends the equivalent `Link` header, but an agent that parses HTML and
 * ignores response headers never sees that one — and the skill page, where the
 * twin returns the published SKILL.md, is exactly the page such an agent most
 * wants to find.
 *
 * A helper rather than an inline literal per page so the shape cannot drift
 * across seven call sites, and so `tests/markdown-alternate.test.ts` can walk
 * `src/app` and fail when a route with a twin does not use it.
 *
 * `extraTypes` merges rather than replaces: the blog pages already advertise
 * their RSS feed here, and losing that to gain Markdown would be a bad trade.
 */
export function markdownAlternates(
  canonical: string,
  extraTypes?: AlternateTypes,
): NonNullable<Metadata['alternates']> {
  return {
    canonical,
    types: { ...(extraTypes ?? {}), 'text/markdown': canonical },
  }
}
