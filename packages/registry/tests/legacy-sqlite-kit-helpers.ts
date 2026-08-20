// Quarantined sqlite kit helpers for characterization under tests/ (U4).
import type { DatabaseSync } from '../src/db/sqlite-handle.js'
import { newId } from '../src/db/index.js'
import { queryOne } from './legacy-sqlite-query.js'

export function getOrCreateSavedKit(db: DatabaseSync, ownerHandle: string): string {
  const existing = queryOne<{ id: string }>(
    db,
    "SELECT id FROM kits WHERE owner_id = ? AND kind = 'saved' LIMIT 1",
    ownerHandle,
  )
  if (existing) return existing.id
  const id = newId()
  // "Saved" everywhere: the skill-card dropdown, the profile tab, and the device
  // sync row all call this kit Saved. Kits created before the rename keep the
  // old Library name/slug in the DB; every user-facing surface hardcodes the label.
  db.prepare(
    `INSERT INTO kits (id, owner_id, name, slug, description, visibility, source_type, kind)
     VALUES (?, ?, 'Saved', 'saved', ?, 'private', 'owned', 'saved')`,
  ).run(id, ownerHandle, 'Skills you added individually.')
  return id
}
