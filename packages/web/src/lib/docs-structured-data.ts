import { GITHUB_REPO_URL } from './urls'
import { siteAbsoluteUrl, siteUrl } from './site-url'

/**
 * Per-page JSON-LD for docs pages that describe a *thing*, not just a topic.
 *
 * The CLI and the MCP server are shipped artifacts with install commands,
 * licenses, and package registries behind them. A prose page saying so is
 * enough for a person; an answer engine asked "does Skillet have a CLI" is
 * matching against typed entities, and finding none, it concluded there was
 * nothing to find. These are that record.
 *
 * Keyed by docs slug so the catch-all route stays generic: a page with no entry
 * emits nothing, which is the right default for a page that describes a
 * concept rather than a download.
 */
const NPM_PACKAGE = 'skilletmd'

function cliSchema(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    '@id': `${siteUrl()}/docs/cli#cli`,
    name: 'Skillet CLI',
    alternateName: NPM_PACKAGE,
    applicationCategory: 'DeveloperApplication',
    applicationSubCategory: 'Command Line Tool',
    operatingSystem: 'macOS, Linux, Windows',
    description:
      'The Skillet command line tool. Pairs a machine, installs skills from the registry, and syncs them into every agent runtime on disk.',
    url: siteAbsoluteUrl('/docs/cli'),
    downloadUrl: `https://www.npmjs.com/package/${NPM_PACKAGE}`,
    installUrl: `https://www.npmjs.com/package/${NPM_PACKAGE}`,
    softwareHelp: { '@type': 'CreativeWork', url: siteAbsoluteUrl('/docs/cli') },
    codeRepository: GITHUB_REPO_URL,
    license: 'https://www.apache.org/licenses/LICENSE-2.0',
    // The install line, in the field a machine can lift verbatim.
    softwareRequirements: 'Node.js 20+',
    potentialAction: {
      '@type': 'ConsumeAction',
      name: 'Install',
      target: `npx ${NPM_PACKAGE}`,
    },
    // Free, and self-serve: the two facts that decide whether an agent can
    // adopt this without a human in the loop.
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    isAccessibleForFree: true,
    publisher: { '@id': `${siteUrl()}/#organization` },
  }
}

function apiSchema(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebAPI',
    '@id': `${siteUrl()}/docs/api#api`,
    name: 'Skillet Registry API',
    description:
      'The Skillet HTTP API. Anonymous reads of the public skill catalog, kits, and profiles; token-scoped writes for publishing and device sync.',
    url: siteAbsoluteUrl('/docs/api'),
    documentation: siteAbsoluteUrl('/docs/api'),
    termsOfService: siteAbsoluteUrl('/legal/terms'),
    provider: { '@id': `${siteUrl()}/#organization` },
    isAccessibleForFree: true,
    // The machine-readable description, named as such so a crawler that
    // understands WebAPI can go straight to it.
    potentialAction: {
      '@type': 'ConsumeAction',
      name: 'OpenAPI description',
      target: siteAbsoluteUrl('/openapi.json'),
    },
  }
}

function mcpSchema(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebAPI',
    '@id': `${siteUrl()}/docs/mcp#mcp`,
    name: 'Skillet MCP server',
    description:
      "The Skillet Model Context Protocol server. Serves a user's kit live to MCP clients over Streamable HTTP, read-only and approved versions only.",
    url: siteAbsoluteUrl('/docs/mcp'),
    documentation: siteAbsoluteUrl('/docs/mcp'),
    provider: { '@id': `${siteUrl()}/#organization` },
    isAccessibleForFree: true,
    potentialAction: {
      '@type': 'ConsumeAction',
      name: 'MCP server manifest',
      target: siteAbsoluteUrl('/.well-known/mcp.json'),
    },
  }
}

const BUILDERS: Record<string, () => Record<string, unknown>> = {
  cli: cliSchema,
  api: apiSchema,
  mcp: mcpSchema,
}

/** JSON-LD for a docs page, or null when the page describes no named artifact. */
export function docStructuredData(slug: string[]): Record<string, unknown> | null {
  if (slug.length !== 1) return null
  const build = BUILDERS[slug[0]!]
  return build ? build() : null
}
