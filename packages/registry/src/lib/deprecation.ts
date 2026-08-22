// RFC 9745 `Deprecation` + RFC 8594 `Sunset`, and the RFC 8288 link between
// them and the policy that explains them.
//
// Why this exists as a helper rather than three `reply.header` calls at one
// call site: /docs/versioning now publishes a promise — "nothing in the
// documented surface is removed without appearing in a response header first"
// — and a promise with no shared implementation gets kept by whoever remembers
// it. One function, one spelling, one link target, and a test that pins the
// formats.
//
// Header value shapes are load-bearing and easy to get subtly wrong:
//   Deprecation: true                     RFC 9745 §2, the bare boolean form
//   Deprecation: @1719792000              the same field as a Unix timestamp
//   Sunset: <IMF-fixdate>                 RFC 8594 §3, an HTTP-date, never epoch
//   Link: <url>; rel="deprecation"        RFC 8288, the documentation pointer
import type { FastifyReply } from 'fastify';

export interface DeprecationNotice {
  /**
   * When the endpoint became deprecated, as Unix seconds. Omit for the bare
   * `true` form, which says "deprecated" without claiming a date.
   */
  since?: number;
  /**
   * When it stops answering, as Unix seconds. Omit until a removal date
   * actually exists — a Sunset that later moves is worse than no Sunset, and
   * the policy commits to at least 90 days' notice once one is published.
   */
  sunset?: number;
  /** The page explaining the deprecation and its replacement. */
  documentation: string;
}

/** The header pairs for a notice, in the order they should be set. */
export function deprecationHeaders(notice: DeprecationNotice): Array<[string, string]> {
  const out: Array<[string, string]> = [
    // RFC 9745 §2: a structured-field Item. `true` is a Boolean; a date is a
    // Date, whose serialization is `@` followed by integer seconds.
    ['Deprecation', notice.since == null ? 'true' : `@${Math.floor(notice.since)}`],
    ['Link', `<${notice.documentation}>; rel="deprecation"`],
  ];
  if (notice.sunset != null) {
    // RFC 8594 §3 requires an HTTP-date (IMF-fixdate), which is exactly what
    // `toUTCString()` produces.
    out.push(['Sunset', new Date(notice.sunset * 1000).toUTCString()]);
  }
  return out;
}

/**
 * Stamp a deprecation notice onto a reply.
 *
 * `Link` is merged rather than assigned: a route may already carry an unrelated
 * link relation, and clobbering it to announce a deprecation trades one piece
 * of machine-readable truth for another. RFC 8288 allows several relations in
 * one comma-separated field.
 */
export function markDeprecated(reply: FastifyReply, notice: DeprecationNotice): void {
  for (const [name, value] of deprecationHeaders(notice)) {
    if (name !== 'Link') {
      reply.header(name, value);
      continue;
    }
    const existing = reply.getHeader('Link');
    const current = Array.isArray(existing) ? existing.join(', ') : String(existing ?? '');
    reply.header('Link', current ? `${current}, ${value}` : value);
  }
}

/** The policy page every notice points at, on the configured site origin. */
export function deprecationPolicyUrl(): string {
  const site = (process.env.SKILLET_WEB_URL ?? 'https://skillet.md').replace(/\/+$/, '');
  return `${site}/docs/versioning`;
}
