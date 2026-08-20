import type { DatabaseSync } from '../db/sqlite-handle.js'
import { parseRef, toSkillId, type SkillId } from '@skillet/protocol/skill-id';
import type { PrismaDb } from '../db/prisma-client.js';

export interface ResolvedSkillRef {
  /** Canonical `owner:slug`, branded — the sole blessed producer for callers. */
  skillId: SkillId;
  author: string;
  slug: string;
  /** True when the request path differed from the canonical skill row. */
  redirected: boolean;
}

/**
 * Fail-closed stand-in for residual dual-path callers outside U3.
 * Characterization uses tests/legacy-sqlite-ref-resolution.ts; MySQL uses
 * {@link resolveHandlePrisma}.
 */
export function resolveHandle(_db: DatabaseSync, _handle: string): string {
  throw new Error('sqlite registry store removed; use resolveHandlePrisma');
}

/** Prisma async counterpart of {@link resolveHandle}. */
export async function resolveHandlePrisma(prisma: PrismaDb, handle: string): Promise<string> {
  let current = handle;
  const seen = new Set<string>();
  for (let i = 0; i < 32; i++) {
    const row = await prisma.handle_aliases.findUnique({
      where: { old_handle: current },
      select: { new_handle: true },
    });
    if (!row) return current;
    if (seen.has(current)) return current;
    seen.add(current);
    current = row.new_handle;
  }
  return current;
}

/**
 * Split a canonical `owner:slug` skill id into `{ author, slug }`.
 *
 * The happy path delegates to the shared `parseRef` (single source of truth for
 * the `owner:slug` form) so the split can never drift from the other converters.
 * `parseRef` THROWS on a malformed id; this split has always been lenient (a
 * colon-less id yields `{ author: id, slug: '' }`), so the historical lenient
 * split is preserved as a fallback rather than propagating a throw to callers.
 */
function splitSkillId(skillId: SkillId): { author: string; slug: string } {
  try {
    const { owner, slug } = parseRef(skillId);
    return { author: owner, slug };
  } catch {
    const idx = skillId.indexOf(':');
    if (idx < 0) return { author: skillId, slug: '' };
    return { author: skillId.slice(0, idx), slug: skillId.slice(idx + 1) };
  }
}

async function expandSkillAliasChainPrisma(
  prisma: PrismaDb,
  startId: string,
): Promise<string[]> {
  const ids: string[] = [];
  const seen = new Set<string>();
  let current = startId;
  for (let i = 0; i < 32; i++) {
    if (seen.has(current)) break;
    seen.add(current);
    ids.push(current);
    const row = await prisma.skill_aliases.findUnique({
      where: { from_skill_id: current },
      select: { to_skill_id: true },
    });
    if (!row) break;
    current = row.to_skill_id;
  }
  return ids;
}

/**
 * Fail-closed stand-in for residual dual-path callers outside U3.
 * Characterization uses tests/legacy-sqlite-ref-resolution.ts; MySQL uses
 * {@link resolveSkillRefPrisma}.
 */
export function resolveSkillRef(
  _db: DatabaseSync,
  _author: string,
  _slug: string,
): ResolvedSkillRef | null {
  throw new Error('sqlite registry store removed; use resolveSkillRefPrisma');
}

/** Prisma async counterpart of {@link resolveSkillRef}. */
export async function resolveSkillRefPrisma(
  prisma: PrismaDb,
  author: string,
  slug: string,
): Promise<ResolvedSkillRef | null> {
  const requestedId = `${author}:${slug}`;
  const canonicalAuthor = await resolveHandlePrisma(prisma, author);

  const candidateIds = new Set<string>();
  for (const id of await expandSkillAliasChainPrisma(prisma, requestedId)) {
    candidateIds.add(id);
  }
  for (const id of await expandSkillAliasChainPrisma(prisma, `${canonicalAuthor}:${slug}`)) {
    candidateIds.add(id);
  }
  candidateIds.add(`${canonicalAuthor}:${slug}`);

  for (const skillId of candidateIds) {
    const row = await prisma.skills.findUnique({
      where: { id: skillId },
      select: { author_id: true, slug: true },
    });
    if (row) {
      return {
        skillId: toSkillId(skillId),
        author: row.author_id,
        slug: row.slug,
        redirected: skillId !== requestedId || row.author_id !== author || row.slug !== slug,
      };
    }
  }
  return null;
}

/**
 * Fail-closed stand-in for residual dual-path callers outside U3.
 * MySQL uses {@link isVersionYankedPrisma}.
 */
export function isVersionYanked(_db: DatabaseSync, _hash: string): boolean {
  throw new Error('sqlite registry store removed; use isVersionYankedPrisma');
}

/** Prisma async counterpart of {@link isVersionYanked}. */
export async function isVersionYankedPrisma(prisma: PrismaDb, hash: string): Promise<boolean> {
  const raw = normalizeVersionHash(hash);
  const row = await prisma.skill_versions.findFirst({
    where: { OR: [{ hash: raw }, { hash: `sha256:${raw}` }] },
    select: { yanked_at: true },
  });
  return row?.yanked_at != null;
}

/** Normalise version hash to bare hex for DB lookups. */
export function normalizeVersionHash(hash: string): string {
  return hash.startsWith('sha256:') ? hash.slice('sha256:'.length) : hash;
}

/**
 * Fail-closed stand-in for residual dual-path callers outside U3.
 * MySQL uses {@link isUserSuspendedPrisma}.
 */
export function isUserSuspended(_db: DatabaseSync, _userId: string): boolean {
  throw new Error('sqlite registry store removed; use isUserSuspendedPrisma');
}

/** Prisma async counterpart of {@link isUserSuspended}. */
export async function isUserSuspendedPrisma(prisma: PrismaDb, userId: string): Promise<boolean> {
  const row = await prisma.users.findUnique({
    where: { id: userId },
    select: { suspended_at: true },
  });
  return row?.suspended_at != null;
}

/**
 * Fail-closed stand-in. Characterization uses
 * tests/legacy-sqlite-ref-resolution.ts.
 */
export function registerHandleAlias(
  _db: DatabaseSync,
  _oldHandle: string,
  _newHandle: string,
): void {
  throw new Error('sqlite registry store removed; use tests/legacy-sqlite-ref-resolution');
}

/**
 * Fail-closed stand-in. Characterization uses
 * tests/legacy-sqlite-ref-resolution.ts.
 */
export function registerSkillAlias(
  _db: DatabaseSync,
  _fromSkillId: string,
  _toSkillId: string,
): void {
  throw new Error('sqlite registry store removed; use tests/legacy-sqlite-ref-resolution');
}

/** Split a skill_id into author + slug for route responses. */
export function skillIdParts(skillId: SkillId): { author: string; slug: string } {
  return splitSkillId(skillId);
}
