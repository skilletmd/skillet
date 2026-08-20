// Machine pair codes — one-step CLI attach from a signed-in web session.
//
//   POST /api/v1/connect/codes  → session mints a short-lived code (web UI)
//   POST /api/v1/connect/claim → CLI redeems code → session + device tokens

import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { requireUser } from '../auth/middleware.js'
import { requirePairClaimRateLimit } from '../ratelimit/pair-claim.js'
import {
  normalizeClientKind,
  normalizeClientPlatform,
  normalizeMachineId,
} from '../auth/client-identity.js'
import {
  claimPairCodePrisma,
  getOrCreatePairCodePrisma,
} from '../lib/connect-pair.js'

const PAIR_CODE_TTL_SEC = 300
const PAIR_CODE_RE = /^[A-Z2-9]{8}$/

interface ClaimBody {
  code?: string
  label?: string
  client_kind?: string
  client_platform?: string
  bind_device?: boolean
  device_token?: string
  machine_id?: string
}

function normalizePairCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s_-]+/g, '')
}

function requirePrisma(prisma: PrismaClient | undefined): PrismaClient {
  if (!prisma) {
    throw new Error('sqlite registry store removed; use Prisma / DATABASE_URL')
  }
  return prisma
}

export function registerConnectPairRoutes(
  app: FastifyInstance,
  _db: unknown,
  prismaArg?: PrismaClient,
): void {
  const prisma =
    prismaArg ??
    (app.skilletPrismaAuth && app.skilletPrisma ? app.skilletPrisma : undefined)

  app.post('/api/v1/connect/codes', { preHandler: requireUser() }, async (req, reply) => {
    const db = requirePrisma(prisma)
    const userId = (req.principal as { user_id: string }).user_id
    const now = Math.floor(Date.now() / 1000)
    const { code, expires_at } = await getOrCreatePairCodePrisma(db, userId, now)
    return reply.code(201).send({
      code,
      expires_at,
      ttl_sec: PAIR_CODE_TTL_SEC,
    })
  })

  app.post<{ Body: ClaimBody }>(
    '/api/v1/connect/claim',
    { preHandler: requirePairClaimRateLimit(_db, prisma) },
    async (req, reply) => {
      const db = requirePrisma(prisma)
      const rawCode = req.body?.code
      if (!rawCode || typeof rawCode !== 'string') {
        return reply.code(400).send({ error: 'code_required', message: 'code is required' })
      }
      const code = normalizePairCode(rawCode)
      if (!PAIR_CODE_RE.test(code)) {
        return reply.code(400).send({ error: 'invalid_code', message: 'code must be 8 characters' })
      }

      const now = Math.floor(Date.now() / 1000)
      const bindDevice = req.body?.bind_device !== false
      const rawLabel = req.body?.label?.trim()
      const label = (rawLabel && rawLabel.length > 0 ? rawLabel : 'Connected device').slice(0, 80)
      const result = await claimPairCodePrisma(db, {
        code,
        bindDevice,
        label,
        clientKind: normalizeClientKind(req.body?.client_kind),
        clientPlatform: normalizeClientPlatform(req.body?.client_platform),
        presentedToken:
          typeof req.body?.device_token === 'string' ? req.body.device_token : null,
        machineId: normalizeMachineId(req.body?.machine_id),
        now,
      })
      return reply.code(result.status).send(result.body)
    },
  )
}
