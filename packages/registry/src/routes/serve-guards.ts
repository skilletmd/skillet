import type { DatabaseSync } from '../db/sqlite-handle.js'
import type { ScanInfo } from '../scanner/index.js';
import type { PrismaDb } from '../db/prisma-client.js';

export interface ServeBlocked {
  status: 409;
  body: { error: string; message: string };
}

/**
 * Blocks serve when the skill is under an admin quarantine (skill-level, all
 * versions). Separate from the per-version scanner gate below: quarantine is a
 * manual enforcement flag on `skills.moderation_status`, not a scan verdict.
 * `unlisted` does NOT block serve — an unlisted skill stays directly fetchable
 * by URL, it is only hidden from discovery.
 *
 * Fail-closed stand-in for residual dual-path callers outside U3.
 * Characterization uses tests/legacy-sqlite-serve-guards.ts; MySQL uses
 * {@link serveBlockForModerationPrisma}.
 */
export function serveBlockForModeration(
  _db: DatabaseSync,
  _skillId: string,
): ServeBlocked | null {
  throw new Error('sqlite registry store removed; use serveBlockForModerationPrisma');
}

export async function serveBlockForModerationPrisma(
  prisma: PrismaDb,
  skillId: string,
): Promise<ServeBlocked | null> {
  const row = await prisma.skills.findUnique({
    where: { id: skillId },
    select: { moderation_status: true },
  })
  if (row?.moderation_status === 'quarantined') {
    return {
      status: 409,
      body: {
        error: 'skill_quarantined',
        message: 'This skill is quarantined by a moderator and cannot be downloaded.',
      },
    }
  }
  return null
}

/**
 * Blocks serve based on an already-read scan row. Split out so callers that
 * also need the scan row for the manifest `scan` field can read it once
 * (getScanInfo) and reuse it here instead of hitting the DB twice.
 */
export function serveBlockForScanFromInfo(
  scan: ScanInfo | null,
): ServeBlocked | null {
  const status = scan?.status ?? 'pending';
  if (status === 'quarantined') {
    return {
      status: 409,
      body: {
        error: 'scan_quarantined',
        message: 'This version is quarantined and cannot be downloaded.',
      },
    };
  }
  if (status === 'pending') {
    return {
      status: 409,
      body: {
        error: 'scan_pending',
        message: 'Harm scan has not completed for this version.',
      },
    };
  }
  return null;
}

/**
 * Fail-closed stand-in for residual dual-path callers outside U3.
 * Characterization uses tests/legacy-sqlite-serve-guards.ts; MySQL uses
 * {@link serveBlockForScanPrisma}.
 */
export function serveBlockForScan(
  _db: DatabaseSync,
  _versionHash: string,
): ServeBlocked | null {
  throw new Error('sqlite registry store removed; use serveBlockForScanPrisma');
}

/** Prisma counterpart of {@link serveBlockForScan} (reads skill_version_scans). */
export async function serveBlockForScanPrisma(
  prisma: PrismaDb,
  versionHash: string,
): Promise<ServeBlocked | null> {
  const bare = versionHash.startsWith('sha256:')
    ? versionHash.slice('sha256:'.length)
    : versionHash
  const scan = await prisma.skill_version_scans.findFirst({
    where: {
      OR: [
        { skill_version_id: versionHash },
        { skill_version_id: bare },
        { skill_version_id: `sha256:${bare}` },
      ],
    },
    select: { status: true },
  })
  // No row → pending (parity with getScanInfo null → pending).
  const status = scan?.status ?? 'pending'
  if (status === 'quarantined') {
    return {
      status: 409,
      body: {
        error: 'scan_quarantined',
        message: 'This version is quarantined and cannot be downloaded.',
      },
    }
  }
  if (status === 'pending') {
    return {
      status: 409,
      body: {
        error: 'scan_pending',
        message: 'Harm scan has not completed for this version.',
      },
    }
  }
  return null
}
