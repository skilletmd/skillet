// Save on a computer that isn't connected yet: the map-session handshake
// (kit map onboarding, KTD6).
//
//   1. create   The CLI opens a session when the person presses Save, with the
//               computer's label and the sha256 (hex) of a one-time proof. It
//               gets back the id, a poll secret and the expiry, 10 minutes out.
//   2. bind     The save tab on skillet.md trades the proof, which it got from
//               its opener and never from a URL, for a binding. The web keeps the
//               binding in its httpOnly cookie. The proof works once.
//   3. approve  The signed-in person, with a username, approves with the
//               binding. The answer is success only. Approval mints a fresh
//               connect code bound to the session for 5 minutes and spends the
//               binding; a refused approve (no username yet) leaves it usable.
//   4. poll     The CLI polls with its secret and gets the code exactly once,
//               then redeems it through /connect/claim with no device token
//               (lib/connect-pair.ts refuses one and marks the session connected).
//   5. result   The CLI reports applied, partial or failed with its new device
//               token, and the approving account reads the session's state.
//
// The registry stores only sha256 hashes of the proof, the poll secret and the
// binding. The Origin checks and the same-origin request token live in the web
// routes that hold the cookie; every call here is either unauthenticated with a
// secret, or bearer-authenticated, so nothing rides ambient credentials.
import { randomBytes, randomUUID } from 'node:crypto'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { PrismaClient, map_sessions } from '@prisma/client'
import {
  KIT_MAP_CODE_RE,
  KIT_MAP_FILE_NAME_MAX,
  KIT_MAP_NAME_MAX,
  KIT_MAP_SECRET_RE,
  KIT_MAP_SESSION_ID_RE,
  parseKitMapSaveCounts,
  type KitMapSaveCounts,
} from '@skillet/protocol/kit-map'
import { runPrismaTransaction, type PrismaDb } from '../db/prisma-client.js'
import { hashToken } from '../auth/tokens.js'
import { constantTimeEqual } from '../auth/web-internal-sig.js'
import { mintMapSessionPairCodePrisma } from './connect-pair.js'

/** How long a session waits for its approve. */
export const MAP_SESSION_TTL_SEC = 600
/** Sessions are swept this long after creation, whatever their state. */
const MAP_SESSION_RETENTION_SEC = 86_400

const SHA256_HEX_RE = /^[0-9a-f]{64}$/
const LABEL_MAX = 80
const MAX_NOT_BACKED_UP = 1_000

export type MapSessionState =
  | 'pending'
  | 'approved'
  | 'connected'
  | 'applied'
  | 'partial'
  | 'failed'
  | 'expired'

export type MapSessionResult = { status: number; body: Record<string, unknown> }

type MapSessionRow = map_sessions

const NOT_FOUND: MapSessionResult = {
  status: 404,
  body: { error: 'map_session_not_found', message: 'No such map session.' },
}
const EXPIRED: MapSessionResult = {
  status: 410,
  body: { error: 'map_session_expired', message: 'This save expired. Press Save in the map again.' },
}

/** True for a well-formed session id; anything else is a 404 without a lookup. */
export function isMapSessionId(id: unknown): id is string {
  return typeof id === 'string' && KIT_MAP_SESSION_ID_RE.test(id)
}

/** Whether `value` hashes to the stored sha256 hex, compared in constant time. */
function sameHash(storedHex: string | null, value: string): boolean {
  if (!storedHex || !SHA256_HEX_RE.test(storedHex)) return false
  // Both sides are lowercase hex, so equal strings are equal digests.
  return constantTimeEqual(storedHex, hashToken(value))
}

/** The proof and the binding are opaque base64url or hex strings. */
function isSecret(value: unknown): value is string {
  return typeof value === 'string' && KIT_MAP_SECRET_RE.test(value)
}

function newSecret(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * Control characters and the bidirectional overrides that could make a
 * confirm show one computer's name while meaning another.
 */
function hasUnsafeChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i)
    if (c < 0x20 || (c >= 0x7f && c <= 0x9f)) return true
    if ((c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069)) return true
  }
  return false
}

/** The computer's label as the confirm shows it, or null when it can't be shown. */
export function normalizeMapSessionLabel(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const label = raw.trim()
  if (label.length === 0 || label.length > LABEL_MAX || hasUnsafeChar(label)) return null
  return label
}

/** Where a session is, from its row alone. */
export function mapSessionState(
  row: MapSessionRow,
  now: number,
): { state: MapSessionState; reason?: 'not-approved' | 'code-unused' } {
  if (row.result === 'applied' || row.result === 'partial' || row.result === 'failed') {
    return { state: row.result }
  }
  if (row.claimed_at != null) return { state: 'connected' }
  if (row.approved_at != null) {
    return (row.code_expires_at ?? 0) < now ? { state: 'expired', reason: 'code-unused' } : { state: 'approved' }
  }
  return row.expires_at < now ? { state: 'expired', reason: 'not-approved' } : { state: 'pending' }
}

export async function createMapSessionPrisma(
  prisma: PrismaDb,
  opts: { label: string; proofHash: string; now: number },
): Promise<{ id: string; poll_secret: string; expires_at: number; ttl_sec: number }> {
  await prisma.map_sessions.deleteMany({
    where: { created_at: { lt: opts.now - MAP_SESSION_RETENTION_SEC } },
  })
  const id = randomBytes(16).toString('hex')
  const pollSecret = newSecret()
  const expiresAt = opts.now + MAP_SESSION_TTL_SEC
  await prisma.map_sessions.create({
    data: {
      id,
      poll_secret_hash: hashToken(pollSecret),
      proof_hash: opts.proofHash,
      label: opts.label,
      created_at: opts.now,
      expires_at: expiresAt,
    },
  })
  return { id, poll_secret: pollSecret, expires_at: expiresAt, ttl_sec: MAP_SESSION_TTL_SEC }
}

/** Trade the one-time proof for a binding tied to this session. */
export async function bindMapSessionPrisma(
  prisma: PrismaDb,
  opts: { id: string; proof: unknown; now: number },
): Promise<MapSessionResult> {
  if (!isSecret(opts.proof)) {
    return { status: 400, body: { error: 'proof_required', message: 'proof is required' } }
  }
  const row = await prisma.map_sessions.findUnique({ where: { id: opts.id } })
  if (!row) return NOT_FOUND
  if (row.approved_at == null && row.expires_at < opts.now) return EXPIRED
  const invalid: MapSessionResult = {
    status: 403,
    body: { error: 'proof_invalid', message: 'This proof is wrong or already used.' },
  }
  if (row.proof_used_at != null || !sameHash(row.proof_hash, opts.proof)) return invalid

  const binding = newSecret()
  const won = await prisma.map_sessions.updateMany({
    where: { id: opts.id, proof_used_at: null, approved_at: null, expires_at: { gte: opts.now } },
    data: { proof_used_at: opts.now, binding_hash: hashToken(binding) },
  })
  if (won.count === 0) return invalid
  return { status: 200, body: { binding, expires_at: row.expires_at } }
}

class LostApproveRace extends Error {}

/**
 * Approve with the binding. Success only: the fresh code goes to the poller and
 * nowhere else. The checks run in the order the save tab can act on them.
 */
export async function approveMapSessionPrisma(
  prisma: PrismaClient,
  opts: { id: string; binding: unknown; userId: string; handle: string | null; now: number },
): Promise<MapSessionResult> {
  const refusal = (row: MapSessionRow | null): MapSessionResult | null => {
    if (!row) return NOT_FOUND
    if (row.approved_at != null) {
      return {
        status: 409,
        body: { error: 'map_session_already_approved', message: 'This save is already approved.' },
      }
    }
    if (row.expires_at < opts.now) return EXPIRED
    if (opts.binding === undefined || opts.binding === null || opts.binding === '') {
      return {
        status: 403,
        body: { error: 'binding_required', message: 'Open this page from Save in the map.' },
      }
    }
    if (!isSecret(opts.binding) || !sameHash(row.binding_hash, opts.binding)) {
      return {
        status: 403,
        body: { error: 'binding_invalid', message: 'This page is not the one Save opened.' },
      }
    }
    if (!opts.handle) {
      return {
        status: 409,
        body: { error: 'username_required', message: 'Pick a username, then save.' },
      }
    }
    return null
  }

  const row = await prisma.map_sessions.findUnique({ where: { id: opts.id } })
  const refused = refusal(row)
  if (refused) return refused

  try {
    await runPrismaTransaction(prisma, async (tx) => {
      const minted = await mintMapSessionPairCodePrisma(tx, opts.userId, opts.id, opts.now)
      const won = await tx.map_sessions.updateMany({
        where: {
          id: opts.id,
          approved_at: null,
          binding_hash: row!.binding_hash,
          expires_at: { gte: opts.now },
        },
        data: {
          approved_at: opts.now,
          approved_by_user_id: opts.userId,
          binding_hash: null,
          pair_code: minted.code,
          code_expires_at: minted.expires_at,
        },
      })
      // A second click got here first; roll the code back with this attempt.
      if (won.count === 0) throw new LostApproveRace()
    })
  } catch (err) {
    if (!(err instanceof LostApproveRace)) throw err
    const again = await prisma.map_sessions.findUnique({ where: { id: opts.id } })
    return refusal(again) ?? EXPIRED
  }
  return { status: 200, body: { ok: true } }
}

/** The CLI's wait: 202 until approved, then the code exactly once. */
export async function pollMapSessionPrisma(
  prisma: PrismaDb,
  opts: { id: string; secret: unknown; now: number },
): Promise<MapSessionResult> {
  const row = await prisma.map_sessions.findUnique({ where: { id: opts.id } })
  if (!row) return NOT_FOUND
  if (!isSecret(opts.secret) || !sameHash(row.poll_secret_hash, opts.secret)) {
    return { status: 403, body: { error: 'poll_secret_invalid', message: 'Wrong poll secret.' } }
  }
  if (row.approved_at == null) {
    if (row.expires_at < opts.now) return EXPIRED
    // `bound`: the save tab traded the proof, so the person is signing in.
    return { status: 202, body: { state: 'pending', bound: row.proof_used_at != null, expires_at: row.expires_at } }
  }
  const codeExpired = (row.code_expires_at ?? 0) < opts.now
  const delivered: MapSessionResult = {
    status: 409,
    body: { error: 'code_already_delivered', message: 'The code for this save was already picked up.' },
  }
  if (row.code_delivered_at != null) return row.claimed_at == null && codeExpired ? EXPIRED : delivered
  if (codeExpired || !row.pair_code) return EXPIRED

  const won = await prisma.map_sessions.updateMany({
    where: { id: opts.id, code_delivered_at: null },
    data: { code_delivered_at: opts.now },
  })
  if (won.count === 0) return delivered
  return { status: 200, body: { code: row.pair_code, expires_at: row.code_expires_at } }
}

function parseResultJson(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as unknown
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * The session's state for the save tab. Before approval the binding holder may
 * read it (the confirm names the computer); after, the approving account.
 */
export async function readMapSessionPrisma(
  prisma: PrismaDb,
  opts: { id: string; binding: unknown; userId: string | null; now: number },
): Promise<MapSessionResult> {
  const row = await prisma.map_sessions.findUnique({ where: { id: opts.id } })
  if (!row) return NOT_FOUND
  const approver = opts.userId != null && row.approved_by_user_id === opts.userId
  const bound = !approver && isSecret(opts.binding) && sameHash(row.binding_hash, opts.binding)
  if (!approver && !bound) {
    return { status: 403, body: { error: 'binding_required', message: 'Open this page from Save in the map.' } }
  }
  const { state, reason } = mapSessionState(row, opts.now)
  const body: Record<string, unknown> = {
    id: row.id,
    state,
    ...(reason ? { reason } : {}),
    label: row.label,
    expires_at: row.expires_at,
  }
  if (approver) {
    body.approved_at = row.approved_at
    body.code_expires_at = row.code_expires_at
    body.code_delivered = row.code_delivered_at != null
    body.connected_at = row.claimed_at
    body.result = parseResultJson(row.result_json)
    body.result_at = row.result_at
  }
  return { status: 200, body }
}

export interface MapSessionReport {
  result: 'applied' | 'partial' | 'failed'
  reason?: string
  /** What Save did on the computer. */
  counts?: KitMapSaveCounts
  /** What's left for the next run. */
  left?: KitMapSaveCounts
  /** Skills that didn't back up and why, by name. Never a path. */
  not_backed_up?: Array<{ name: string; reason: string; file?: string }>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function onlyFields(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.entries(value).every(([key, field]) => field === undefined || allowed.includes(key))
}

function oneLine(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim() !== '' && value.length <= max && !hasUnsafeChar(value)
}

/** The CLI's report, or null when anything in it is malformed or out of place. */
export function parseMapSessionReport(value: unknown): MapSessionReport | null {
  if (!isRecord(value) || !onlyFields(value, ['result', 'reason', 'counts', 'left', 'not_backed_up'])) return null
  const { result } = value
  if (result !== 'applied' && result !== 'partial' && result !== 'failed') return null
  const report: MapSessionReport = { result }
  if (value.reason !== undefined) {
    if (typeof value.reason !== 'string' || !KIT_MAP_CODE_RE.test(value.reason)) return null
    report.reason = value.reason
  }
  for (const key of ['counts', 'left'] as const) {
    if (value[key] === undefined) continue
    const counts = parseKitMapSaveCounts(value[key])
    if (!counts) return null
    report[key] = counts
  }
  if (value.not_backed_up !== undefined) {
    const list = value.not_backed_up
    if (!Array.isArray(list) || list.length > MAX_NOT_BACKED_UP) return null
    const skipped: NonNullable<MapSessionReport['not_backed_up']> = []
    for (const item of list) {
      if (!isRecord(item) || !onlyFields(item, ['name', 'reason', 'file'])) return null
      if (!oneLine(item.name, KIT_MAP_NAME_MAX)) return null
      if (typeof item.reason !== 'string' || !KIT_MAP_CODE_RE.test(item.reason)) return null
      const entry: { name: string; reason: string; file?: string } = { name: item.name, reason: item.reason }
      if (item.file !== undefined) {
        // One file's name, never a folder in it.
        if (!oneLine(item.file, KIT_MAP_FILE_NAME_MAX) || /[\\/]/.test(item.file) || item.file === '.' || item.file === '..') {
          return null
        }
        entry.file = item.file
      }
      skipped.push(entry)
    }
    report.not_backed_up = skipped
  }
  return report
}

/** The CLI reports how Save went, with the device token the session's code minted. */
export async function reportMapSessionPrisma(
  prisma: PrismaDb,
  opts: { id: string; deviceId: string; report: unknown; now: number },
): Promise<MapSessionResult> {
  const row = await prisma.map_sessions.findUnique({ where: { id: opts.id } })
  if (!row) return NOT_FOUND
  if (row.claimed_at == null || row.device_id == null || row.device_id !== opts.deviceId) {
    return {
      status: 403,
      body: { error: 'not_this_computer', message: 'Only the computer this save connected reports on it.' },
    }
  }
  const report = parseMapSessionReport(opts.report)
  if (!report) {
    return { status: 422, body: { error: 'invalid_result', message: 'The result is malformed.' } }
  }
  await prisma.map_sessions.update({
    where: { id: opts.id },
    data: { result: report.result, result_json: JSON.stringify(report), result_at: opts.now },
  })
  return { status: 200, body: { ok: true } }
}

// ---------------------------------------------------------------------------
// Per-address limits for the two unauthenticated routes
// ---------------------------------------------------------------------------

export type MapSessionAttemptKind = 'create' | 'poll'

interface AttemptLimits {
  perMinute: number
  /** 0: no hourly cap. */
  perHour: number
  globalPerMinute: number
}

/**
 * Create is a person pressing Save; poll is the CLI waiting every 2 seconds for
 * at most 15 minutes, so its cap leaves room for a few computers behind one
 * address. Both secrets are 256-bit, so the caps bound load, not guessing.
 */
const ATTEMPT_LIMITS: Record<MapSessionAttemptKind, AttemptLimits> = {
  create: { perMinute: 10, perHour: 60, globalPerMinute: 300 },
  poll: { perMinute: 240, perHour: 0, globalPerMinute: 6000 },
}

function retryAfter(oldest: number | undefined, now: number, windowSec: number): number {
  if (oldest == null) return windowSec
  const wait = oldest + windowSec - now
  return wait < 1 ? 1 : wait
}

/** Fastify preHandler, keyed on `req.ip` like requirePairClaimRateLimit. */
export function requireMapSessionRateLimit(prisma: PrismaDb | undefined, kind: MapSessionAttemptKind) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!prisma) throw new Error('sqlite registry store removed; use Prisma / DATABASE_URL')
    const ip = req.ip || 'unknown'
    const cfg = ATTEMPT_LIMITS[kind]
    const now = Math.floor(Date.now() / 1000)
    const minute = now - 60
    const hour = now - 3600

    const [minuteCount, hourCount, globalCount] = await Promise.all([
      prisma.map_session_attempts.count({ where: { kind, ip, attempted_at: { gte: minute } } }),
      cfg.perHour > 0
        ? prisma.map_session_attempts.count({ where: { kind, ip, attempted_at: { gte: hour } } })
        : Promise.resolve(0),
      prisma.map_session_attempts.count({ where: { kind, attempted_at: { gte: minute } } }),
    ])
    await prisma.map_session_attempts.create({ data: { id: randomUUID(), kind, ip, attempted_at: now } })
    // Rows past the hour count toward nothing. Every save starts with a create,
    // so pruning there keeps the table small without a delete on every poll.
    if (kind === 'create') await prisma.map_session_attempts.deleteMany({ where: { attempted_at: { lt: hour } } })

    const limited = async (scope: string, limit: number, wait: number): Promise<void> => {
      reply.header('Retry-After', String(wait))
      await reply.code(429).send({ error: 'rate_limited', scope, limit, retry_after_seconds: wait })
    }
    if (globalCount >= cfg.globalPerMinute) {
      req.log.warn({ kind, globalCount, limit: cfg.globalPerMinute }, 'map-session global rate limit tripped')
      return limited('global', cfg.globalPerMinute, 60)
    }
    if (minuteCount >= cfg.perMinute) {
      const oldest = await prisma.map_session_attempts.findFirst({
        where: { kind, ip, attempted_at: { gte: minute } },
        orderBy: { attempted_at: 'asc' },
        select: { attempted_at: true },
      })
      return limited('minute', cfg.perMinute, retryAfter(oldest?.attempted_at, now, 60))
    }
    if (cfg.perHour > 0 && hourCount >= cfg.perHour) {
      const oldest = await prisma.map_session_attempts.findFirst({
        where: { kind, ip, attempted_at: { gte: hour } },
        orderBy: { attempted_at: 'asc' },
        select: { attempted_at: true },
      })
      return limited('hour', cfg.perHour, retryAfter(oldest?.attempted_at, now, 3600))
    }
  }
}

/** sha256 hex, the shape `proof_hash` takes on create. */
export function isProofHash(value: unknown): value is string {
  return typeof value === 'string' && SHA256_HEX_RE.test(value)
}
