// Save on a computer that isn't connected yet (kit map onboarding, KTD6). The
// handshake itself lives in lib/map-sessions.ts; these routes only read the
// request and send what it decides.
//
//   POST /api/v1/map-sessions             CLI opens a session (no auth, rate-limited)
//   POST /api/v1/map-sessions/:id/bind    save tab trades the proof for a binding
//   POST /api/v1/map-sessions/:id/approve signed-in person approves with the binding
//   POST /api/v1/map-sessions/:id/poll    CLI waits for the code with its secret (rate-limited)
//   GET  /api/v1/map-sessions/:id         state, for the binding holder or the approver
//   POST /api/v1/map-sessions/:id/result  CLI reports how Save went, with its device token

import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { requireClass, requireSession } from '../auth/middleware.js'
import {
  approveMapSessionPrisma,
  bindMapSessionPrisma,
  createMapSessionPrisma,
  isMapSessionId,
  isProofHash,
  normalizeMapSessionLabel,
  pollMapSessionPrisma,
  readMapSessionPrisma,
  reportMapSessionPrisma,
  requireMapSessionRateLimit,
} from '../lib/map-sessions.js'

/** The header the web's binding-status route forwards the cookie's value in. */
export const MAP_SESSION_BINDING_HEADER = 'x-skillet-map-binding'

const SMALL_BODY = 16 * 1024
const REPORT_BODY = 1024 * 1024

interface IdParams {
  id: string
}

function requirePrisma(prisma: PrismaClient | undefined): PrismaClient {
  if (!prisma) throw new Error('sqlite registry store removed; use Prisma / DATABASE_URL')
  return prisma
}

const nowSec = (): number => Math.floor(Date.now() / 1000)

const notFound = { error: 'map_session_not_found', message: 'No such map session.' }

export function registerMapSessionRoutes(app: FastifyInstance, prismaArg?: PrismaClient): void {
  const prisma =
    prismaArg ?? (app.skilletPrismaAuth && app.skilletPrisma ? app.skilletPrisma : undefined)

  app.post<{ Body: { label?: unknown; proof_hash?: unknown } }>(
    '/api/v1/map-sessions',
    { preHandler: requireMapSessionRateLimit(prisma, 'create'), bodyLimit: SMALL_BODY },
    async (req, reply) => {
      const db = requirePrisma(prisma)
      const label = normalizeMapSessionLabel(req.body?.label)
      if (!label) {
        return reply.code(400).send({
          error: 'invalid_label',
          message: "label is required: the computer's name, one line, at most 80 characters",
        })
      }
      const proofHash = req.body?.proof_hash
      if (!isProofHash(proofHash)) {
        return reply.code(400).send({
          error: 'invalid_proof_hash',
          message: 'proof_hash is the lowercase hex sha256 of the proof',
        })
      }
      const created = await createMapSessionPrisma(db, { label, proofHash, now: nowSec() })
      return reply.code(201).send(created)
    },
  )

  app.post<{ Params: IdParams; Body: { proof?: unknown } }>(
    '/api/v1/map-sessions/:id/bind',
    { bodyLimit: SMALL_BODY },
    async (req, reply) => {
      if (!isMapSessionId(req.params.id)) return reply.code(404).send(notFound)
      const result = await bindMapSessionPrisma(requirePrisma(prisma), {
        id: req.params.id,
        proof: req.body?.proof,
        now: nowSec(),
      })
      return reply.code(result.status).send(result.body)
    },
  )

  app.post<{ Params: IdParams; Body: { binding?: unknown } }>(
    '/api/v1/map-sessions/:id/approve',
    { preHandler: requireSession, bodyLimit: SMALL_BODY },
    async (req, reply) => {
      if (!isMapSessionId(req.params.id)) return reply.code(404).send(notFound)
      const principal = req.principal as { user_id: string; handle: string | null }
      const result = await approveMapSessionPrisma(requirePrisma(prisma), {
        id: req.params.id,
        binding: req.body?.binding,
        userId: principal.user_id,
        handle: principal.handle,
        now: nowSec(),
      })
      return reply.code(result.status).send(result.body)
    },
  )

  app.post<{ Params: IdParams; Body: { secret?: unknown } }>(
    '/api/v1/map-sessions/:id/poll',
    { preHandler: requireMapSessionRateLimit(prisma, 'poll'), bodyLimit: SMALL_BODY },
    async (req, reply) => {
      if (!isMapSessionId(req.params.id)) return reply.code(404).send(notFound)
      const result = await pollMapSessionPrisma(requirePrisma(prisma), {
        id: req.params.id,
        secret: req.body?.secret,
        now: nowSec(),
      })
      return reply.code(result.status).send(result.body)
    },
  )

  app.get<{ Params: IdParams }>('/api/v1/map-sessions/:id', async (req, reply) => {
    if (!isMapSessionId(req.params.id)) return reply.code(404).send(notFound)
    const p = req.principal
    const userId = p?.class === 'session' ? p.user_id : p?.class === 'device' ? p.user_id : null
    const result = await readMapSessionPrisma(requirePrisma(prisma), {
      id: req.params.id,
      binding: req.headers[MAP_SESSION_BINDING_HEADER],
      userId,
      now: nowSec(),
    })
    reply.header('Cache-Control', 'private, no-store')
    return reply.code(result.status).send(result.body)
  })

  app.post<{ Params: IdParams; Body: unknown }>(
    '/api/v1/map-sessions/:id/result',
    { preHandler: requireClass('device'), bodyLimit: REPORT_BODY },
    async (req, reply) => {
      if (!isMapSessionId(req.params.id)) return reply.code(404).send(notFound)
      const principal = req.principal as { device_id: string }
      const result = await reportMapSessionPrisma(requirePrisma(prisma), {
        id: req.params.id,
        deviceId: principal.device_id,
        report: req.body,
        now: nowSec(),
      })
      return reply.code(result.status).send(result.body)
    },
  )
}
