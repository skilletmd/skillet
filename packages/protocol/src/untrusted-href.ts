/**
 * Untrusted-markdown link guard — the single source of truth shared by web and
 * desktop (NF-009 / U12). Framework-agnostic: string in, boolean out, no DOM or
 * node deps, so each surface can gate a rendered link the same way. Exposed via
 * the `@skillet/protocol/untrusted-href` subpath (NOT the barrel) so importing it
 * never pulls `node:crypto` and blanks a browser page — same play as ./covers.
 *
 * Allow only: same-origin app routes (`/path`), in-page hashes (`#id`),
 * `mailto:`, and `http`/`https`. Reject everything else — hostile schemes
 * (`javascript:`, `data:`, `vbscript:`, whitespace/case-obfuscated variants) and
 * protocol-relative (`//host`) URLs, which resolve to a foreign origin.
 */
export function isSafeUntrustedHref(href: string): boolean {
  const trimmed = href.trim()
  if (trimmed.length === 0) return false
  // Protocol-relative (`//host`) → external origin; treat as untrusted.
  if (trimmed.startsWith('//')) return false
  // Same-origin app routes and in-page hash targets.
  if (trimmed.startsWith('/') || trimmed.startsWith('#')) return true
  if (trimmed.startsWith('mailto:')) return true
  try {
    const parsed = new URL(trimmed)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}
