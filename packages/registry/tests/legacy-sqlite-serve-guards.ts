// Quarantined sqlite serve-guard helpers for characterization under tests/ (U3).
import type { DatabaseSync } from '../src/db/sqlite-handle.js'
import { getScanInfo } from '../src/scanner/index.js'
import { queryOne } from './legacy-sqlite-query.js'
import type { ServeBlocked } from '../src/routes/serve-guards.js'

export function serveBlockForModeration(
  db: DatabaseSync,
  skillId: string,
): ServeBlocked | null {
  const row = queryOne<{ moderation_status: string }>(
    db,
    'SELECT moderation_status FROM skills WHERE id = ?',
    skillId,
  )
  if (row?.moderation_status === 'quarantined') {
    return {
      status: 409,
      body: {
        error: 'skill_quarantined',
        message: 'This skill is quarantined by a moderator and cannot be downloaded.',
      },
    }
  }
  return null
}

export function serveBlockForScan(
  db: DatabaseSync,
  versionHash: string,
): ServeBlocked | null {
  const scan = getScanInfo(db, versionHash)
  const status = scan?.status ?? 'pending'
  if (status === 'quarantined') {
    return {
      status: 409,
      body: {
        error: 'scan_quarantined',
        message: 'This version is quarantined and cannot be downloaded.',
      },
    }
  }
  if (status === 'pending') {
    return {
      status: 409,
      body: {
        error: 'scan_pending',
        message: 'Harm scan has not completed for this version.',
      },
    }
  }
  return null
}
