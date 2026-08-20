// Machine pair code mint/claim for the MySQL/Prisma path (U4).
import { randomBytes } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { newId } from '../db/index.js'
import { runPrismaTransaction, type PrismaDb } from '../db/prisma-client.js'
import { DEVICE_TOKEN_TTL_SEC, hashToken, mintToken, scopesFor } from '../auth/tokens.js'
import {
  normalizeClientKind,
  normalizeClientPlatform,
  normalizeMachineId,
  STALE_SIBLING_SEC,
} from '../auth/client-identity.js'
import { mergeDeviceIntoPrisma } from '../auth/device-merge.js'

const PAIR_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const PAIR_CODE_LEN = 8
const PAIR_CODE_TTL_SEC = 300
const MIN_REUSE_REMAINING_SEC = 60

function mintPairCode(): string {
  const bytes = randomBytes(PAIR_CODE_LEN)
  let code = ''
  for (let i = 0; i < PAIR_CODE_LEN; i++) {
    code += PAIR_CODE_CHARS[bytes[i]! % PAIR_CODE_CHARS.length]
  }
  return code
}

function sessionTtlSec(): number {
  const raw = process.env.SKILLET_SESSION_TTL_SEC
  if (!raw) return 14 * 86400
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 14 * 86400
}

function parseKinds(raw: string | null): string[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw) as unknown
    return Array.isArray(v)
      ? v.filter((x): x is string => typeof x === 'string' && x.length > 0)
      : []
  } catch {
    return []
  }
}

function mergeKinds(existing: string | null, kind: string | null): string {
  const set = new Set(parseKinds(existing))
  if (kind) set.add(kind)
  return JSON.stringify([...set])
}

async function insertPairCodePrisma(
  prisma: PrismaDb,
  userId: string,
  now: number,
): Promise<{ code: string; expires_at: number }> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = mintPairCode()
    const expiresAt = now + PAIR_CODE_TTL_SEC
    try {
      await prisma.machine_pair_codes.create({
        data: {
          code,
          user_id: userId,
          created_at: now,
          expires_at: expiresAt,
        },
      })
      return { code, expires_at: expiresAt }
    } catch (err: unknown) {
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: string }).code === 'P2002'
      ) {
        continue
      }
      throw err
    }
  }
  throw new Error('pair_code_collision')
}

export async function getOrCreatePairCodePrisma(
  prisma: PrismaDb,
  userId: string,
  now: number,
): Promise<{ code: string; expires_at: number }> {
  await prisma.machine_pair_codes.deleteMany({
    where: { user_id: userId, expires_at: { lt: now } },
  })

  const live = await prisma.machine_pair_codes.findFirst({
    where: {
      user_id: userId,
      redeemed_at: null,
      expires_at: { gte: now + MIN_REUSE_REMAINING_SEC },
    },
    orderBy: { expires_at: 'desc' },
    select: { code: true, expires_at: true },
  })
  if (live) return live
  return insertPairCodePrisma(prisma, userId, now)
}

export type ClaimPairResult =
  | { ok: true; status: 201; body: Record<string, unknown> }
  | { ok: false; status: number; body: Record<string, unknown> }

export async function claimPairCodePrisma(
  prisma: PrismaClient,
  opts: {
    code: string
    bindDevice: boolean
    label: string
    clientKind: string | null
    clientPlatform: string | null
    presentedToken: string | null
    machineId: string | null
    now: number
  },
): Promise<ClaimPairResult> {
  const row = await prisma.machine_pair_codes.findUnique({
    where: { code: opts.code },
    select: {
      code: true,
      user_id: true,
      expires_at: true,
      redeemed_at: true,
    },
  })
  if (!row) {
    return {
      ok: false,
      status: 404,
      body: { error: 'code_not_found', message: 'Invalid or expired code' },
    }
  }
  if (row.redeemed_at != null) {
    return {
      ok: false,
      status: 409,
      body: { error: 'code_already_used', message: 'This code was already used' },
    }
  }
  if (row.expires_at < opts.now) {
    return {
      ok: false,
      status: 410,
      body: {
        error: 'code_expired',
        message: 'This code has expired — generate a new one on the web',
      },
    }
  }

  const userRow = await prisma.users.findUnique({
    where: { id: row.user_id },
    select: { id: true, handle: true },
  })
  if (!userRow) {
    return { ok: false, status: 500, body: { error: 'user_not_found' } }
  }

  const byToken =
    opts.bindDevice &&
    opts.presentedToken &&
    opts.presentedToken.startsWith('skillet_d_')
      ? await prisma.devices.findFirst({
          where: { token_hash: hashToken(opts.presentedToken) },
          select: { id: true },
        })
      : null

  const byMachine =
    !byToken && opts.bindDevice && opts.machineId
      ? await prisma.devices.findFirst({
          where: {
            user_id: row.user_id,
            machine_id: opts.machineId,
            OR: [
              { last_seen_at: { lt: opts.now - STALE_SIBLING_SEC } },
              {
                last_seen_at: null,
                created_at: { lt: opts.now - STALE_SIBLING_SEC },
              },
            ],
          },
          orderBy: [{ last_seen_at: 'desc' }, { created_at: 'desc' }],
          select: { id: true },
        })
      : null

  const existingDevice = byToken ?? byMachine
  const sessionId = newId()
  const deviceId = opts.bindDevice ? (existingDevice?.id ?? newId()) : null
  const sessionMint = mintToken('session')
  const deviceMint = opts.bindDevice ? mintToken('device') : null

  try {
    await runPrismaTransaction(prisma, async (tx) => {
      const burn = await tx.machine_pair_codes.updateMany({
        where: {
          code: opts.code,
          redeemed_at: null,
          expires_at: { gte: opts.now },
        },
        data: {
          redeemed_at: opts.now,
          redeemed_device_id: deviceId,
        },
      })
      if (burn.count === 0) {
        throw new Error('code_already_used')
      }

      await tx.sessions.create({
        data: {
          id: sessionId,
          user_id: userRow.id,
          token_hash: sessionMint.hash,
          expires_at: opts.now + sessionTtlSec(),
          device_id: deviceId,
        },
      })

      if (deviceId) {
        await tx.sessions.updateMany({
          where: {
            device_id: deviceId,
            id: { not: sessionId },
            revoked_at: null,
          },
          data: { revoked_at: opts.now },
        })
      }

      if (opts.bindDevice && deviceId && deviceMint) {
        if (existingDevice) {
          const current = await tx.devices.findUnique({
            where: { id: deviceId },
            select: {
              client_kind: true,
              client_kinds: true,
              client_platform: true,
              machine_id: true,
            },
          })
          await tx.devices.update({
            where: { id: deviceId },
            data: {
              token_hash: deviceMint.hash,
              user_id: userRow.id,
              label: opts.label,
              client_kind: opts.clientKind ?? current?.client_kind ?? null,
              client_kinds: mergeKinds(current?.client_kinds ?? null, opts.clientKind),
              client_platform: opts.clientPlatform ?? current?.client_platform ?? null,
              machine_id: opts.machineId ?? current?.machine_id ?? null,
              last_seen_at: opts.now,
              // Re-pairing the same machine reclaims a logged-out or idle-expired
              // device: clear the revoke and refresh the sliding deadline (#464).
              revoked_at: null,
              expires_at: opts.now + DEVICE_TOKEN_TTL_SEC,
            },
          })
        } else {
          await tx.devices.create({
            data: {
              id: deviceId,
              token_hash: deviceMint.hash,
              user_id: userRow.id,
              label: opts.label,
              client_kind: opts.clientKind,
              client_kinds: JSON.stringify(opts.clientKind ? [opts.clientKind] : []),
              client_platform: opts.clientPlatform,
              machine_id: opts.machineId,
              expires_at: opts.now + DEVICE_TOKEN_TTL_SEC,
            },
          })
        }

        if (opts.machineId) {
          const losers = await tx.devices.findMany({
            where: {
              user_id: userRow.id,
              machine_id: opts.machineId,
              id: { not: deviceId },
              OR: [
                { last_seen_at: { lt: opts.now - STALE_SIBLING_SEC } },
                {
                  last_seen_at: null,
                  created_at: { lt: opts.now - STALE_SIBLING_SEC },
                },
              ],
            },
            select: { id: true },
          })
          for (const loser of losers) {
            await mergeDeviceIntoPrisma(tx, deviceId, loser.id, opts.now)
          }
        }
      }
    })
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'code_already_used') {
      return {
        ok: false,
        status: 409,
        body: { error: 'code_already_used', message: 'This code was already used' },
      }
    }
    throw err
  }

  return {
    ok: true,
    status: 201,
    body: {
      session_token: sessionMint.secret,
      device_id: deviceId,
      device_token: deviceMint?.secret ?? null,
      user_id: userRow.id,
      handle: userRow.handle,
      scopes: scopesFor('session'),
    },
  }
}

// re-export helpers used by the route for claim body normalization
export {
  normalizeClientKind,
  normalizeClientPlatform,
  normalizeMachineId,
}
