// Quarantined sqlite attention helpers for characterization under tests/ (U4).
// Stream sinks here are independent of src/lib/attention.ts (Prisma/SSE path).
import type { DatabaseSync } from '../src/db/sqlite-handle.js'
import type { AttentionStreamEvent } from '@skillet/protocol'
import { getUserIdByHandle } from './legacy-sqlite-db-helpers.js'
import { query, queryOne } from './legacy-sqlite-query.js'
import type { AttentionSignal, AttentionSnapshot, SocialAttentionKind } from '../src/lib/attention.js'

export type { AttentionSignal, AttentionSnapshot, SocialAttentionKind }

type StreamSink = (events: AttentionStreamEvent[]) => void

const streamSinks = new Map<string, Set<StreamSink>>()

function notificationsSeenAt(db: DatabaseSync, userId: string): number | null {
  const row = queryOne<{ at: number | null }>(
    db,
    'SELECT notifications_seen_at AS at FROM users WHERE id = ?',
    userId,
  )
  return row?.at ?? null
}

function viewerHandleForUser(db: DatabaseSync, userId: string): string | null {
  const row = queryOne<{ handle: string | null }>(
    db,
    'SELECT handle FROM users WHERE id = ?',
    userId,
  )
  return row?.handle ?? null
}

function unreadNotificationCount(
  db: DatabaseSync,
  handle: string,
  userId: string,
  since: number | null,
): number {
  const args: Array<string | number> = [handle, userId]
  const clause = since == null ? '' : 'AND f.created_at > ?'
  if (since != null) args.push(since)
  const row = queryOne<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n
       FROM follows f
       JOIN users u ON u.id = f.follower_user_id
      WHERE f.subject_kind = 'author' AND f.subject_id = ?
        AND u.id != ?
        ${clause}`,
    ...args,
  )
  return row?.n ?? 0
}

function pendingUpdatesCount(db: DatabaseSync, userId: string): number {
  // Characterization attention tests do not assert pending updates; keep cheap.
  void db
  void userId
  return 0
}

export function readAttentionSnapshot(db: DatabaseSync, userId: string): AttentionSnapshot | null {
  const row = queryOne<{ seq: number }>(
    db,
    'SELECT attention_seq AS seq FROM users WHERE id = ?',
    userId,
  )
  if (!row) return null
  const handle = viewerHandleForUser(db, userId)
  const seen = notificationsSeenAt(db, userId)
  const unread = handle ? unreadNotificationCount(db, handle, userId, seen) : 0
  return {
    seq: row.seq,
    unread_count: unread,
    pending_updates_count: pendingUpdatesCount(db, userId),
  }
}

function notifyUserStreams(userId: string, events: AttentionStreamEvent[]): void {
  const sinks = streamSinks.get(userId)
  if (!sinks) return
  for (const sink of sinks) sink(events)
}

export function bumpUserAttention(
  db: DatabaseSync,
  userId: string,
  signal?: AttentionSignal,
): void {
  if (!userId) return
  db.prepare('UPDATE users SET attention_seq = attention_seq + 1 WHERE id = ?').run(userId)
  const snapshot = readAttentionSnapshot(db, userId)
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

export function bumpAttentionForHandle(
  db: DatabaseSync,
  handle: string,
  signal?: AttentionSignal,
): void {
  const userId = getUserIdByHandle(db, handle)
  if (userId) bumpUserAttention(db, userId, signal)
}

export function subscriberUserIdsForSkill(db: DatabaseSync, skillId: string): string[] {
  const authorRow = queryOne<{ author_id: string }>(
    db,
    'SELECT author_id FROM skills WHERE id = ?',
    skillId,
  )
  if (!authorRow) return []
  const rows = query<{ user_id: string }>(
    db,
    `SELECT DISTINCT user_id FROM (
       SELECT sub.user_id AS user_id
         FROM kit_subscriptions sub
         JOIN kit_skills ks ON ks.kit_id = sub.kit_id
        WHERE sub.kind = 'kit' AND ks.skill_id = ?
       UNION
       SELECT sub.user_id AS user_id
         FROM kit_subscriptions sub
        WHERE sub.kind = 'author' AND sub.author_id = ?
     )`,
    skillId,
    authorRow.author_id,
  )
  return rows.map((r) => r.user_id)
}

export function bumpAttentionForSkillSubscribers(db: DatabaseSync, skillId: string): void {
  for (const userId of subscriberUserIdsForSkill(db, skillId)) {
    bumpUserAttention(db, userId, { kind: 'pending_increased' })
  }
}

export function proposalRecipientUserIds(
  db: DatabaseSync,
  skillId: string,
  excludeHandle: string | null,
): string[] {
  const skill = queryOne<{ author_id: string; org_id: string | null }>(
    db,
    'SELECT author_id, org_id FROM skills WHERE id = ?',
    skillId,
  )
  if (!skill) return []
  const ids = new Set<string>()
  if (skill.org_id) {
    const admins = query<{ user_id: string }>(
      db,
      `SELECT user_id FROM organization_members
        WHERE org_id = ? AND accepted_at IS NOT NULL AND role IN ('owner', 'admin')`,
      skill.org_id,
    )
    for (const a of admins) ids.add(a.user_id)
  } else {
    const uid = getUserIdByHandle(db, skill.author_id)
    if (uid) ids.add(uid)
  }
  const excludeId = excludeHandle ? getUserIdByHandle(db, excludeHandle) : null
  if (excludeId) ids.delete(excludeId)
  return [...ids]
}

export function bumpAttentionForProposalRecipients(
  db: DatabaseSync,
  skillId: string,
  proposerHandle: string | null,
): void {
  for (const userId of proposalRecipientUserIds(db, skillId, proposerHandle)) {
    bumpUserAttention(db, userId)
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
