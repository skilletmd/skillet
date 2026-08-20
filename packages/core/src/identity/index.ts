/**
 * Local identity record: ties a handle on the registry to the Ed25519 key
 * held in the user's signing keystore. Stored at $SKILLET_DIR/identity.json,
 * mode 0600 — owner-only.
 *
 * No OAuth in v1. The Ed25519 key IS the per-device credential; the registry
 * gates write paths on it. `npx skilletmd` / sync need no OAuth; login/claim
 * happens at first publish.
 */
import { readFile, mkdir, chmod, lstat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { atomicWrite } from "../util/atomic.js";
import { enforcesUnixFilePermissions } from "../util/unix-perms.js";

const SKILLET_DIR = process.env["SKILLET_DIR"] ?? join(homedir(), ".skillet");

export interface Identity {
  handle: string;
  keyId: string;
  registryUrl: string;
  createdAt: string;
}

export function identityPath(): string {
  return join(SKILLET_DIR, "identity.json");
}

export async function saveIdentity(id: Identity): Promise<void> {
  await mkdir(SKILLET_DIR, { recursive: true, mode: 0o700 });
  const path = identityPath();
  await atomicWrite(path, JSON.stringify(id, null, 2) + "\n", { backup: false, mode: 0o600 });
  await chmod(path, 0o600); // defense-in-depth: ensure mode even if umask widened it
}

export async function loadIdentity(): Promise<Identity | null> {
  const path = identityPath();
  let info;
  try {
    info = await lstat(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  if (info.isSymbolicLink()) {
    throw new Error(
      `Identity file ${path} is a symlink; refusing to load`
    );
  }
  if ((enforcesUnixFilePermissions() && (info.mode & 0o077) !== 0)) {
    const perm = (info.mode & 0o777).toString(8).padStart(4, "0");
    throw new Error(
      `Identity file ${path} has insecure permissions ${perm}; expected 0600`
    );
  }
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as Identity;
}
