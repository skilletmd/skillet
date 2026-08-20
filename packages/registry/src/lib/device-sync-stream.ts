import type { DatabaseSync } from '../db/sqlite-handle.js'
import { Prisma } from '@prisma/client'
import type { DeviceSyncStreamEvent } from '@skillet/protocol'
import type { PrismaDb } from '../db/prisma-client.js'

export type DeviceSyncSnapshot = {
  seq: number
}

type StreamSink = (events: DeviceSyncStreamEvent[]) => void

const streamSinks = new Map<string, Set<StreamSink>>()

const SQLITE_REMOVED = 'sqlite registry store removed; use the *Prisma counterpart'

/** Fail-closed stand-in; characterization uses tests/legacy-sqlite-device-sync-stream.ts. */
export function readDeviceSyncSnapshot(
  _db: DatabaseSync,
  _userId: string,
): DeviceSyncSnapshot | null {
  throw new Error(`${SQLITE_REMOVED}: readDeviceSyncSnapshotPrisma`)
}

/** Prisma async counterpart of {@link readDeviceSyncSnapshot} (U4 sync manifests). */
export async function readDeviceSyncSnapshotPrisma(
  prisma: PrismaDb,
  userId: string,
): Promise<DeviceSyncSnapshot | null> {
  const row = await prisma.users.findUnique({
    where: { id: userId },
    select: { device_sync_seq: true },
  })
  return row ? { seq: row.device_sync_seq } : null
}

function notifyUserStreams(userId: string, events: DeviceSyncStreamEvent[]): void {
  const sinks = streamSinks.get(userId)
  if (!sinks) return
  for (const sink of sinks) sink(events)
}

/** Fan out a sync_required event to live device streams (shared by Prisma + sqlite quarantine). */
export function emitDeviceSyncRequired(userId: string, seq: number): void {
  notifyUserStreams(userId, [{ type: 'sync_required', seq }])
}

/** Fail-closed stand-in; characterization uses tests/legacy-sqlite-device-sync-stream.ts. */
export function bumpUserDeviceSync(
  _db: DatabaseSync,
  _userId: string,
): DeviceSyncSnapshot | null {
  throw new Error(`${SQLITE_REMOVED}: bumpUserDeviceSyncPrisma`)
}

/** Prisma async counterpart of {@link bumpUserDeviceSync} (U4 sync manifests). */
export async function bumpUserDeviceSyncPrisma(
  prisma: PrismaDb,
  userId: string,
): Promise<DeviceSyncSnapshot | null> {
  if (!userId) return null
  try {
    const row = await prisma.users.update({
      where: { id: userId },
      data: { device_sync_seq: { increment: 1 } },
      select: { device_sync_seq: true },
    })
    const snapshot = { seq: row.device_sync_seq }
    emitDeviceSyncRequired(userId, snapshot.seq)
    return snapshot
  } catch (err) {
    // Missing user: Prisma P2025. Treat like the sqlite path (null snapshot).
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      return null
    }
    throw err
  }
}

export function subscribeDeviceSyncStream(userId: string, sink: StreamSink): () => void {
  let sinks = streamSinks.get(userId)
  if (!sinks) {
    sinks = new Set()
    streamSinks.set(userId, sinks)
  }
  sinks.add(sink)
  return () => {
    sinks!.delete(sink)
    if (sinks!.size === 0) streamSinks.delete(userId)
  }
}

export function formatDeviceSyncSseData(event: DeviceSyncStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`
}
