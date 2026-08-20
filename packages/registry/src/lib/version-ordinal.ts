import type { DatabaseSync } from '../db/sqlite-handle.js'
import type { PrismaDb } from '../db/prisma-client.js';

/**
 * A skill version's 1-indexed position in its skill's publish order — the
 * integer clients see as `version` in the sync manifest, and the value
 * `platform-signing` embeds in platform attestations.
 *
 * SIGNATURE-BOUND, DERIVED, NOT STORED. This number is signed, and it is
 * computed independently in several places that must all agree or verification
 * fails: the manifest (routes/sync.ts), the platform signer
 * (lib/platform-signing.ts), the publish-time author-signature binding
 * (routes/skills.ts, via `nextVersionOrdinal`), and — critically — the CLIENT,
 * which re-derives it as `versions.length - latestIdx` over the served list
 * (packages/core/src/registry/pull.ts). For those to agree, the ordinal MUST be
 * a strict total order: `published_at` alone ties (it defaults to whole-second
 * `unixepoch()`, so two publishes in one second collide), so we tiebreak by
 * `rowid` — the same `(published_at, rowid)` order the semver backfill uses
 * (migrations/047) and that every served version list must sort by.
 *
 * Invariants this relies on (see tests/version-ordinal-equivalence.test.ts):
 *   - `skill_versions` is append-only per skill; `published_at` is never updated.
 *   - Deletes are whole-skill only (never a middle version), so ordinals never
 *     renumber under a live version.
 *
 * Fail-closed stand-in for residual dual-path callers outside U3.
 * Characterization uses tests/legacy-sqlite-version-ordinal.ts; MySQL uses
 * {@link versionOrdinalPrisma}.
 */
export function versionOrdinal(_db: DatabaseSync, _skillId: string, _hash: string): number {
  throw new Error('sqlite registry store removed; use versionOrdinalPrisma');
}

/**
 * MySQL counterpart of {@link versionOrdinal}. Without sqlite `rowid`, we
 * tiebreak same-second publishes by hash (stable, deterministic).
 */
export async function versionOrdinalPrisma(
  prisma: PrismaDb,
  skillId: string,
  hash: string,
): Promise<number> {
  const target = await prisma.skill_versions.findFirst({
    where: { skill_id: skillId, OR: [{ hash }, { hash: `sha256:${hash}` }] },
    select: { published_at: true, hash: true },
  });
  if (!target) return 1;
  const earlier = await prisma.skill_versions.count({
    where: {
      skill_id: skillId,
      OR: [
        { published_at: { lt: target.published_at } },
        {
          published_at: target.published_at,
          hash: { lte: target.hash },
        },
      ],
    },
  });
  return earlier;
}

/**
 * The ordinal the NEXT published row will receive, computed BEFORE it is
 * inserted (the publish path signs the version before the row exists, so it
 * can't call `versionOrdinal`). A freshly inserted row takes the maximum
 * `(published_at, rowid)` — `published_at` defaults to now (>= every existing
 * row) and its `rowid` is the largest — so its ordinal is exactly the current
 * count plus one. Keep this in lockstep with `versionOrdinal`.
 *
 * Fail-closed stand-in for residual dual-path callers outside U3.
 */
export function nextVersionOrdinal(_db: DatabaseSync, _skillId: string): number {
  throw new Error('sqlite registry store removed; use nextVersionOrdinalPrisma');
}

/** MySQL counterpart of {@link nextVersionOrdinal}. */
export async function nextVersionOrdinalPrisma(
  prisma: PrismaDb,
  skillId: string,
): Promise<number> {
  const c = await prisma.skill_versions.count({ where: { skill_id: skillId } })
  return c + 1
}
