// DB-aware semver-label computation shared by every path that mints a
// skill_versions row (publish, proposal approval, repo sync). Split in two on
// purpose: `classifyVersionBump` does the async work (base file-map query plus
// a base-SKILL.md blob read only for the SKILL.md-only case), while
// `deriveVersionLabel` is synchronous so callers can run it INSIDE the write
// transaction that inserts the row — the max-label read and the increment must
// be atomic with the insert, or two concurrent writes can mint the same label.
import type { DatabaseSync } from './db/sqlite-handle.js'
import type { PrismaDb } from './db/prisma-client.js';
import {
  classifyFileMaps,
  classifyPublishDiff,
  formatVersionLabel,
  nextVersionLabel,
  type BumpKind,
  type VersionFileMap,
  type VersionLabel,
} from './semver-classify.js';

export interface ClassifyVersionBumpOptions {
  skillId: string;
  /** Base version hash (the skill's latest_hash), or null on a first publish. */
  baseHash: string | null;
  /** The next version's file listing: path → blob hash. */
  nextFiles: VersionFileMap;
  /** The next SKILL.md text, or null when unreadable. */
  nextSkillMd: string | null;
  /** Blob reader for the base SKILL.md — invoked only for the SKILL.md-only case. */
  readBlob: (blobHash: string) => Promise<Uint8Array | null> | Uint8Array | null;
}

/**
 * Fail-closed stand-in for residual dual-path callers outside U3.
 * MySQL uses {@link classifyVersionBumpPrisma}.
 */
export async function classifyVersionBump(
  _db: DatabaseSync,
  _opts: ClassifyVersionBumpOptions,
): Promise<BumpKind> {
  throw new Error('sqlite registry store removed; use classifyVersionBumpPrisma');
}

/** Prisma async counterpart of {@link classifyVersionBump}. */
export async function classifyVersionBumpPrisma(
  prisma: PrismaDb,
  opts: ClassifyVersionBumpOptions,
): Promise<BumpKind> {
  const baseFiles = new Map<string, string>();
  if (opts.baseHash) {
    const rows = await prisma.skill_version_files.findMany({
      where: { skill_id: opts.skillId, version_hash: opts.baseHash },
      select: { path: true, blob_hash: true },
    });
    for (const r of rows) baseFiles.set(r.path, r.blob_hash);
  }
  const kind = classifyFileMaps(baseFiles, opts.nextFiles);
  if (kind !== 'skillmd-only') return kind;
  let baseSkillMd: string | null = null;
  const baseBlob = baseFiles.get('SKILL.md');
  if (baseBlob) {
    const bytes = await opts.readBlob(baseBlob);
    baseSkillMd = bytes ? Buffer.from(bytes).toString('utf8') : null;
  }
  return classifyPublishDiff(baseFiles, opts.nextFiles, baseSkillMd, opts.nextSkillMd);
}

/**
 * Fail-closed stand-in for residual dual-path callers outside U3.
 * MySQL uses {@link deriveVersionLabelPrisma}.
 */
export function deriveVersionLabel(
  _db: DatabaseSync,
  _skillId: string,
  _kind: BumpKind,
): { label: VersionLabel; versionLabel: string } {
  throw new Error('sqlite registry store removed; use deriveVersionLabelPrisma');
}

/** Prisma async counterpart of {@link deriveVersionLabel}. */
export async function deriveVersionLabelPrisma(
  prisma: PrismaDb,
  skillId: string,
  kind: BumpKind,
): Promise<{ label: VersionLabel; versionLabel: string }> {
  const maxLabel = await prisma.skill_versions.findFirst({
    where: { skill_id: skillId },
    orderBy: [{ major: 'desc' }, { minor: 'desc' }, { patch: 'desc' }],
    select: { major: true, minor: true, patch: true },
  });
  const label = nextVersionLabel(kind, maxLabel ?? null);
  return { label, versionLabel: formatVersionLabel(label) };
}

/**
 * Fail-closed stand-in for residual dual-path callers outside U3.
 */
export async function computeNextVersionLabel(
  _db: DatabaseSync,
  _opts: ClassifyVersionBumpOptions,
): Promise<{ bumpKind: BumpKind; label: VersionLabel; versionLabel: string }> {
  throw new Error('sqlite registry store removed; use classifyVersionBumpPrisma + deriveVersionLabelPrisma');
}
