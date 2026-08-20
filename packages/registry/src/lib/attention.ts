/**
 * Attention cursor + SSE fan-out.
 *
 * Sqlite dual-path bodies were removed in U4. Residual callers outside this
 * unit (skills / proposals / approvals / scanner) get fail-closed stubs;
 * characterization uses tests/legacy-sqlite-attention.ts. MySQL uses *Prisma.
 */
import type { DatabaseSync } from '../db/sqlite-handle.js'
import type { AttentionStreamEvent } from '@skillet/protocol'
import type { PrismaDb } from '../db/prisma-client.js'
import { pendingTargetsPrisma } from '../lib/pending-update-targets.js'
import {
  notificationsSeenAtPrisma,
  unreadNotificationCountPrisma,
  viewerHandleForUserPrisma,
} from '../lib/notification-events.js'

export type AttentionSnapshot = {
  seq: number
  unread_count: number
  pending_updates_count: number
}

export type SocialAttentionKind =
  | 'followed_you'
  | 'subscribed_kit'
  | 'subscribed_author'
  | 'installed_skill'

export type AttentionSignal =
  | { kind: 'social'; social: { kind: SocialAttentionKind; actor: string; at: number } }
  | { kind: 'pending_increased' }

type StreamSink = (events: AttentionStreamEvent[]) => void

const streamSinks = new Map<string, Set<StreamSink>>()

const SQLITE_REMOVED = 'sqlite registry store removed; use the *Prisma counterpart'

/** Fail-closed stand-in for residual dual-path callers outside U4. */
export function readAttentionSnapshot(
  _db: DatabaseSync,
  _userId: string,
): AttentionSnapshot | null {
  throw new Error(`${SQLITE_REMOVED}: readAttentionSnapshotPrisma`)
}

/** Prisma async counterpart of {@link readAttentionSnapshot}. */
export async function readAttentionSnapshotPrisma(
  prisma: PrismaDb,
  userId: string,
): Promise<AttentionSnapshot | null> {
  const row = await prisma.users.findUnique({
    where: { id: userId },
    select: { attention_seq: true },
  })
  if (!row) return null
  const handle = await viewerHandleForUserPrisma(prisma, userId)
  const seen = await notificationsSeenAtPrisma(prisma, userId)
  const unread = handle ? await unreadNotificationCountPrisma(prisma, handle, userId, seen) : 0
  const pending = (await pendingTargetsPrisma(prisma, userId)).length
  return {
    seq: row.attention_seq,
    unread_count: unread,
    pending_updates_count: pending,
  }
}

function notifyUserStreams(userId: string, events: AttentionStreamEvent[]): void {
  const sinks = streamSinks.get(userId)
  if (!sinks) return
  for (const sink of sinks) sink(events)
}

/** Fail-closed stand-in for residual dual-path callers outside U4. */
export function bumpUserAttention(
  _db: DatabaseSync,
  _userId: string,
  _signal?: AttentionSignal,
): void {
  throw new Error(`${SQLITE_REMOVED}: bumpUserAttentionPrisma`)
}

/** Fail-closed stand-in for residual dual-path callers outside U4. */
export function bumpAttentionForHandle(
  _db: DatabaseSync,
  _handle: string,
  _signal?: AttentionSignal,
): void {
  throw new Error(`${SQLITE_REMOVED}: bumpAttentionForHandlePrisma`)
}

/** Prisma counterpart of {@link bumpUserAttention}: bump seq + fan out SSE. */
export async function bumpUserAttentionPrisma(
  prisma: PrismaDb,
  userId: string,
  signal?: AttentionSignal,
): Promise<void> {
  if (!userId) return
  await prisma.users.update({
    where: { id: userId },
    data: { attention_seq: { increment: 1 } },
  })
  const snapshot = await readAttentionSnapshotPrisma(prisma, userId)
  if (!snapshot) return

  const events: AttentionStreamEvent[] = []
  if (signal?.kind === 'social') {
    events.push({
      type: 'social_event',
      kind: signal.social.kind,
      actor: signal.social.actor,
      at: signal.social.at,
      seq: snapshot.seq,
    })
  } else if (signal?.kind === 'pending_increased') {
    events.push({ type: 'pending_increased', seq: snapshot.seq })
  }
  events.push({
    type: 'attention',
    social: snapshot.unread_count,
    updates: snapshot.pending_updates_count,
    seq: snapshot.seq,
  })
  notifyUserStreams(userId, events)
}

/**
 * Prisma counterpart of {@link bumpAttentionForHandle}. Advances attention_seq
 * and fans out to in-process SSE sinks the same way the sqlite path does.
 */
export async function bumpAttentionForHandlePrisma(
  prisma: PrismaDb,
  handle: string,
  signal?: AttentionSignal,
): Promise<void> {
  const user = await prisma.users.findFirst({
    where: { handle },
    select: { id: true },
  })
  if (!user) return
  await bumpUserAttentionPrisma(prisma, user.id, signal)
}

/** Fail-closed stand-in for residual dual-path callers outside U4. */
export function subscriberUserIdsForSkill(_db: DatabaseSync, _skillId: string): string[] {
  throw new Error(`${SQLITE_REMOVED}: subscriberUserIdsForSkillPrisma`)
}

/** Fail-closed stand-in for residual dual-path callers outside U4. */
export function bumpAttentionForSkillSubscribers(_db: DatabaseSync, _skillId: string): void {
  throw new Error(`${SQLITE_REMOVED}: bumpAttentionForSkillSubscribersPrisma`)
}

/** Prisma counterpart of {@link subscriberUserIdsForSkill}. */
export async function subscriberUserIdsForSkillPrisma(
  prisma: PrismaDb,
  skillId: string,
): Promise<string[]> {
  const skill = await prisma.skills.findUnique({
    where: { id: skillId },
    select: { author_id: true },
  })
  if (!skill) return []

  const [kitSubs, authorSubs] = await Promise.all([
    prisma.kit_subscriptions.findMany({
      where: {
        kind: 'kit',
        kits: { kit_skills: { some: { skill_id: skillId } } },
      },
      select: { user_id: true },
    }),
    prisma.kit_subscriptions.findMany({
      where: { kind: 'author', author_id: skill.author_id },
      select: { user_id: true },
    }),
  ])

  return [...new Set([...kitSubs, ...authorSubs].map((r) => r.user_id))]
}

/** Prisma counterpart of {@link bumpAttentionForSkillSubscribers}. */
export async function bumpAttentionForSkillSubscribersPrisma(
  prisma: PrismaDb,
  skillId: string,
): Promise<void> {
  for (const userId of await subscriberUserIdsForSkillPrisma(prisma, skillId)) {
    await bumpUserAttentionPrisma(prisma, userId, { kind: 'pending_increased' })
  }
}

/** Fail-closed stand-in for residual dual-path callers outside U4. */
export function proposalRecipientUserIds(
  _db: DatabaseSync,
  _skillId: string,
  _excludeHandle: string | null,
): string[] {
  throw new Error(`${SQLITE_REMOVED}: proposalRecipientUserIdsPrisma`)
}

/** Prisma counterpart of {@link proposalRecipientUserIds}. */
export async function proposalRecipientUserIdsPrisma(
  prisma: PrismaDb,
  skillId: string,
  excludeHandle: string | null,
): Promise<string[]> {
  const skill = await prisma.skills.findUnique({
    where: { id: skillId },
    select: { author_id: true, org_id: true },
  })
  if (!skill) return []
  const ids = new Set<string>()
  if (skill.org_id) {
    const admins = await prisma.organization_members.findMany({
      where: {
        org_id: skill.org_id,
        accepted_at: { not: null },
        role: { in: ['owner', 'admin'] },
      },
      select: { user_id: true },
    })
    for (const a of admins) ids.add(a.user_id)
  } else {
    const owner = await prisma.users.findFirst({
      where: { handle: skill.author_id },
      select: { id: true },
    })
    if (owner) ids.add(owner.id)
  }
  if (excludeHandle) {
    const exclude = await prisma.users.findFirst({
      where: { handle: excludeHandle },
      select: { id: true },
    })
    if (exclude) ids.delete(exclude.id)
  }
  return [...ids]
}

/** Fail-closed stand-in for residual dual-path callers outside U4. */
export function bumpAttentionForProposalRecipients(
  _db: DatabaseSync,
  _skillId: string,
  _proposerHandle: string | null,
): void {
  throw new Error(`${SQLITE_REMOVED}: bumpAttentionForProposalRecipientsPrisma`)
}

/** Prisma counterpart of {@link bumpAttentionForProposalRecipients}. */
export async function bumpAttentionForProposalRecipientsPrisma(
  prisma: PrismaDb,
  skillId: string,
  proposerHandle: string | null,
): Promise<void> {
  for (const userId of await proposalRecipientUserIdsPrisma(prisma, skillId, proposerHandle)) {
    await bumpUserAttentionPrisma(prisma, userId)
  }
}

export function subscribeAttentionStream(userId: string, sink: StreamSink): () => void {
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

export function formatSseData(event: AttentionStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`
}
