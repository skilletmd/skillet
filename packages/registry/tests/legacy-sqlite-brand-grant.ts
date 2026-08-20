// Quarantined sqlite brand-grant helpers for characterization under tests/ (U5).
import type { DatabaseSync } from '../src/db/sqlite-handle.js'
import { newId } from '../src/db/index.js'
import { runTransaction } from './legacy-sqlite-db-helpers.js'
import { queryOne } from './legacy-sqlite-query.js'
import {
  BrandGrantError,
  type ClaimMirrorAsUserInput,
  type ClaimMirrorAsUserResult,
  type GrantBrandOrgInput,
  type GrantBrandOrgResult,
} from '../src/lib/brand-grant.js'
import { ensureOrgAuthorRow, handleOrSlugTaken } from './legacy-sqlite-org-access.js'

export { BrandGrantError }
export type { ClaimMirrorAsUserInput, ClaimMirrorAsUserResult, GrantBrandOrgInput, GrantBrandOrgResult }

interface MirrorRow {
  is_mirror: number
  mirror_claimed_at: number | null
}

function adoptOwnerlessOrg(
  db: DatabaseSync,
  orgId: string,
  handle: string,
  ownerUserId: string,
  name: string,
): GrantBrandOrgResult {
  runTransaction(db, () => {
    db.prepare('UPDATE organizations SET owner_user_id = ?, name = ? WHERE id = ?').run(
      ownerUserId,
      name,
      orgId,
    )

    db.prepare(
      `INSERT INTO organization_members (org_id, user_id, role, accepted_at)
       VALUES (?, ?, 'owner', unixepoch())
       ON CONFLICT(org_id, user_id) DO UPDATE SET role = 'owner', accepted_at = unixepoch()`,
    ).run(orgId, ownerUserId)

    ensureOrgAuthorRow(db, handle, name)

    db.prepare(
      `UPDATE authors SET mirror_claimed_at = unixepoch()
       WHERE id = ? AND is_mirror = 1 AND mirror_claimed_at IS NULL`,
    ).run(handle)
  })

  return { org_id: orgId, slug: handle, owner_user_id: ownerUserId }
}

/** Sqlite characterization twin of grantBrandOrg. */
export function grantBrandOrg(db: DatabaseSync, input: GrantBrandOrgInput): GrantBrandOrgResult {
  const handle = input.handle.toLowerCase()
  const { ownerUserId, name } = input

  const mirror = queryOne<MirrorRow>(
    db,
    'SELECT is_mirror, mirror_claimed_at FROM authors WHERE id = ?',
    handle,
  )
  if (!mirror || mirror.is_mirror !== 1) {
    throw new BrandGrantError('not_a_mirror')
  }
  if (mirror.mirror_claimed_at != null) {
    throw new BrandGrantError('already_claimed')
  }

  const existingOrg = queryOne<{ id: string; owner_user_id: string | null }>(
    db,
    'SELECT id, owner_user_id FROM organizations WHERE slug = ?',
    handle,
  )
  if (existingOrg) {
    if (existingOrg.owner_user_id != null) {
      throw new BrandGrantError('org_exists')
    }
    return adoptOwnerlessOrg(db, existingOrg.id, handle, ownerUserId, name)
  }
  if (handleOrSlugTaken(db, handle)) {
    throw new BrandGrantError('name_taken')
  }

  const orgId = newId()
  runTransaction(db, () => {
    db.prepare(`INSERT INTO organizations (id, slug, name, owner_user_id) VALUES (?, ?, ?, ?)`).run(
      orgId,
      handle,
      name,
      ownerUserId,
    )

    db.prepare(
      `INSERT INTO organization_members (org_id, user_id, role, accepted_at)
       VALUES (?, ?, 'owner', unixepoch())`,
    ).run(orgId, ownerUserId)

    ensureOrgAuthorRow(db, handle, name)

    db.prepare(
      `UPDATE authors SET mirror_claimed_at = unixepoch()
       WHERE id = ? AND is_mirror = 1 AND mirror_claimed_at IS NULL`,
    ).run(handle)
  })

  return { org_id: orgId, slug: handle, owner_user_id: ownerUserId }
}

/** Sqlite characterization twin of claimMirrorAsUser. */
export function claimMirrorAsUser(
  db: DatabaseSync,
  input: ClaimMirrorAsUserInput,
): ClaimMirrorAsUserResult {
  const handle = input.handle.toLowerCase()
  const { ownerUserId } = input

  const principal = queryOne<{ handle: string | null }>(
    db,
    'SELECT handle FROM users WHERE id = ?',
    ownerUserId,
  )
  if (!principal) {
    throw new Error(`claimMirrorAsUser: unknown user ${ownerUserId}`)
  }
  if (principal.handle === handle) {
    return { handle, owner_user_id: ownerUserId, already_owner: true }
  }
  if (principal.handle && principal.handle !== handle) {
    throw new BrandGrantError('already_claimed')
  }

  const mirror = queryOne<MirrorRow>(
    db,
    'SELECT is_mirror, mirror_claimed_at FROM authors WHERE id = ?',
    handle,
  )
  if (!mirror || mirror.is_mirror !== 1) {
    throw new BrandGrantError('not_a_mirror')
  }
  if (mirror.mirror_claimed_at != null) {
    throw new BrandGrantError('already_claimed')
  }

  if (handleOrSlugTaken(db, handle, ownerUserId)) {
    throw new BrandGrantError('name_taken')
  }

  runTransaction(db, () => {
    db.prepare('UPDATE users SET handle = ? WHERE id = ?').run(handle, ownerUserId)

    db.prepare(
      `INSERT INTO authors (id, name) VALUES (?, ?)
       ON CONFLICT(id) DO NOTHING`,
    ).run(handle, handle)

    db.prepare(
      `UPDATE authors SET mirror_claimed_at = unixepoch()
       WHERE id = ? AND is_mirror = 1 AND mirror_claimed_at IS NULL`,
    ).run(handle)
  })

  return { handle, owner_user_id: ownerUserId, already_owner: false }
}
