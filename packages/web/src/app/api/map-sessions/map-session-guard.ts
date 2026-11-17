// The save tab's side of the map-session handshake (kit map onboarding, KTD6).
//
// The registry stores only hashes and takes the proof, the binding and the
// signed-in session as plain request values, so nothing there rides ambient
// credentials. These routes are where ambient credentials live: the binding is
// an httpOnly, SameSite=Strict cookie scoped to one session's API path, so page
// script never reads it and a cross-site request never carries it. Bind and
// approve also check the request's Origin and a same-origin request token
// (double-submit: a Strict cookie the status call sets, echoed in a header).
//
// A Strict cookie isn't sent on the page request that comes back from Google's
// sign-in, only on requests the page makes after it loads. So the tab learns
// whether it is bound from GET .../binding, never from the page render.

import { randomBytes, timingSafeEqual } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import {
  KIT_MAP_CODE_RE,
  KIT_MAP_SECRET_RE,
  KIT_MAP_SESSION_ID_RE,
  type KitMapSaveCounts,
} from '@skillet/protocol/kit-map'
import type { MapSaveResult, MapSaveSession, MapSaveStatus } from '@/components/map/save-types'
import { REGISTRY_API } from '@/lib/registry-prefix'
import { registryFetchOriginOrDefault } from '@/lib/registry-origin'
import { isCrossOriginPost } from '@/lib/request-origin'
import { SKILLET_SESSION_COOKIE, skilletSessionCookieOptions } from '@/lib/session-cookie'
import { refreshRegistryWebSession, webSessionIdentity } from '@/lib/registry-session'

export const MAP_BINDING_COOKIE = 'skillet_map_binding'
export const MAP_TOKEN_COOKIE = 'skillet_map_token'
/** save-flow.tsx sends the token under this name; tests/map-save.test.tsx pins the two together. */
export const MAP_TOKEN_HEADER = 'x-skillet-map-token'
/** The header the registry reads the binding from (routes/map-sessions.ts). */
const BINDING_HEADER = 'x-skillet-map-binding'

/** A session waits 10 minutes for its approve; nothing here outlives that by much. */
const COOKIE_MAX_AGE = 15 * 60
const MAX_COUNT = 1_000_000
const COUNT_KEYS = ['backups', 'removals', 'fills', 'merges'] as const

const nowSec = () => Math.floor(Date.now() / 1000)

/** The registry's session id: 128 bits of hex. Anything else is a 404 with no lookup. */
export function isMapSessionId(id: string): boolean {
  return KIT_MAP_SESSION_ID_RE.test(id)
}

/** The proof, the binding and the request token share the registry's secret shape. */
export function isSecret(value: unknown): value is string {
  return typeof value === 'string' && KIT_MAP_SECRET_RE.test(value)
}

/** Scoped to this one session's API routes, so the page itself never carries it. */
function cookieOptions(id: string, maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: `/api/map-sessions/${id}`,
    maxAge,
  }
}

export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } })
}

export const notFound = () => json({ error: 'not_found' }, 404)

// ---------------------------------------------------------------------------
// Origin and the request token
// ---------------------------------------------------------------------------

/**
 * A same-origin browser request. Unlike sign-in's check (lib/request-origin),
 * this fails closed: the save tab's own fetch always sends Sec-Fetch-Site or
 * Origin, so a request with neither isn't the save tab's.
 */
function isSameOrigin(req: Request): boolean {
  if (!req.headers.get('sec-fetch-site') && !req.headers.get('origin')) return false
  return !isCrossOriginPost(req)
}

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/** Bind and approve: this origin, and the token only this origin's script could read. */
export function isOwnRequest(req: NextRequest): boolean {
  if (!isSameOrigin(req)) return false
  const header = req.headers.get(MAP_TOKEN_HEADER)
  const cookie = req.cookies.get(MAP_TOKEN_COOKIE)?.value
  return isSecret(header) && isSecret(cookie) && sameSecret(header, cookie)
}

/** The request token this browser holds for the session, or a fresh one to set. */
export function requestToken(req: NextRequest): { token: string; fresh: boolean } {
  const held = req.cookies.get(MAP_TOKEN_COOKIE)?.value
  if (isSecret(held)) return { token: held, fresh: false }
  return { token: randomBytes(32).toString('base64url'), fresh: true }
}

export function setRequestToken(res: NextResponse, id: string, token: string): void {
  res.cookies.set(MAP_TOKEN_COOKIE, token, cookieOptions(id, COOKIE_MAX_AGE))
}

// ---------------------------------------------------------------------------
// The binding cookie: the binding, and the counts the map's proof carried
// ---------------------------------------------------------------------------

export interface HeldBinding {
  binding: string
  /** What Save will do, kept so the confirm can say it after the Google round trip. */
  counts: KitMapSaveCounts | null
}

/** `<binding>.<backups>.<removals>.<fills>.<merges>`. The counts are display-only. */
function encodeBinding(binding: string, counts: KitMapSaveCounts): string {
  return [binding, ...COUNT_KEYS.map((key) => counts[key])].join('.')
}

export function heldBinding(req: NextRequest): HeldBinding | null {
  const raw = req.cookies.get(MAP_BINDING_COOKIE)?.value
  if (!raw) return null
  const [binding, ...rest] = raw.split('.')
  if (!isSecret(binding)) return null
  const numbers = rest.map(Number)
  const counts =
    numbers.length === COUNT_KEYS.length && numbers.every((n) => Number.isSafeInteger(n) && n >= 0 && n <= MAX_COUNT)
      ? (Object.fromEntries(COUNT_KEYS.map((key, i) => [key, numbers[i]!])) as unknown as KitMapSaveCounts)
      : null
  return { binding, counts }
}

/** Lives no longer than the session: the registry's `expires_at`, capped. */
export function setBinding(res: NextResponse, id: string, binding: string, counts: KitMapSaveCounts, expiresAt: unknown): void {
  const left = typeof expiresAt === 'number' ? expiresAt - nowSec() : COOKIE_MAX_AGE
  const maxAge = Math.max(1, Math.min(COOKIE_MAX_AGE, Math.floor(left)))
  res.cookies.set(MAP_BINDING_COOKIE, encodeBinding(binding, counts), cookieOptions(id, maxAge))
}

export function clearBinding(res: NextResponse, id: string): void {
  res.cookies.set(MAP_BINDING_COOKIE, '', cookieOptions(id, 0))
}

/** The counts a proof message carried: four whole numbers, or null. */
export function readCounts(value: unknown): KitMapSaveCounts | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const rec = value as Record<string, unknown>
  if (Object.keys(rec).some((key) => !(COUNT_KEYS as readonly string[]).includes(key))) return null
  const out: Partial<KitMapSaveCounts> = {}
  for (const key of COUNT_KEYS) {
    const n = rec[key]
    if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0 || n > MAX_COUNT) return null
    out[key] = n
  }
  return out as KitMapSaveCounts
}

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

/** One registry call under the map-session prefix; null when the registry can't be reached. */
export async function registry(
  path: string,
  init: { method?: 'GET' | 'POST'; body?: unknown; binding?: string; session?: string } = {},
): Promise<Response | null> {
  const headers: Record<string, string> = { accept: 'application/json' }
  if (init.body !== undefined) headers['content-type'] = 'application/json'
  if (init.binding) headers[BINDING_HEADER] = init.binding
  if (init.session) headers.authorization = `Bearer ${init.session}`
  try {
    return await fetch(`${registryFetchOriginOrDefault()}${REGISTRY_API}/map-sessions/${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    return null
  }
}

export async function bodyOf(res: Response): Promise<Record<string, unknown>> {
  try {
    const value = (await res.json()) as unknown
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** The registry session this browser signed in with, if any. */
export function sessionToken(req: NextRequest): string | undefined {
  return req.cookies.get(SKILLET_SESSION_COOKIE)?.value
}

/**
 * A signed-in call, healed once if the registry session lapsed while the web
 * session holds, as the /api/registry proxy does. The registry answers 401
 * before its handler runs, so the retry can't approve twice.
 */
export async function asSignedIn(
  req: NextRequest,
  call: (session: string | undefined) => Promise<Response | null>,
): Promise<{ upstream: Response | null; refreshed: string | null }> {
  const session = sessionToken(req)
  const upstream = await call(session)
  if (upstream?.status !== 401) return { upstream, refreshed: null }
  const identity = await webSessionIdentity(req)
  const minted = identity ? await refreshRegistryWebSession(identity, session) : null
  if (!minted) return { upstream, refreshed: null }
  return { upstream: await call(minted.session_token), refreshed: minted.session_token }
}

export function keepSession(res: NextResponse, refreshed: string | null): void {
  if (refreshed) res.cookies.set(SKILLET_SESSION_COOKIE, refreshed, skilletSessionCookieOptions)
}

// ---------------------------------------------------------------------------
// What the save tab reads
// ---------------------------------------------------------------------------

const STATES: readonly MapSaveSession['state'][] = ['pending', 'approved', 'connected', 'applied', 'partial', 'failed', 'expired']

const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)

function readResult(value: unknown): MapSaveResult | null {
  if (typeof value !== 'object' || value === null) return null
  const rec = value as Record<string, unknown>
  if (rec.result !== 'applied' && rec.result !== 'partial' && rec.result !== 'failed') return null
  const skipped = Array.isArray(rec.not_backed_up) ? rec.not_backed_up : []
  return {
    result: rec.result,
    counts: readCounts(rec.counts),
    left: readCounts(rec.left),
    notBackedUp: skipped.flatMap((item) => {
      if (typeof item !== 'object' || item === null) return []
      const { name, reason, file } = item as Record<string, unknown>
      if (typeof name !== 'string' || typeof reason !== 'string' || !KIT_MAP_CODE_RE.test(reason)) return []
      return [{ name, reason, ...(typeof file === 'string' ? { file } : {}) }]
    }),
  }
}

/** The registry's session read, as the save tab draws it. Only the approver's read carries `approved_at`. */
export function toSession(body: Record<string, unknown>): { session: MapSaveSession; approver: boolean } | null {
  const state = body.state as MapSaveSession['state']
  if (!STATES.includes(state) || typeof body.label !== 'string') return null
  return {
    approver: 'approved_at' in body,
    session: {
      state,
      reason: body.reason === 'not-approved' || body.reason === 'code-unused' ? body.reason : null,
      label: body.label,
      expiresAt: num(body.expires_at) ?? 0,
      approvedAt: num(body.approved_at),
      codeDelivered: body.code_delivered === true,
      result: readResult(body.result),
    },
  }
}

export type { MapSaveStatus }
