/**
 * The canonical public origin of this deployment.
 *
 * `NEXT_PUBLIC_SITE_URL` was already read inline in five places (sitemap,
 * robots, redirects, home JSON-LD, layout metadata) with the same default. The
 * agent-facing files — llms.txt, the OpenAPI document, the well-known
 * manifests — all emit absolute URLs, and an origin that disagrees between two
 * of them is a broken link in a machine-read file. One reader, one default.
 */
const DEFAULT_SITE_URL = 'https://skillet.md'

/** Origin with no trailing slash, e.g. `https://skillet.md`. */
export function siteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  return (raw && raw.length > 0 ? raw : DEFAULT_SITE_URL).replace(/\/+$/, '')
}

/** Absolute URL for a site-relative path. */
export function siteAbsoluteUrl(path: string): string {
  return new URL(path, `${siteUrl()}/`).toString()
}

/**
 * Public origin of the registry API, for documents that hand an agent a URL it
 * will actually call. Falls back to the apex mirror, which proxies the same
 * read surface, so a deployment without the registry env still emits a URL
 * that resolves.
 */
export function registryPublicUrl(): string {
  const raw = (
    process.env.NEXT_PUBLIC_REGISTRY_PUBLIC_URL ??
    process.env.NEXT_PUBLIC_REGISTRY_URL ??
    ''
  ).trim()
  return raw.length > 0 ? raw.replace(/\/+$/, '') : siteUrl()
}
