// Live suspension guard for read/discovery surfaces.
//
// Suspending an author (lib/enforcement.ts `suspendAuthor`) is a ONE-TIME bulk
// flip of their existing skills (`moderation_status 'none'->'unlisted'`) and kits
// (`'none'->'hidden'`). That cascade alone is not enough for two reasons:
//   1. Facepiles / social-proof lists (USED BY, followers, who-to-follow, feeds)
//      join `users`/`authors` for a name+avatar and never consult moderation at
//      all — so a suspended user's identity leaks there regardless of the flip.
//   2. Any content that returns to `moderation_status 'none'` while the author is
//      still suspended (an independent relist, a quarantine->none) would re-leak.
//
// Every discovery/read query that names an author or lists their content should
// apply this guard so suspension is honored LIVE (reads users.suspended_at at
// query time), keyed on the handle. authors.id / skills.author_id / kits.owner_id
// all hold the handle string, so the same exclusion works everywhere.
import type { DatabaseSync } from '../db/sqlite-handle.js'
import type { PrismaDb } from '../db/prisma-client.js';

/**
 * SQL subquery returning the handles of currently-suspended users. Use as an
 * exclusion: `... WHERE <handleColumn> NOT IN (${SUSPENDED_HANDLES_SUBQUERY})`.
 * Where a query already joins `users u`, prefer `AND u.suspended_at IS NULL`.
 *
 * Residual dual-path SQL in later units still embeds this string; the constant
 * itself never opens sqlite.
 */
export const SUSPENDED_HANDLES_SUBQUERY =
  'SELECT handle FROM users WHERE suspended_at IS NOT NULL';

/**
 * Fail-closed stand-in for residual dual-path callers outside U3.
 * MySQL uses {@link isHandleSuspendedPrisma}.
 */
export function isHandleSuspended(_db: DatabaseSync, _handle: string): boolean {
  throw new Error('sqlite registry store removed; use isHandleSuspendedPrisma');
}

/** Prisma async counterpart of {@link isHandleSuspended}. */
export async function isHandleSuspendedPrisma(
  prisma: PrismaDb,
  handle: string,
): Promise<boolean> {
  const row = await prisma.users.findFirst({
    where: { handle },
    select: { suspended_at: true },
  });
  return row?.suspended_at != null;
}

/** Handles currently suspended (for catalog/stats `notIn` filters). */
export async function suspendedAuthorHandlesPrisma(prisma: PrismaDb): Promise<string[]> {
  const rows = await prisma.users.findMany({
    where: { suspended_at: { not: null }, handle: { not: null } },
    select: { handle: true },
  });
  return rows
    .map((row) => row.handle)
    .filter((handle): handle is string => typeof handle === 'string' && handle.length > 0);
}
