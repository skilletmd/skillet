/**
 * Approval lock: global record of user-approved and user-rejected skill content hashes.
 *
 * Lives at $XDG_DATA_HOME/skillet/skillet.lock (distinct from the per-project
 * skillet.lock which tracks pinned versions). An entry records the content hash
 * and author key ID at approval time; the TOCTOU guard re-verifies the hash
 * immediately before materialization.
 *
 * Security invariants:
 *   - Keyed by <skillId>@<version> so each version has an independent approval/rejection.
 *   - contentHash is sha256-prefixed; matching is exact string equality.
 *   - atomicWrite ensures the lock file is never partially written.
 *   - Any I/O error reading the lock is propagated (not silenced), so a corrupt
 *     lock cannot silently bypass approvals.
 *   - Rejections are version-scoped: rejecting v3 does not suppress the prompt for v4.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { atomicWrite } from "../util/atomic.js";

export interface DiffApproval {
  /** sha256-prefixed hash of the materialized content at approval time */
  contentHash: string;
  /** hex-encoded 64-char Ed25519 public key ID of the update author */
  authorKeyId: string;
  /** ISO 8601 approval timestamp */
  approvedAt: string;
}

export interface DiffRejection {
  /** hex-encoded 64-char Ed25519 public key ID of the update author */
  authorKeyId: string;
  /** ISO 8601 rejection timestamp */
  rejectedAt: string;
}

interface ApprovalLockFile {
  version: 1;
  approvals: Record<string, DiffApproval>;
  /** Per-version rejections recorded via non-interactive `skillet reject`. Optional for backward compat. */
  rejections?: Record<string, DiffRejection>;
}

function entryKey(skillId: string, version: number): string {
  return `${skillId}@${version}`;
}

/** Returns the global approval lock path for the current user. */
export function defaultApprovalLockPath(): string {
  const dataHome =
    process.env["XDG_DATA_HOME"] ?? join(homedir(), ".local", "share");
  return join(dataHome, "skillet", "skillet.lock");
}

async function readLock(lockPath: string): Promise<ApprovalLockFile> {
  try {
    const raw = await readFile(lockPath, "utf8");
    return JSON.parse(raw) as ApprovalLockFile;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, approvals: {} };
    }
    throw err;
  }
}

/**
 * Returns true iff the given contentHash matches the previously recorded
 * approval for this skillId@version. Returns false when no approval exists
 * or the hash does not match (triggers re-approval).
 */
export async function checkLock(
  lockPath: string,
  skillId: string,
  version: number,
  contentHash: string
): Promise<boolean> {
  const lock = await readLock(lockPath);
  const entry = lock.approvals[entryKey(skillId, version)];
  if (!entry) return false;
  return entry.contentHash === contentHash;
}

/**
 * Writes an approval record for skillId@version to the lock file.
 * Clears any existing rejection for the same key so that the most-recent
 * decision wins and the two maps cannot hold conflicting states simultaneously.
 * Uses atomicWrite (temp + rename) to prevent partial writes.
 */
export async function recordApproval(
  lockPath: string,
  skillId: string,
  version: number,
  approval: DiffApproval
): Promise<void> {
  const lock = await readLock(lockPath);
  lock.approvals[entryKey(skillId, version)] = approval;
  delete lock.rejections?.[entryKey(skillId, version)];
  await atomicWrite(lockPath, JSON.stringify(lock, null, 2) + "\n", {
    backup: false,
  });
}

/**
 * Returns true iff a rejection was explicitly recorded for this skillId@version
 * via `skillet reject`. Returns false when no rejection exists.
 * Version-scoped: a rejection at v3 does not suppress the prompt for v4.
 */
export async function checkRejection(
  lockPath: string,
  skillId: string,
  version: number
): Promise<boolean> {
  const lock = await readLock(lockPath);
  return !!(lock.rejections?.[entryKey(skillId, version)]);
}

/**
 * Writes a rejection record for skillId@version to the lock file.
 * Clears any existing approval for the same key so that the most-recent
 * decision wins and the two maps cannot hold conflicting states simultaneously.
 * Uses atomicWrite (temp + rename) to prevent partial writes.
 */
export async function recordRejection(
  lockPath: string,
  skillId: string,
  version: number,
  rejection: DiffRejection
): Promise<void> {
  const lock = await readLock(lockPath);
  if (!lock.rejections) lock.rejections = {};
  lock.rejections[entryKey(skillId, version)] = rejection;
  delete lock.approvals[entryKey(skillId, version)];
  await atomicWrite(lockPath, JSON.stringify(lock, null, 2) + "\n", {
    backup: false,
  });
}

/**
 * Returns the highest version number for which an approval was recorded for
 * the given skillId, or null if no approval has been recorded yet.
 * Used by `skillet pending --json` to surface the previously approved version.
 */
export async function getLastApprovedVersion(
  lockPath: string,
  skillId: string
): Promise<number | null> {
  const lock = await readLock(lockPath);
  const prefix = `${skillId}@`;
  let maxVersion: number | null = null;
  for (const key of Object.keys(lock.approvals)) {
    if (key.startsWith(prefix)) {
      const v = parseInt(key.slice(prefix.length), 10);
      if (!isNaN(v) && (maxVersion === null || v > maxVersion)) {
        maxVersion = v;
      }
    }
  }
  return maxVersion;
}
