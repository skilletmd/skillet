import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import type { DatabaseSync } from '../db/sqlite-handle.js'
import { requireSession } from '../auth/middleware.js'
import {
  formatSseData,
  readAttentionSnapshot,
  readAttentionSnapshotPrisma,
  subscribeAttentionStream,
} from '../lib/attention.js'

const HEARTBEAT_MS = 30_000

function sessionUserId(req: { principal?: unknown }): string | null {
  const p = req.principal as { class?: string; user_id?: string } | undefined
  return p && p.class === 'session' ? (p.user_id ?? null) : null
}

export function registerAttentionStreamRoutes(
  app: FastifyInstance,
  db: DatabaseSync,
  prisma?: PrismaClient,
): void {
  // GET /me/notifications/attention — cheap cursor snapshot for debugging and reconnect.
  app.get('/me/notifications/attention', { preHandler: requireSession }, async (req, reply) => {
    const userId = sessionUserId(req)
    if (!userId) return reply.status(401).send({ error: 'unauthorized' })
    const snapshot = prisma
      ? await readAttentionSnapshotPrisma(prisma, userId)
      : readAttentionSnapshot(db, userId)
    if (!snapshot) return reply.status(404).send({ error: 'not_found' })
    return reply.send({
      seq: snapshot.seq,
      unread_count: snapshot.unread_count,
      pending_updates_count: snapshot.pending_updates_count,
    })
  })

  // GET /me/events/stream — session-authenticated SSE attention channel.
  app.get('/me/events/stream', { preHandler: requireSession }, async (req, reply) => {
    const userId = sessionUserId(req)
    if (!userId) return reply.status(401).send({ error: 'unauthorized' })

    reply.hijack()
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    })

    let lastSeq = -1
    let closed = false
    let heartbeat: ReturnType<typeof setInterval> | undefined

    const pushSnapshot = async () => {
      if (closed) return
      const snapshot = prisma
        ? await readAttentionSnapshotPrisma(prisma, userId)
        : readAttentionSnapshot(db, userId)
      if (!snapshot || snapshot.seq === lastSeq) return
      lastSeq = snapshot.seq
      reply.raw.write(
        formatSseData({
          type: 'attention',
          social: snapshot.unread_count,
          updates: snapshot.pending_updates_count,
          seq: snapshot.seq,
        }),
      )
    }

    const unsubscribe = subscribeAttentionStream(userId, (events) => {
      if (closed) return
      for (const event of events) {
        if (event.seq > lastSeq) lastSeq = event.seq
        reply.raw.write(formatSseData(event))
      }
    })

    pushSnapshot()
    heartbeat = setInterval(() => {
      void pushSnapshot()
    }, HEARTBEAT_MS)

    const close = () => {
      if (closed) return
      closed = true
      if (heartbeat) clearInterval(heartbeat)
      unsubscribe()
      reply.raw.end()
    }

    req.raw.on('close', close)
    req.raw.on('error', close)
  })
}
