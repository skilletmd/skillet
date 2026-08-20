// Web-BFF request signing — REGISTRY VERIFICATION side. (U2 / OSS-hardening)
//
// SECURITY-CRITICAL — and these routes MUST NEVER be internet-routable. The
// surfaces that call this verifier (POST /api/v1/auth/web/session, /auth/web/
// session/refresh, /auth/link, POST /api/v1/github/repos) let the trusted web
// BFF act on behalf of *any* account. They sit behind the deployment's private
// network; the browser BFF proxy additionally blocks the /auth/web + /auth/link
// paths and strips the x-skillet-web-* signing headers so a browser can never
// originate them. This signature proves the caller holds the shared signing
// secret — it is a defense-in-depth credential, NOT a substitute for network
// isolation.
//
// This replaces the former raw shared-secret bearer/header (a "god-secret":
// anyone who held it could mint a session for ANY account). Each internal call
// is now signed over a canonical string that covers the full request:
//
//   canonical =
//     METHOD            \n
//     sha256hex(PATH)   \n      (no query string)
//     sha256hex(QUERY)  \n      (query string sans '?'; '' today → fixed hash)
//     sha256hex(BODY)   \n      (BODY = canonicalJson of the parsed body fields)
//     TS                \n      (unix seconds)
//     NONCE                      (random hex)
//
//   x-skillet-web-sig   = hex(HMAC-SHA256(secret, canonical))
//   x-skillet-web-ts    = unix seconds
//   x-skillet-web-nonce = random hex
//
// The web signer (packages/web/src/lib/web-internal-sign.ts) MUST produce the
// exact same canonical bytes. The two implementations are mirrored deliberately
// (same precedent as auth/signature.ts, which inlines the publish byte-format on
// both sides) — the byte format is the contract. If they ever drift, login,
// session-refresh, and repo-connect break. Keep them in lockstep.
//
// We sign the explicitly reconstructed body *fields* (via a deterministic
// canonical JSON), NOT the raw request bytes: Fastify's default parser discards
// the raw body, so re-stringifying req.body is not byte-stable. canonicalJson()
// sorts keys recursively, so both sides serialize the same logical body to
// identical bytes regardless of key order.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const SIG_HEADER = 'x-skillet-web-sig';
export const TS_HEADER = 'x-skillet-web-ts';
export const NONCE_HEADER = 'x-skillet-web-nonce';

// Max clock skew between the web BFF and the registry, and the replay window.
// Both hosts must keep clocks within this margin (NTP). Tighter = smaller replay
// window. A request whose timestamp is outside ±MAX_SKEW_SEC is rejected.
export const MAX_SKEW_SEC = 30;

/**
 * Configured signing secrets, newest first, read as a LIST for zero-downtime
 * rotation: ANY configured secret verifies. Set `SKILLET_WEB_SIGNING_SECRET` to
 * the new value and `SKILLET_WEB_SIGNING_SECRET_PREVIOUS` to the old one during a
 * rotation; once every caller is re-signing with the new value, drop PREVIOUS.
 */
export function configuredSigningSecrets(): string[] {
  const out: string[] = [];
  const primary = process.env.SKILLET_WEB_SIGNING_SECRET;
  const previous = process.env.SKILLET_WEB_SIGNING_SECRET_PREVIOUS;
  if (primary) out.push(primary);
  if (previous) out.push(previous);
  return out;
}

function sha256hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Deterministic JSON: object keys sorted recursively, `undefined`-valued keys
 * dropped (they are never sent on the wire). Primitives serialize as standard
 * JSON. Both signer and verifier feed the same logical body through this, so the
 * MAC is stable without depending on the raw request bytes.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) {
    return '[' + value.map((v) => canonicalJson(v)).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return (
    '{' +
    keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') +
    '}'
  );
}

export interface CanonicalParts {
  method: string;
  path: string;
  querystring: string;
  body: unknown;
  ts: string;
  nonce: string;
}

export function canonicalString(p: CanonicalParts): string {
  return [
    p.method.toUpperCase(),
    // Hash the path too, so no raw variable-length field rides in the
    // '\n'-joined string (defense against any future change in how `path` is
    // sourced introducing a delimiter-collision vector). Mirror in the web signer.
    sha256hex(p.path),
    sha256hex(p.querystring),
    sha256hex(canonicalJson(p.body ?? {})),
    p.ts,
    p.nonce,
  ].join('\n');
}

export function signCanonical(secret: string, canonical: string): string {
  return createHmac('sha256', secret).update(canonical, 'utf8').digest('hex');
}

/**
 * Constant-time compare with NO length branch: hash both inputs to a fixed
 * 32-byte digest first, so `timingSafeEqual` always sees equal-length buffers
 * and the attacker-controlled signature length never gates the comparison (the
 * former code branched on `a.length !== b.length`, a small leak). This is the
 * standard hash-then-compare trick.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const ah = createHash('sha256').update(a, 'utf8').digest();
  const bh = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ah, bh);
}

/**
 * In-memory replay guard.
 *
 * MULTI-INSTANCE LIMITATION: this Map lives in ONE registry process. Horizontally
 * scaled registry instances do NOT share it, so a captured request could be
 * replayed against a *different* instance within the ±MAX_SKEW_SEC window. A
 * shared (e.g. Redis) nonce backend is the documented follow-up — see the deploy
 * notes / README ops section. Entries are pruned by timestamp on each insert so
 * the Map stays bounded by the request rate over the window.
 */
class NonceStore {
  private seen = new Map<string, number>();
  has(nonce: string): boolean {
    return this.seen.has(nonce);
  }
  record(nonce: string, tsSec: number, nowSec: number): void {
    this.prune(nowSec);
    this.seen.set(nonce, tsSec);
  }
  private prune(nowSec: number): void {
    const cutoff = nowSec - MAX_SKEW_SEC;
    for (const [nonce, ts] of this.seen) {
      if (ts < cutoff) this.seen.delete(nonce);
    }
  }
}

const nonceStore = new NonceStore();

export interface VerifyInput {
  method: string;
  /** Raw request URL/target; may include a `?query`. */
  url: string;
  /** Parsed request body (req.body). */
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
  /** Strict dev-auth gate (in-memory DB / SKILLET_ENABLE_DEV_AUTH=1). */
  devAuth: boolean;
  /** Override for tests. */
  nowSec?: number;
}

function headerValue(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * The single verifier used by all three internal surfaces. Returns true iff the
 * request carries a valid, unexpired, non-replayed signature from a configured
 * secret. Never throws.
 */
export function verifyWebInternalSignature(input: VerifyInput): boolean {
  const secrets = configuredSigningSecrets();
  if (secrets.length === 0) {
    // No signing secret configured: fail CLOSED. Open ONLY under the explicit,
    // strict dev-auth gate (in-memory DB for tests, or SKILLET_ENABLE_DEV_AUTH=1)
    // — never on NODE_ENV alone. A production file-DB deployment that forgets the
    // secret stays closed and cannot become an open mint oracle. This unifies the
    // previously-divergent gates: web-routes.ts already used this strict gate;
    // connected-repos.ts used a weaker `NODE_ENV !== 'production'` check — the
    // stricter gate wins.
    return input.devAuth === true;
  }

  const sig = headerValue(input.headers[SIG_HEADER]);
  const tsRaw = headerValue(input.headers[TS_HEADER]);
  const nonce = headerValue(input.headers[NONCE_HEADER]);
  if (!sig || !tsRaw || !nonce) return false;

  const ts = Number(tsRaw);
  if (!Number.isFinite(ts)) return false;
  const nowSec = input.nowSec ?? Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > MAX_SKEW_SEC) return false;

  // Replay: reject a nonce already accepted within the window.
  if (nonceStore.has(nonce)) return false;

  const qIndex = input.url.indexOf('?');
  const path = qIndex === -1 ? input.url : input.url.slice(0, qIndex);
  const querystring = qIndex === -1 ? '' : input.url.slice(qIndex + 1);

  const canonical = canonicalString({
    method: input.method,
    path,
    querystring,
    body: input.body,
    ts: tsRaw,
    nonce,
  });

  // Try every configured secret with no early break so verification time does
  // not reveal which (or how many) secrets are set.
  let matched = false;
  for (const secret of secrets) {
    if (constantTimeEqual(signCanonical(secret, canonical), sig)) matched = true;
  }
  if (!matched) return false;

  // Record only on success so a flood of bogus nonces can't evict legit entries.
  nonceStore.record(nonce, ts, nowSec);
  return true;
}

/**
 * Produce the three signing headers for a request. Mirrors the web BFF signer;
 * exported so the registry test-suite can drive the real verify path with real
 * crypto (no mocks), and so callers needing to sign server-to-server can reuse it.
 */
export function signWebInternalHeaders(opts: {
  secret: string;
  method: string;
  path: string;
  querystring?: string;
  body: unknown;
  ts?: number;
  nonce?: string;
}): Record<string, string> {
  const ts = String(opts.ts ?? Math.floor(Date.now() / 1000));
  const nonce = opts.nonce ?? randomBytes(16).toString('hex');
  const canonical = canonicalString({
    method: opts.method,
    path: opts.path,
    querystring: opts.querystring ?? '',
    body: opts.body,
    ts,
    nonce,
  });
  return {
    [SIG_HEADER]: signCanonical(opts.secret, canonical),
    [TS_HEADER]: ts,
    [NONCE_HEADER]: nonce,
  };
}
