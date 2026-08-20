import 'server-only'

import { createHash, createHmac, randomBytes } from 'node:crypto'

/**
 * Web BFF request signing — SIGNING side. (U2 / OSS-hardening)
 *
 * The trusted web BFF signs every server-to-server call to the registry's
 * internal surfaces (session mint, session refresh, identity link, repo connect)
 * with an HMAC over a canonical string. This replaces the former raw shared
 * secret presented as a bearer/header — holding the secret alone no longer lets
 * anyone mint a session, because each call must be freshly signed, is timestamped
 * (±30s on the registry), and is single-use (nonce replay rejected).
 *
 * The registry verifier (packages/registry/src/auth/web-internal-sig.ts) MUST
 * produce the exact same canonical bytes. The two implementations are mirrored
 * deliberately — the byte format is the contract; if they ever drift, login,
 * session-refresh, and repo-connect break. Keep them in lockstep.
 *
 *   canonical =
 *     METHOD            \n
 *     sha256hex(PATH)   \n   (no query string)
 *     sha256hex(QUERY)  \n   (query string sans '?'; '' today → fixed hash)
 *     sha256hex(BODY)   \n   (BODY = canonicalJson of the body fields below)
 *     TS                \n   (unix seconds)
 *     NONCE
 */

const SIG_HEADER = 'x-skillet-web-sig'
const TS_HEADER = 'x-skillet-web-ts'
const NONCE_HEADER = 'x-skillet-web-nonce'

function sha256hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

/**
 * Deterministic JSON: object keys sorted recursively, `undefined`-valued keys
 * dropped (they are never sent on the wire). Must match the registry's
 * canonicalJson byte-for-byte.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) {
    return '[' + value.map((v) => canonicalJson(v)).join(',') + ']'
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}'
}

function canonicalString(p: {
  method: string
  path: string
  querystring: string
  body: unknown
  ts: string
  nonce: string
}): string {
  return [
    p.method.toUpperCase(),
    // Hashed to mirror the registry verifier (no raw variable-length field in the
    // '\n'-joined string). Keep in lockstep with web-internal-sig.ts.
    sha256hex(p.path),
    sha256hex(p.querystring),
    sha256hex(canonicalJson(p.body ?? {})),
    p.ts,
    p.nonce,
  ].join('\n')
}

/**
 * Build the three signing headers for an internal registry call.
 *
 * @param path  The registry path WITHOUT query string and WITHOUT origin, exactly
 *              as the registry sees it (e.g. `/api/v1/auth/web/session`).
 * @param body  The SAME object that will be `JSON.stringify`-ed as the request
 *              body. The signature covers the body fields, so the caller must send
 *              this exact object.
 */
export function signWebInternalHeaders(opts: {
  secret: string
  method: string
  path: string
  querystring?: string
  body: unknown
}): Record<string, string> {
  const ts = String(Math.floor(Date.now() / 1000))
  const nonce = randomBytes(16).toString('hex')
  const canonical = canonicalString({
    method: opts.method,
    path: opts.path,
    querystring: opts.querystring ?? '',
    body: opts.body,
    ts,
    nonce,
  })
  return {
    [SIG_HEADER]: createHmac('sha256', opts.secret).update(canonical, 'utf8').digest('hex'),
    [TS_HEADER]: ts,
    [NONCE_HEADER]: nonce,
  }
}
