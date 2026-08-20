import type { DatabaseSync } from '../db/sqlite-handle.js'
import type { PrismaDb } from '../db/prisma-client.js'
import { encryptToken, decryptToken } from './repo-auth.js'

/**
 * One reusable, read-only GitHub token per user (user_github_tokens). Captured at
 * GitHub sign-in or at the one-time minimal-scope connect, and reused so adding a
 * repo needs no extra OAuth grant. Encrypted at rest with the same AES-256-GCM
 * helper as connected_repos; the raw token never leaves the registry — callers
 * outside it only ever learn the boolean from {@link userHasGithubToken}.
 *
 * Sqlite dual-path bodies were removed in U5. Residual callers get fail-closed
 * stubs; characterization uses tests/legacy-sqlite-github-token.ts.
 */

const SQLITE_REMOVED = 'sqlite registry store removed; use the *Prisma counterpart'

/** Fail-closed stand-in; characterization uses tests/legacy-sqlite-github-token.ts. */
export function storeUserGithubToken(_db: DatabaseSync, _userId: string, _rawToken: string): void {
  throw new Error(`${SQLITE_REMOVED}: storeUserGithubTokenPrisma`)
}

export async function storeUserGithubTokenPrisma(
  prisma: PrismaDb,
  userId: string,
  rawToken: string,
): Promise<void> {
  const token = rawToken.trim()
  if (!token) return
  const now = Math.floor(Date.now() / 1000)
  await prisma.user_github_tokens.upsert({
    where: { user_id: userId },
    create: { user_id: userId, token_enc: encryptToken(token), updated_at: now },
    update: { token_enc: encryptToken(token), updated_at: now },
  })
}

/** Fail-closed stand-in; characterization uses tests/legacy-sqlite-github-token.ts. */
export function getUserGithubToken(_db: DatabaseSync, _userId: string): string | null {
  throw new Error(`${SQLITE_REMOVED}: getUserGithubTokenPrisma`)
}

/** Prisma async counterpart of {@link getUserGithubToken}. */
export async function getUserGithubTokenPrisma(
  prisma: PrismaDb,
  userId: string,
): Promise<string | null> {
  const row = await prisma.user_github_tokens.findUnique({
    where: { user_id: userId },
    select: { token_enc: true },
  })
  if (!row?.token_enc) return null
  try {
    return decryptToken(row.token_enc)
  } catch {
    return null
  }
}

/** Fail-closed stand-in; characterization uses tests/legacy-sqlite-github-token.ts. */
export function userHasGithubToken(_db: DatabaseSync, _userId: string): boolean {
  throw new Error(`${SQLITE_REMOVED}: userHasGithubTokenPrisma`)
}

export async function userHasGithubTokenPrisma(
  prisma: PrismaDb,
  userId: string,
): Promise<boolean> {
  const row = await prisma.user_github_tokens.findUnique({
    where: { user_id: userId },
    select: { user_id: true },
  })
  return row != null
}
