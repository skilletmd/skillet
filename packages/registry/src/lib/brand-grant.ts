// Shared "grant brand org" service.
//
// Pulls the org end-state transaction out of the admin grant handler
// (POST /api/v1/admin/mirrors/:handle/grant) so the admin path and a future
// self-serve GitHub-verified path converge on ONE implementation (see plan
// KTD1). Behavior-preserving extraction: the validation order, the SQL, and
// the error codes mirror the original admin handler exactly.
//
// Sqlite dual-path bodies were removed in U5. Residual callers get fail-closed
// stubs; characterization uses tests/legacy-sqlite-brand-grant.ts. MySQL uses
// *Prisma.
import type { DatabaseSync } from '../db/sqlite-handle.js'
import type { PrismaClient } from '@prisma/client'
import { newId } from '../db/index.js'
import { runPrismaTransaction, type PrismaDb } from '../db/prisma-client.js'
import {
  ensureOrgAuthorRowPrisma,
  handleOrSlugTakenPrisma,
} from './org-access.js'

export type BrandGrantErrorCode = 'not_a_mirror' | 'already_claimed' | 'org_exists' | 'name_taken'

/** Typed error so the route (or any caller) maps a stable code to its own HTTP status. */
export class BrandGrantError extends Error {
  readonly code: BrandGrantErrorCode
  constructor(code: BrandGrantErrorCode) {
    super(code)
    this.name = 'BrandGrantError'
    this.code = code
  }
}

export interface GrantBrandOrgInput {
  /** Mirror handle (== org slug). Lowercased defensively to match the route. */
  handle: string
  /** Resolved owner user id; the route owns target resolution + admin gating. */
  ownerUserId: string
  /** Display name for the org + authors row (route passes the mirror's name). */
  name: string
}

export interface GrantBrandOrgResult {
  org_id: string
  slug: string
  owner_user_id: string
}

const SQLITE_REMOVED = 'sqlite registry store removed; use the *Prisma counterpart'

/** Fail-closed stand-in; characterization uses tests/legacy-sqlite-brand-grant.ts. */
export function grantBrandOrg(
  _db: DatabaseSync,
  _input: GrantBrandOrgInput,
): GrantBrandOrgResult {
  throw new Error(`${SQLITE_REMOVED}: grantBrandOrgPrisma`)
}

/** Prisma async counterpart of {@link grantBrandOrg}. */
export async function grantBrandOrgPrisma(
  prisma: PrismaClient,
  input: GrantBrandOrgInput,
): Promise<GrantBrandOrgResult> {
  const handle = input.handle.toLowerCase()
  const { ownerUserId, name } = input

  const mirror = await prisma.authors.findUnique({
    where: { id: handle },
    select: { is_mirror: true, mirror_claimed_at: true },
  })
  if (!mirror || mirror.is_mirror !== 1) {
    throw new BrandGrantError('not_a_mirror')
  }
  if (mirror.mirror_claimed_at != null) {
    throw new BrandGrantError('already_claimed')
  }

  const existingOrg = await prisma.organizations.findUnique({
    where: { slug: handle },
    select: { id: true, owner_user_id: true },
  })
  if (existingOrg) {
    if (existingOrg.owner_user_id != null) {
      throw new BrandGrantError('org_exists')
    }
    return adoptOwnerlessOrgPrisma(prisma, existingOrg.id, handle, ownerUserId, name)
  }
  if (await handleOrSlugTakenPrisma(prisma, handle)) {
    throw new BrandGrantError('name_taken')
  }

  const orgId = newId()
  const now = Math.floor(Date.now() / 1000)
  await runPrismaTransaction(prisma, async (tx: PrismaDb) => {
    await tx.organizations.create({
      data: {
        id: orgId,
        slug: handle,
        name,
        owner_user_id: ownerUserId,
      },
    })
    await tx.organization_members.create({
      data: {
        org_id: orgId,
        user_id: ownerUserId,
        role: 'owner',
        accepted_at: now,
      },
    })
    await ensureOrgAuthorRowPrisma(tx, handle, name)
    await tx.authors.updateMany({
      where: { id: handle, is_mirror: 1, mirror_claimed_at: null },
      data: { mirror_claimed_at: now },
    })
  })

  return { org_id: orgId, slug: handle, owner_user_id: ownerUserId }
}

/** Prisma twin of adoptOwnerlessOrg. */
async function adoptOwnerlessOrgPrisma(
  prisma: PrismaClient,
  orgId: string,
  handle: string,
  ownerUserId: string,
  name: string,
): Promise<GrantBrandOrgResult> {
  const now = Math.floor(Date.now() / 1000)
  await runPrismaTransaction(prisma, async (tx: PrismaDb) => {
    await tx.organizations.update({
      where: { id: orgId },
      data: { owner_user_id: ownerUserId, name },
    })
    await tx.organization_members.upsert({
      where: { org_id_user_id: { org_id: orgId, user_id: ownerUserId } },
      create: {
        org_id: orgId,
        user_id: ownerUserId,
        role: 'owner',
        accepted_at: now,
      },
      update: { role: 'owner', accepted_at: now },
    })
    await ensureOrgAuthorRowPrisma(tx, handle, name)
    await tx.authors.updateMany({
      where: { id: handle, is_mirror: 1, mirror_claimed_at: null },
      data: { mirror_claimed_at: now },
    })
  })

  return { org_id: orgId, slug: handle, owner_user_id: ownerUserId }
}

/**
 * Parse the GitHub owner login from a stored `mirror_source_url` (lowercased).
 *
 * This is the registry's INDEPENDENT owner derivation (KTD9, defense in depth):
 * the self-serve claim endpoint must NOT trust the BFF's handle derivation, so it
 * re-parses the owner itself from the mirror's stored source URL and compares it
 * to the attested GitHub login. Matches the parser in
 * scripts/migrate-brand-mirrors-to-orgs.ts (`parseOwner`) byte-for-byte so the
 * seed-time and claim-time derivations agree.
 */
export function parseMirrorOwnerLogin(sourceUrl: string | null | undefined): string | null {
  if (!sourceUrl) return null
  let path: string
  try {
    path = /^https?:\/\//i.test(sourceUrl) ? new URL(sourceUrl).pathname : sourceUrl
  } catch {
    return null
  }
  const seg = path.replace(/^\/+/, '').split('/')[0]
  return seg ? seg.toLowerCase() : null
}

export interface ClaimMirrorAsUserInput {
  /** Mirror handle (== the claimant's new user handle). Lowercased defensively. */
  handle: string
  /** The claimant's user id (sourced from their verified session by the BFF). */
  ownerUserId: string
}

export interface ClaimMirrorAsUserResult {
  handle: string
  owner_user_id: string
  /** True when this user ALREADY held the handle — the call was idempotent. */
  already_owner: boolean
}

/**
 * RESERVED for the logged-OUT account-bootstrap claim path (follow-up); not used
 * by the logged-in flow. The logged-in claim of any mirror — Org- or User-source —
 * now always grants an org via grantBrandOrg (the claimant keeps their own
 * account handle). This primitive is kept in place for a future no-account claim
 * path that creates a fresh account bound to the mirror handle.
 *
 * Fail-closed stand-in; characterization uses tests/legacy-sqlite-brand-grant.ts.
 */
export function claimMirrorAsUser(
  _db: DatabaseSync,
  _input: ClaimMirrorAsUserInput,
): ClaimMirrorAsUserResult {
  throw new Error(`${SQLITE_REMOVED}: claimMirrorAsUserPrisma`)
}

/** Prisma twin of claimMirrorAsUser for the MySQL brand-bootstrap path. */
export async function claimMirrorAsUserPrisma(
  prisma: PrismaClient,
  input: ClaimMirrorAsUserInput,
): Promise<ClaimMirrorAsUserResult> {
  const handle = input.handle.toLowerCase()
  const { ownerUserId } = input

  const principal = await prisma.users.findUnique({
    where: { id: ownerUserId },
    select: { handle: true },
  })
  if (!principal) {
    throw new Error(`claimMirrorAsUser: unknown user ${ownerUserId}`)
  }
  if (principal.handle === handle) {
    return { handle, owner_user_id: ownerUserId, already_owner: true }
  }
  if (principal.handle && principal.handle !== handle) {
    throw new BrandGrantError('already_claimed')
  }

  const mirror = await prisma.authors.findUnique({
    where: { id: handle },
    select: { is_mirror: true, mirror_claimed_at: true },
  })
  if (!mirror || mirror.is_mirror !== 1) {
    throw new BrandGrantError('not_a_mirror')
  }
  if (mirror.mirror_claimed_at != null) {
    throw new BrandGrantError('already_claimed')
  }

  if (await handleOrSlugTakenPrisma(prisma, handle, ownerUserId)) {
    throw new BrandGrantError('name_taken')
  }

  const now = Math.floor(Date.now() / 1000)
  await runPrismaTransaction(prisma, async (tx: PrismaDb) => {
    await tx.users.update({
      where: { id: ownerUserId },
      data: { handle },
    })
    await tx.authors.upsert({
      where: { id: handle },
      create: { id: handle, name: handle },
      update: {},
    })
    await tx.authors.updateMany({
      where: { id: handle, is_mirror: 1, mirror_claimed_at: null },
      data: { mirror_claimed_at: now },
    })
  })

  return { handle, owner_user_id: ownerUserId, already_owner: false }
}
