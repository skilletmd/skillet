// Network-origin lock for the internal mint/link surfaces.
//
// SECURITY: /api/v1/auth/web, /api/v1/auth/link and /api/v1/github/repos let the
// trusted web BFF act on behalf of ANY account. The HMAC request signature
// (auth/web-internal-sig.ts) proves the caller holds the shared secret, but that
// is a SINGLE factor: a secret leak alone would be account takeover. The docs
// have long asserted these routes "sit behind the private network" — this module
// lets a deployment actually ENFORCE that, fail-closed, in code.
//
// The check is against the IMMEDIATE TCP peer (`req.socket.remoteAddress`), NOT
// the `X-Forwarded-For`-derived `req.ip`: XFF is client-supplied and spoofable
// unless the origin is already locked to a trusted proxy, so it cannot anchor an
// origin gate. The socket peer is the real machine that opened the connection —
// loopback when the BFF is co-located, a private range on an internal network, or
// the fronting proxy's egress. (When the registry is only reachable through
// Cloudflare, pair this with Authenticated Origin Pulls / mTLS so the socket peer
// is provably Cloudflare-with-your-cert and not any caller who also routes through
// Cloudflare, paired with Authenticated Origin Pulls / mTLS at the edge.)

import { BlockList, isIPv4, isIPv6 } from 'node:net';

export interface InternalOriginAllowlist {
  /** The raw entries, for startup logging. */
  readonly entries: readonly string[];
  /** True iff the immediate TCP peer is trusted. Fails closed on a missing/
   *  unparseable address. */
  allows(remoteAddress: string | undefined | null): boolean;
}

/** Normalize a peer address to a family, stripping the IPv4-mapped-IPv6 prefix
 *  (Fastify/Node may report ::ffff:127.0.0.1 for an IPv4 peer). */
function normalize(address: string): { ip: string; family: 'ipv4' | 'ipv6' } | null {
  let ip = address.trim();
  if (!ip) return null;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped) ip = mapped[1];
  if (isIPv4(ip)) return { ip, family: 'ipv4' };
  if (isIPv6(ip)) return { ip, family: 'ipv6' };
  return null;
}

/**
 * Parse `SKILLET_INTERNAL_ORIGIN_ALLOWLIST` — a comma-separated list of IPs and
 * CIDR blocks (IPv4 or IPv6) of trusted TCP peers for the internal routes.
 * Returns null when unset/empty (→ NO origin lock; every peer allowed, current
 * behavior). Throws on a malformed entry so a typo fails loudly at boot rather
 * than silently disabling the lock.
 */
export function parseInternalOriginAllowlist(
  raw: string | undefined | null,
): InternalOriginAllowlist | null {
  if (raw == null) return null;
  const entries = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (entries.length === 0) return null;

  const list = new BlockList();
  for (const entry of entries) {
    const slash = entry.indexOf('/');
    if (slash === -1) {
      const n = normalize(entry);
      if (!n) throw new Error(`Invalid IP in SKILLET_INTERNAL_ORIGIN_ALLOWLIST: "${entry}"`);
      list.addAddress(n.ip, n.family);
    } else {
      const n = normalize(entry.slice(0, slash));
      const prefix = Number(entry.slice(slash + 1));
      if (!n || !Number.isInteger(prefix) || prefix < 0) {
        throw new Error(`Invalid CIDR in SKILLET_INTERNAL_ORIGIN_ALLOWLIST: "${entry}"`);
      }
      list.addSubnet(n.ip, prefix, n.family);
    }
  }

  return {
    entries,
    allows(remoteAddress) {
      if (!remoteAddress) return false;
      const n = normalize(remoteAddress);
      if (!n) return false;
      return list.check(n.ip, n.family);
    },
  };
}

/** The internal-only mint/link path prefixes (mirrors the web BFF's blocked set
 *  plus the repo-connect surface). */
export const INTERNAL_ONLY_PREFIXES = [
  '/api/v1/auth/web',
  '/api/v1/auth/link',
  '/api/v1/github/repos',
  // Same BFF-signed tier as /github/repos: owned-repos returns the caller's repos
  // + identity, connect-token injects a GitHub credential. Locked too (when an
  // allowlist is configured).
  '/api/v1/github/owned-repos',
  '/api/v1/github/connect-token',
] as const;

/** True if this request targets an internal-only surface. Matches the prefix
 *  exactly or as a path segment boundary, so an unrelated `/api/v1/auth/webhook`
 *  would not be caught. */
export function isInternalOnlyPath(url: string): boolean {
  const path = url.split('?', 1)[0];
  return INTERNAL_ONLY_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}
