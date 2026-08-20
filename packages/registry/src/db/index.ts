import { createHash, randomUUID } from 'node:crypto'
import type { SqliteHandle } from './sqlite-handle.js'
import type { PrismaDb } from './prisma-client.js'

/**
 * Removed: relational data is MySQL/Prisma only. Characterization tests use
 * `tests/legacy-sqlite-open.ts`. Scripts must be rewritten against Prisma.
 */
export function openDb(_path?: string): SqliteHandle {
  throw new Error(
    'openDb was removed in the MySQL cutover. Set DATABASE_URL and use Prisma.',
  )
}

/** sha256 over arbitrary bytes; `sha256:`-prefixed (matches §2.2 hash format). */
export function blobHash(bytes: Uint8Array | string): string {
  const buf = typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : Buffer.from(bytes)
  return 'sha256:' + createHash('sha256').update(buf).digest('hex')
}

export function newId(): string {
  return randomUUID()
}

export interface AuthorKey {
  key_id: string
  public_key: string
}

/**
 * Return all non-revoked keys bound to a user.
 *
 * SCOPE: this set includes web-session-bound browser keys, which carry
 * NO author-primary signature over them. It is therefore valid ONLY for the
 * bounded `propose` scope (chain-of-custody re-verify of a proposal envelope that
 * is never materialized to clients). It MUST NOT be used to authorize publish-new
 * or to verify the signature stored on a minted skill_versions row; those require
 * getPrimaryAuthorKeyPrisma(), because the registry must never mint publish authority.
 */
export async function getAuthorKeysPrisma(
  prisma: PrismaDb,
  userId: string,
): Promise<AuthorKey[]> {
  const rows = await prisma.author_keys.findMany({
    where: { user_id: userId, revoked_at: null },
    select: { key_id: true, public_key: true },
  })
  return rows.map((row) => ({ key_id: row.key_id, public_key: row.public_key }))
}

/**
 * Return the user's PRIMARY author key — the CLI-origin key registered at /claim
 * time and TOFU-pinned by every client (PROTOCOL §4).
 *
 * This is the ONLY key permitted to hold publish-new authority or to sign a
 * materialized skill_versions row (§9). A browser-bound
 * `author_keys` row is mintable by a web session OR a registry-DB compromise with
 * no signature chaining it to the primary key, so authority must be read from the
 * authoritative `users.author_public_key` / `author_key_id` claim columns, never
 * from an `author_keys` row (whose `label` a DB attacker could forge to 'cli-primary').
 *
 * Returns null if the user has not claimed a primary key.
 */
export async function getPrimaryAuthorKeyPrisma(
  prisma: PrismaDb,
  userId: string,
): Promise<AuthorKey | null> {
  const row = await prisma.users.findUnique({
    where: { id: userId },
    select: { author_key_id: true, author_public_key: true },
  })
  if (!row?.author_key_id || !row.author_public_key) return null
  return { key_id: row.author_key_id, public_key: row.author_public_key }
}

// ── Trust graph types (Prisma implementations live in lib/follow-graph.ts) ──

export type FollowKind = 'author' | 'org' | 'skill'

export interface FollowEdge {
  subject_kind: FollowKind
  subject_id: string
  created_at: number
}

export interface FollowerEntry {
  handle: string | null
  created_at: number
}

export interface AdopterEntry {
  handle: string
  name: string | null
  avatar_url: string | null
  bio: string | null
}
