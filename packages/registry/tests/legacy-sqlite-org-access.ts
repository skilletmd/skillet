// Quarantined sqlite org-access helpers for characterization under tests/ (U4).
import type { DatabaseSync } from '../src/db/sqlite-handle.js'
import { queryOne } from './legacy-sqlite-query.js'

export interface OrgRow {
  id: string
  slug: string
  name: string
  owner_user_id: string | null
}

export function getOrgBySlug(db: DatabaseSync, slug: string): OrgRow | undefined {
  return queryOne<OrgRow>(
    db,
    'SELECT id, slug, name, owner_user_id FROM organizations WHERE slug = ?',
    slug,
  )
}

export function isOrgSlug(db: DatabaseSync, slug: string): boolean {
  return !!getOrgBySlug(db, slug)
}

export function handleOrSlugTaken(
  db: DatabaseSync,
  name: string,
  excludeUserId?: string,
): boolean {
  const user = excludeUserId
    ? queryOne<{ id: string }>(
        db,
        'SELECT id FROM users WHERE handle = ? AND id != ?',
        name,
        excludeUserId,
      )
    : queryOne<{ id: string }>(db, 'SELECT id FROM users WHERE handle = ?', name)
  if (user) return true
  return !!queryOne<{ id: string }>(db, 'SELECT id FROM organizations WHERE slug = ?', name)
}

export function isOrgAdmin(
  db: DatabaseSync,
  orgId: string,
  userId: string,
  ownerUserId: string | null,
): boolean {
  if (ownerUserId !== null && userId === ownerUserId) return true
  const row = queryOne<{ role: string }>(
    db,
    `SELECT role FROM organization_members
       WHERE org_id = ? AND user_id = ? AND accepted_at IS NOT NULL`,
    orgId,
    userId,
  )
  return row?.role === 'owner' || row?.role === 'admin'
}

export function isOrgMember(
  db: DatabaseSync,
  orgId: string,
  userId: string,
  ownerUserId: string | null,
): boolean {
  if (ownerUserId !== null && userId === ownerUserId) return true
  const row = queryOne<{ ok: number }>(
    db,
    `SELECT 1 AS ok FROM organization_members
       WHERE org_id = ? AND user_id = ? AND accepted_at IS NOT NULL`,
    orgId,
    userId,
  )
  return !!row
}

export function canAdminOrgAuthor(db: DatabaseSync, orgSlug: string, userId: string): boolean {
  const org = getOrgBySlug(db, orgSlug)
  if (!org) return false
  return isOrgAdmin(db, org.id, userId, org.owner_user_id)
}

export function canAccessOrgAuthor(db: DatabaseSync, orgSlug: string, userId: string): boolean {
  const org = getOrgBySlug(db, orgSlug)
  if (!org) return false
  return isOrgMember(db, org.id, userId, org.owner_user_id)
}

export function canManageSkill(db: DatabaseSync, skillId: string, userId: string): boolean {
  const skill = queryOne<{ author_id: string }>(
    db,
    'SELECT author_id FROM skills WHERE id = ?',
    skillId,
  )
  if (!skill) return false

  const org = getOrgBySlug(db, skill.author_id)
  if (org) return isOrgAdmin(db, org.id, userId, org.owner_user_id)

  const personal = queryOne<{ ok: number }>(
    db,
    'SELECT 1 AS ok FROM users WHERE handle = ? AND id = ?',
    skill.author_id,
    userId,
  )
  return !!personal
}

export interface KitPrincipal {
  user_id: string
  handle: string | null
}

export function canManageKit(db: DatabaseSync, kitOwnerId: string, p: KitPrincipal): boolean {
  const org = getOrgBySlug(db, kitOwnerId)
  if (org) return isOrgAdmin(db, org.id, p.user_id, org.owner_user_id)
  return !!p.handle && kitOwnerId === p.handle
}

export function canViewKitMembers(
  db: DatabaseSync,
  kitId: string,
  kitOwnerId: string,
  p: KitPrincipal,
): boolean {
  const org = getOrgBySlug(db, kitOwnerId)
  if (org) {
    if (isOrgMember(db, org.id, p.user_id, org.owner_user_id)) return true
  } else if (!!p.handle && kitOwnerId === p.handle) {
    return true
  }
  const row = queryOne<{ ok: number }>(
    db,
    'SELECT 1 AS ok FROM kit_members WHERE kit_id = ? AND user_id = ?',
    kitId,
    p.user_id,
  )
  return !!row
}

export function ensureOrgAuthorRow(db: DatabaseSync, slug: string, name: string): void {
  db.prepare(`INSERT OR IGNORE INTO authors (id, name) VALUES (?, ?)`).run(slug, name)
}
