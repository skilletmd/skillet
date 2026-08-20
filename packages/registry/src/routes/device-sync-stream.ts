import type { PrismaClient } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import type { DatabaseSync } from '../db/sqlite-handle.js'
import { requireClass } from '../auth/middleware.js'
import {
  formatDeviceSyncSseData,
  readDeviceSyncSnapshotPrisma,
  subscribeDeviceSyncStream,
} from '../lib/device-sync-stream.js'

const HEARTBEAT_MS = 30_000

function deviceUserId(req: { principal?: unknown }): string | null {
  const p = req.principal as { class?: string; user_id?: string | null } | undefined
  return p && p.class === 'device' ? (p.user_id ?? null) : null
}

function requirePrisma(prisma: PrismaClient | undefined): PrismaClient {
  if (!prisma) {
    throw new Error('sqlite registry store removed; use Prisma / DATABASE_URL')
  }
  return prisma
}

export function registerDeviceSyncStreamRoutes(
  app: FastifyInstance,
  _db: DatabaseSync,
  prismaArg?: PrismaClient,
): void {
  const prisma = requirePrisma(
    prismaArg ?? (app.skilletPrismaAuth && app.skilletPrisma ? app.skilletPrisma : undefined),
  )

  app.get(
    '/api/v1/devices/sync/stream',
    { preHandler: requireClass('device') },
    async (req, reply) => {
      const userId = deviceUserId(req)
      if (!userId) {
        return reply.status(403).send({
          error: 'user_token_required',
          message: 'This stream needs an account-bound device token.',
        })
      }

      reply.hijack()
      // Carry the headers @fastify/cors staged on the reply (onRequest hook)
      // into the raw head — hijack + writeHead otherwise discards them, so the
      // desktop webview would pass preflight and still be unable to read the
      // stream body. Lowercase-normalize before merging: getHeaders() returns
      // lowercase keys while our literals were title-case, and writeHead emits
      // duplicate headers rather than deduplicating across casings. Route
      // headers are applied last so they win on any collision.
      const staged: Record<string, string | number | string[]> = {}
      for (const [name, value] of Object.entries(reply.getHeaders())) {
        if (value !== undefined) staged[name.toLowerCase()] = value
      }
      reply.raw.writeHead(200, {
        ...staged,
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      })

      let lastSeq = -1
      let closed = false
      let heartbeat: ReturnType<typeof setInterval> | undefined

      const pushSnapshot = () => {
        if (closed) return
        void (async () => {
          const snapshot = await readDeviceSyncSnapshotPrisma(prisma, userId)
          if (closed || !snapshot || snapshot.seq === lastSeq) return
          lastSeq = snapshot.seq
          reply.raw.write(formatDeviceSyncSseData({ type: 'sync_required', seq: snapshot.seq }))
        })()
      }

      const unsubscribe = subscribeDeviceSyncStream(userId, (events) => {
        if (closed) return
        for (const event of events) {
          if (event.seq > lastSeq) lastSeq = event.seq
          reply.raw.write(formatDeviceSyncSseData(event))
        }
      })

      pushSnapshot()
      heartbeat = setInterval(pushSnapshot, HEARTBEAT_MS)

      const close = () => {
        if (closed) return
        closed = true
        if (heartbeat) clearInterval(heartbeat)
        unsubscribe()
        reply.raw.end()
      }

      req.raw.on('close', close)
      req.raw.on('error', close)
      // The response side can tear down without a request-side close event
      // (injected test streams, abrupt socket destruction) — without this the
      // heartbeat interval outlives the connection and pins the process.
      reply.raw.on('close', close)
      reply.raw.on('error', close)
    },
  )
}
