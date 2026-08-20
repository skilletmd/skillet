// Quarantined sqlite enforcement helpers for characterization under tests/ (U5).
import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from '../src/db/sqlite-handle.js'
import { queryOne } from './legacy-sqlite-query.js'
import type {
  EnforcementResult,
  ModerationAction,
} from '../src/lib/enforcement.js'

export type { EnforcementResult, ModerationAction, ModerationStatus } from '../src/lib/enforcement.js'

type ModerationStatus = 'none' | 'unlisted' | 'quarantined'

const ACTION_TARGET: Record<ModerationAction, ModerationStatus> = {
  quarantine: 'quarantined',
  unquarantine: 'none',
  unlist: 'unlisted',
  relist: 'none',
}

export function applyModerationAction(
  db: DatabaseSync,
  args: {
    skillId: string
    action: ModerationAction
    actedBy: string
    publicReason?: string | null
  },
): EnforcementResult | null {
  const { skillId, action, actedBy } = args
  const publicReason = args.publicReason ?? null
  const target = ACTION_TARGET[action]

  const skill = queryOne<{ id: string }>(db, 'SELECT id FROM skills WHERE id = ?', skillId)
  if (!skill) return null

  const actionId = randomUUID()
  db.exec('BEGIN')
  try {
    db.prepare('UPDATE skills SET moderation_status = ? WHERE id = ?').run(target, skillId)
    db.prepare(
      `INSERT INTO skill_moderation_actions (id, skill_id, action, public_reason, acted_by)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(actionId, skillId, action, publicReason, actedBy)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }

  return { skillId, action, status: target, actionId }
}

export function quarantineSkill(
  db: DatabaseSync,
  skillId: string,
  actedBy: string,
  publicReason?: string | null,
): EnforcementResult | null {
  return applyModerationAction(db, { skillId, action: 'quarantine', actedBy, publicReason })
}

export function unquarantineSkill(
  db: DatabaseSync,
  skillId: string,
  actedBy: string,
  publicReason?: string | null,
): EnforcementResult | null {
  return applyModerationAction(db, { skillId, action: 'unquarantine', actedBy, publicReason })
}

export function unlistSkill(
  db: DatabaseSync,
  skillId: string,
  actedBy: string,
  publicReason?: string | null,
): EnforcementResult | null {
  return applyModerationAction(db, { skillId, action: 'unlist', actedBy, publicReason })
}

export function relistSkill(
  db: DatabaseSync,
  skillId: string,
  actedBy: string,
  publicReason?: string | null,
): EnforcementResult | null {
  return applyModerationAction(db, { skillId, action: 'relist', actedBy, publicReason })
}

export function hideKit(db: DatabaseSync, kitId: string, _actedBy: string): boolean {
  const kit = queryOne<{ id: string }>(db, 'SELECT id FROM kits WHERE id = ?', kitId)
  if (!kit) return false
  db.prepare(`UPDATE kits SET moderation_status = 'hidden' WHERE id = ?`).run(kitId)
  return true
}

export function unhideKit(db: DatabaseSync, kitId: string, _actedBy: string): boolean {
  const kit = queryOne<{ id: string }>(db, 'SELECT id FROM kits WHERE id = ?', kitId)
  if (!kit) return false
  db.prepare(`UPDATE kits SET moderation_status = 'none' WHERE id = ?`).run(kitId)
  return true
}

export function suspendAuthor(db: DatabaseSync, handle: string, _actedBy: string): boolean {
  const user = queryOne<{ id: string }>(db, 'SELECT id FROM users WHERE handle = ?', handle)
  if (!user) return false
  db.exec('BEGIN')
  try {
    db.prepare('UPDATE users SET suspended_at = unixepoch() WHERE handle = ?').run(handle)
    db.prepare(
      `UPDATE skills SET moderation_status = 'unlisted'
         WHERE author_id = ? AND moderation_status = 'none'`,
    ).run(handle)
    db.prepare(
      `UPDATE kits SET moderation_status = 'hidden'
         WHERE owner_id = ? AND moderation_status = 'none'`,
    ).run(handle)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  return true
}

export function unsuspendAuthor(db: DatabaseSync, handle: string, _actedBy: string): boolean {
  const user = queryOne<{ id: string }>(db, 'SELECT id FROM users WHERE handle = ?', handle)
  if (!user) return false
  db.exec('BEGIN')
  try {
    db.prepare('UPDATE users SET suspended_at = NULL WHERE handle = ?').run(handle)
    db.prepare(
      `UPDATE skills SET moderation_status = 'none'
         WHERE author_id = ? AND moderation_status = 'unlisted'`,
    ).run(handle)
    db.prepare(
      `UPDATE kits SET moderation_status = 'none'
         WHERE owner_id = ? AND moderation_status = 'hidden'`,
    ).run(handle)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  return true
}
