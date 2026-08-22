/**
 * Registry HTTP hardening: helmet, CORS allowlist, and tiered rate limits
 * (ambient light GETs, write backstop, heavy-read bucket).
 *
 * Unkeyed loopback peers (co-located web SSR with no trusted X-Forwarded-For)
 * skip these per-IP buckets so every user's SSR does not share one 127.0.0.1
 * budget. BFF traffic that forwards the real client IP under TRUST_PROXY still
 * counts against that client.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { loadMcpRateLimitConfig } from './ratelimit/mcp.js';

/** Comma-separated origins; falls back to SKILLET_WEB_URL when unset. */
export function resolveCorsOrigins(): string[] {
  const raw =
    process.env['SKILLET_CORS_ORIGINS'] ?? process.env['SKILLET_WEB_URL'] ?? '';
  if (!raw.trim()) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// Skill routes are `skills/{author}/{slug}/...` — TWO path segments before the
// action. An earlier one-segment pattern (`skills/[^/]+/versions/`) never matched
// a real route, so the heavy bucket only ever guarded sync/content. This covers
// the expensive bundle reads: the version-serve route, the versioned `/download`,
// the latest `/download` (each does a full blob read + zip compression), and
// `/diff` (blob reads + per-file unified diff over two versions; size-guarded in
// lib/diff.ts but still heavy enough to share the heavy-read budget).
const HEAVY_READ_PATH =
  /^\/(?:api\/v1|v1)\/(?:sync\/content\/|skills\/[^/]+\/[^/]+\/(?:versions\/|download|diff))/;

// Hosted MCP serving path (U4): tools/call does full blob reads, so it belongs
// in the heavy-read limiter — but in its OWN per-IP bucket with a bigger
// budget. Connector traffic multiplexes many users' tokens behind shared
// OpenAI/Anthropic egress IPs, so the standard 60/min heavy cap would starve
// legitimate sessions in aggregate. The cap is 2x the MCP per-IP limit (see
// ratelimit/mcp.ts): the DB-backed post-auth limiter stays the precise per-IP
// enforcement point, while this pre-auth bucket exists to absorb
// invalid-token floods (401 spam) that never reach it. Excludes every
// /mcp/link* route (link, enable, disable, regenerate) — session-gated settings
// routes, not the serving endpoint.
const MCP_SERVE_PATH = /^\/(?:api\/v1|v1)\/mcp(?!\/link(?:\/|$))(?:\/|$)/;

const HEAVY_MAX = 60;
const RATE_WINDOW_MS = 60_000;
const DEFAULT_AMBIENT_PER_MINUTE = 2000;
const DEFAULT_WRITE_PER_MINUTE = 300;

interface RateBucket {
  count: number;
  resetAt: number;
}

const heavyBuckets = new Map<string, RateBucket>();
const ambientBuckets = new Map<string, RateBucket>();
const writeBuckets = new Map<string, RateBucket>();

// Buckets are otherwise only replaced when the same IP hits again, so one-shot
// IPs (scrapers, CDN edges, a proxy without TRUST_PROXY) accumulate dead entries
// forever. Sweep expired entries at most once per window so a long-lived process
// can't grow the Map without bound.
let lastHeavySweepAt = 0;
let lastAmbientSweepAt = 0;
let lastWriteSweepAt = 0;
let warnedGlobalDeprecated = false;

function sweepExpired(map: Map<string, RateBucket>, lastSweepAt: number, now: number): number {
  if (now - lastSweepAt < RATE_WINDOW_MS) return lastSweepAt;
  for (const [key, bucket] of map) {
    if (now >= bucket.resetAt) map.delete(key);
  }
  return now;
}

function requestPath(url: string): string {
  return url.split('?')[0] ?? '';
}

/**
 * True for IPv4 127.0.0.0/8, IPv6 ::1, and IPv4-mapped ::ffff:127.x.x.x.
 * Used to recognize co-located web→registry peers (and unkeyed req.ip).
 */
export function isLoopbackIp(address: string | undefined | null): boolean {
  if (address == null) return false;
  let ip = address.trim();
  if (!ip) return false;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped) ip = mapped[1]!;
  if (ip === '::1') return true;
  const m = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return false;
  return [m[1], m[2], m[3]].every((octet) => {
    const n = Number(octet);
    return Number.isInteger(n) && n >= 0 && n <= 255;
  });
}

/**
 * Co-located SSR/BFF without a trusted forwarded client: TCP peer is loopback
 * and `req.ip` is still loopback (TRUST_PROXY off, or no X-Forwarded-For).
 * Those callers must not share one global per-IP bucket — every user's SSR
 * arrives as 127.0.0.1. When the BFF sets XFF and TRUST_PROXY honors it,
 * `req.ip` is the real client and this returns false so per-IP limits apply.
 */
export function isUnkeyedLoopbackClient(
  remoteAddress: string | undefined | null,
  requestIp: string | undefined | null,
): boolean {
  return isLoopbackIp(remoteAddress) && isLoopbackIp(requestIp);
}

function skipHttpRateLimit(req: FastifyRequest): boolean {
  return isUnkeyedLoopbackClient(req.socket?.remoteAddress, req.ip);
}

/** Test hook: whether a request path uses the heavy-read limiter (either bucket). */
export function isHeavyReadPath(url: string): boolean {
  const path = requestPath(url);
  return HEAVY_READ_PATH.test(path) || MCP_SERVE_PATH.test(path);
}

/** Light GET/HEAD that should consume the ambient per-IP budget (not heavy, not MCP serve). */
export function consumesAmbientBudget(method: string, url: string): boolean {
  const m = method.toUpperCase();
  if (m !== 'GET' && m !== 'HEAD') return false;
  const path = requestPath(url);
  if (MCP_SERVE_PATH.test(path) || HEAVY_READ_PATH.test(path)) return false;
  return true;
}

/** Mutating methods that should consume the write backstop (not OPTIONS, not MCP serve). */
export function consumesWriteBudget(method: string, url: string): boolean {
  const m = method.toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return false;
  return !MCP_SERVE_PATH.test(requestPath(url));
}

/**
 * Ambient cap: SKILLET_AMBIENT_RATE_PER_MINUTE, else deprecated
 * SKILLET_GLOBAL_RATE_PER_MINUTE as ambient-only fallback, else 2000.
 */
export function resolveAmbientRatePerMinute(): number {
  const ambient = Number(process.env.SKILLET_AMBIENT_RATE_PER_MINUTE ?? '');
  if (Number.isFinite(ambient) && ambient > 0) return ambient;

  const legacy = Number(process.env.SKILLET_GLOBAL_RATE_PER_MINUTE ?? '');
  if (Number.isFinite(legacy) && legacy > 0) {
    if (!warnedGlobalDeprecated) {
      warnedGlobalDeprecated = true;
      process.stderr.write(
        '[registry] WARNING: SKILLET_GLOBAL_RATE_PER_MINUTE is deprecated; set SKILLET_AMBIENT_RATE_PER_MINUTE instead. Using GLOBAL as the ambient light-GET fallback only (not the write backstop).\n',
      );
    }
    return legacy;
  }
  return DEFAULT_AMBIENT_PER_MINUTE;
}

/** Write backstop: SKILLET_WRITE_RATE_PER_MINUTE, else 300. */
export function resolveWriteRatePerMinute(): number {
  const n = Number(process.env.SKILLET_WRITE_RATE_PER_MINUTE ?? '');
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_WRITE_PER_MINUTE;
}

/** Exposed for tests — reset in-memory heavy-route counters. */
export function resetHeavyReadBuckets(): void {
  heavyBuckets.clear();
}

/** Exposed for tests — reset ambient light-GET counters. */
export function resetAmbientRateBuckets(): void {
  ambientBuckets.clear();
}

/** Exposed for tests — reset write backstop counters. */
export function resetWriteRateBuckets(): void {
  writeBuckets.clear();
}

/** Exposed for tests — clear the one-shot GLOBAL deprecation warn latch. */
export function resetGlobalRateDeprecationWarn(): void {
  warnedGlobalDeprecated = false;
}

/** Cost class a request was charged to. Doubles as the RateLimit policy name. */
export type RateScope = 'ambient' | 'write' | 'heavy_read';

/** What a bucket looked like after this request was charged to it. */
export interface RateState {
  limited: boolean;
  /** Requests permitted per window. */
  limit: number;
  /** Requests left in the window, never negative. */
  remaining: number;
  /** Seconds until the window resets, always >= 1. */
  resetSeconds: number;
}

function takeToken(
  map: Map<string, RateBucket>,
  key: string,
  max: number,
  now: number,
): RateState {
  let bucket = map.get(key);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + RATE_WINDOW_MS };
    map.set(key, bucket);
  }
  bucket.count += 1;
  return {
    limited: bucket.count > max,
    limit: max,
    remaining: Math.max(0, max - bucket.count),
    resetSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

/**
 * Advertise the budget on the response, per the IETF RateLimit header fields
 * draft (draft-ietf-httpapi-ratelimit-headers).
 *
 * Both spellings go out on purpose. The structured-field pair (`RateLimit` +
 * `RateLimit-Policy`) is what the current draft defines; the
 * `RateLimit-Limit` / `-Remaining` / `-Reset` triple is what every client
 * written against the earlier drafts — which is nearly all of them — actually
 * parses. They describe the same bucket, so emitting both costs ~80 bytes and
 * removes the guesswork that made agents either hammer us or self-throttle to
 * a crawl. `Retry-After` (RFC 9110 §10.2.3) rides along on a 429.
 */
function setRateLimitHeaders(reply: FastifyReply, scope: RateScope, state: RateState): void {
  reply.header('RateLimit-Limit', String(state.limit));
  reply.header('RateLimit-Remaining', String(state.remaining));
  reply.header('RateLimit-Reset', String(state.resetSeconds));
  reply.header(
    'RateLimit-Policy',
    `"${scope}"; q=${state.limit}; w=${Math.round(RATE_WINDOW_MS / 1000)}`,
  );
  reply.header('RateLimit', `"${scope}"; r=${state.remaining}; t=${state.resetSeconds}`);
}

function sendRateLimited(
  reply: FastifyReply,
  scope: RateScope,
  retryAfter: number,
) {
  reply.header('Retry-After', String(retryAfter));
  return reply.code(429).send({
    error: 'rate_limited',
    scope,
    retry_after_seconds: retryAfter,
  });
}

function registerAmbientRateLimit(app: FastifyInstance): void {
  const max = resolveAmbientRatePerMinute();
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!consumesAmbientBudget(req.method, req.url)) return;
    if (skipHttpRateLimit(req)) return;
    const now = Date.now();
    lastAmbientSweepAt = sweepExpired(ambientBuckets, lastAmbientSweepAt, now);
    const result = takeToken(ambientBuckets, req.ip, max, now);
    setRateLimitHeaders(reply, 'ambient', result);
    if (result.limited) return sendRateLimited(reply, 'ambient', result.resetSeconds);
  });
}

function registerWriteRateLimit(app: FastifyInstance): void {
  const max = resolveWriteRatePerMinute();
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!consumesWriteBudget(req.method, req.url)) return;
    if (skipHttpRateLimit(req)) return;
    const now = Date.now();
    lastWriteSweepAt = sweepExpired(writeBuckets, lastWriteSweepAt, now);
    const result = takeToken(writeBuckets, req.ip, max, now);
    setRateLimitHeaders(reply, 'write', result);
    if (result.limited) return sendRateLimited(reply, 'write', result.resetSeconds);
  });
}

function registerHeavyReadRateLimit(app: FastifyInstance): void {
  app.addHook('onRequest', async (req, reply) => {
    const path = requestPath(req.url);
    const isMcp = MCP_SERVE_PATH.test(path);
    if (!isMcp && !HEAVY_READ_PATH.test(path)) return;
    if (skipHttpRateLimit(req)) return;

    // MCP rides its own bucket + cap so connector egress IPs (many users, one
    // IP) don't drain the ordinary heavy-read budget — and vice versa.
    const max = isMcp ? 2 * loadMcpRateLimitConfig().ipPerMinute : HEAVY_MAX;
    const now = Date.now();
    lastHeavySweepAt = sweepExpired(heavyBuckets, lastHeavySweepAt, now);
    const key = isMcp ? `mcp:${req.ip}` : req.ip;
    const result = takeToken(heavyBuckets, key, max, now);
    setRateLimitHeaders(reply, 'heavy_read', result);
    if (result.limited) return sendRateLimited(reply, 'heavy_read', result.resetSeconds);
  });
}

/**
 * Fixed origins of the desktop app's webview, allowed in every environment so
 * the device-sync SSE stream (the one sanctioned direct webview connection)
 * can pass preflight without per-environment configuration. Baked in rather
 * than env-configured: env is silently forgettable per environment, and the
 * hermetic test suites scrub SKILLET_* env by design.
 *
 * Security stance (do not "harden" this back into the bug it fixes): no
 * browser page can carry a tauri:// origin, the registry sets no cookies (so
 * `credentials: true` guards nothing cookie-shaped), and every stream request
 * still needs a valid Bearer device token. CORS here only governs whether the
 * desktop page's own JS may read its own stream. A malicious local process
 * listening on port 80 can mint `http://tauri.localhost` in a real browser,
 * but it holds no Bearer token, so it gains only anonymous-tier access —
 * which a local malicious process already exceeds trivially. Exact strings
 * only: never a RegExp (documented @fastify/cors DoS pitfall), never `null`
 * (OWASP: sandboxed iframes can mint `Origin: null` from real browsers).
 * Introducing cookies anywhere in the registry invalidates this stance.
 */
export const DESKTOP_WEBVIEW_ORIGINS = [
  'tauri://localhost', // macOS / Linux (WKWebView / WebKitGTK)
  'http://tauri.localhost', // Windows default (no useHttpsScheme set)
  'https://tauri.localhost', // Windows if useHttpsScheme is ever flipped
];

export async function registerHttpSecurity(app: FastifyInstance): Promise<void> {
  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });

  // resolveCorsOrigins() stays env-only: main.ts reads its emptiness as "did
  // the operator configure a web origin" for the trust-proxy warning. The
  // desktop origins join only here, at registration. Note this makes the
  // allowlist always non-empty, so environments with no env origins move from
  // CORS-disabled to strict allowlist (bare OPTIONS now 400s there).
  const origins = [...resolveCorsOrigins(), ...DESKTOP_WEBVIEW_ORIGINS];
  await app.register(cors, {
    origin: origins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // Cost classes (ambient / write / heavy) use in-process per-IP buckets rather
  // than stacking two @fastify/rate-limit globals — dual global registrations
  // are fragile, and we want a consistent `scope` on every class 429. MCP serve
  // stays out of ambient + write; heavy / MCP post-auth limiters still apply.
  registerAmbientRateLimit(app);
  registerWriteRateLimit(app);
  registerHeavyReadRateLimit(app);
}

/**
 * Warn on rate-limit-defeating proxy misconfigurations.
 *
 * A public bind behind a proxy (Cloudflare here) needs `TRUST_PROXY` set to the
 * proxy's IPs/hops so `req.ip` is the real client, not the edge IP — otherwise
 * every caller shares one bucket. But blanket `true` is the opposite hazard: it
 * trusts `X-Forwarded-For` from *any* caller, so a direct caller can spoof their
 * IP. Both are misconfigurations the operator should see at startup. The warning
 * is a backstop for the deployment contract, not a proof of correctness — a
 * configured web origin signals intent, not the actual request path.
 */
export function warnPublicBindWithoutTrustProxy(
  host: string,
  trustProxy: boolean | number | string,
  webOriginConfigured = false,
): void {
  const publicBind = host === '0.0.0.0' || host === '::';
  if (!publicBind) return;

  if (trustProxy === false) {
    process.stderr.write(
      webOriginConfigured
        ? '[registry] WARNING: a web origin is configured (you are behind a proxy) but TRUST_PROXY is off — rate limits key on the proxy/edge IP, not the real client, so all callers share one bucket. Set TRUST_PROXY to your proxy IPs/hops (e.g. Cloudflare ranges).\n'
        : '[registry] WARNING: bound to a public interface with TRUST_PROXY off; set TRUST_PROXY to your proxy hop count when behind a reverse proxy so rate limits key on the real client IP.\n',
    );
    return;
  }

  if (trustProxy === true) {
    process.stderr.write(
      '[registry] WARNING: TRUST_PROXY=true on a public bind trusts X-Forwarded-For from ANY caller — a direct caller can spoof their IP and evade or poison rate limits. Use the IP/CIDR allowlist (or hop-count) form scoped to your proxy instead, and lock the origin to that proxy.\n',
    );
  }
}
