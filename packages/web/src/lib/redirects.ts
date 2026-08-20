import type { NextConfig } from 'next'

type Redirects = Awaited<ReturnType<NonNullable<NextConfig['redirects']>>>

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://skillet.md'

/** The one hostname the site is canonical on, e.g. `skillet.md`. */
export const APEX_HOST = new URL(SITE_URL).host

/**
 * Host canonicalization. `www.skillet.md` answered the whole site at 200
 * alongside the apex, so every URL existed on two hostnames with nothing to
 * tell a crawler which one counts.
 *
 * This lives in the repo rather than in a Cloudflare rule for the same reason
 * robots.txt does: the policy diffs, reviews, and ships like everything else.
 * It depends on the `Host` header reaching the app intact; if a proxy ahead of
 * us ever rewrites it, the rule silently stops matching and the redirect has to
 * move to the edge.
 *
 * Skipped when the site is already configured on a `www.` host, which would
 * otherwise redirect to itself forever.
 */
function hostRedirects(): Redirects {
  if (APEX_HOST.startsWith('www.')) return []
  return [
    {
      source: '/:path*',
      has: [{ type: 'host', value: `www.${APEX_HOST}` }],
      destination: `${SITE_URL}/:path*`,
      permanent: true,
    },
  ]
}

/** Path moves. Old links (bookmarks, older docs) redirect instead of 404ing. */
function pathRedirects(): Redirects {
  return [
    // Internal design/dev tools moved under /internal.
    { source: '/design-system', destination: '/internal/design', permanent: false },
    { source: '/og-preview', destination: '/internal/og', permanent: false },
    { source: '/index2', destination: '/internal/home-v2', permanent: false },
    // The adapter capability table is reference docs, not an uptime page.
    { source: '/status', destination: '/docs/runtimes', permanent: false },
    // The create hub moved from /new to /create.
    { source: '/new', destination: '/create', permanent: false },
    // "What is Skillet?" is now the /docs landing page.
    {
      source: '/docs/get-started/what-is-skillet',
      destination: '/docs',
      permanent: false,
    },
    // The safety explainer moved into the docs reference.
    { source: '/safety', destination: '/docs/scanner', permanent: false },
    // The Connectors tab folded into the Account page's ChatGPT & Claude.ai section.
    { source: '/settings/connectors', destination: '/settings', permanent: false },
    // The feed URL scheme flattened: Notifications and Updates moved up a level.
    { source: '/feed/updates', destination: '/updates', permanent: true },
    { source: '/feed/notifications', destination: '/notifications', permanent: true },
  ]
}

/**
 * Every redirect the app serves. Host canonicalization comes first so a `www`
 * request lands on the apex before any path rule rewrites it, which keeps the
 * hop count at one.
 */
export function siteRedirects(): Redirects {
  return [...hostRedirects(), ...pathRedirects()]
}
