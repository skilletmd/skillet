/**
 * The lock Save holds while it changes this computer (plan U11, KTD10).
 *
 * `~/.skillet/map-save.lock` exists only while a Save (or `skillet map
 * --apply`) is applying: backing up, moving folders, adding picks. A second
 * Save waits for it, and the app's sync skips its tick while it's live. The
 * file names the process holding it; a lock whose process is gone, or one far
 * older than any Save takes, is stale and is cleared. Release removes the file
 * only while it is still this holder's, so a run that outlived its lock never
 * deletes the next one's.
 */
import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { skilletDir } from "../session-token.js";

const LOCK_FILE = "map-save.lock";
/** No Save takes this long; a lock older than this is stale whatever its process. */
const MAX_AGE_MS = 6 * 60 * 60_000;
/** A lock file still being written reads as empty for a moment; give it this long. */
const WRITE_GRACE_MS = 10_000;

export function mapSaveLockPath(): string {
  return join(skilletDir(), LOCK_FILE);
}

/** Who holds the lock. */
export interface MapSaveLockHolder {
  pid: number;
  startedAt: string;
}

export interface MapSaveLock {
  readonly path: string;
  /** Remove the lock if it is still this holder's. Safe to call more than once. */
  release(): Promise<void>;
}

/** Thrown when another live Save still holds the lock after the wait. */
export class MapSaveLockBusy extends Error {
  constructor(readonly holder: MapSaveLockHolder) {
    super("Another Save is running on this machine.");
    this.name = "MapSaveLockBusy";
  }
}

interface LockFile extends MapSaveLockHolder {
  token: string;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: the process exists but belongs to someone else.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function readLockFile(): Promise<{ lock: LockFile | null; ageMs: number } | null> {
  let raw: string;
  let ageMs: number;
  try {
    const info = await stat(mapSaveLockPath());
    ageMs = Date.now() - info.mtimeMs;
    raw = await readFile(mapSaveLockPath(), "utf8");
  } catch {
    return null;
  }
  try {
    const value = JSON.parse(raw) as Partial<LockFile>;
    if (typeof value.pid === "number" && Number.isSafeInteger(value.pid) && value.pid > 0) {
      return {
        lock: {
          pid: value.pid,
          startedAt: typeof value.startedAt === "string" ? value.startedAt : "",
          token: typeof value.token === "string" ? value.token : "",
        },
        ageMs,
      };
    }
  } catch {
    // Not JSON yet (still being written) or not ours: judged by age below.
  }
  return { lock: null, ageMs };
}

function isLive(read: { lock: LockFile | null; ageMs: number }): boolean {
  if (read.lock === null) return read.ageMs < WRITE_GRACE_MS;
  if (read.ageMs > MAX_AGE_MS) return false;
  return processAlive(read.lock.pid);
}

/** The live holder, or null when nothing holds the lock (a stale one counts as nothing). */
export async function readMapSaveLock(): Promise<MapSaveLockHolder | null> {
  const read = await readLockFile();
  if (read === null || !isLive(read) || read.lock === null) return null;
  return { pid: read.lock.pid, startedAt: read.lock.startedAt };
}

/** Whether a live Save holds the lock: what the app's sync checks before its tick. */
export async function isMapSaveLocked(): Promise<boolean> {
  const read = await readLockFile();
  return read !== null && isLive(read);
}

async function tryCreate(): Promise<MapSaveLock | null> {
  const path = mapSaveLockPath();
  await mkdir(skilletDir(), { recursive: true, mode: 0o700 });
  const token = randomBytes(12).toString("hex");
  let handle;
  try {
    handle = await open(path, "wx", 0o600);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return null;
    throw err;
  }
  try {
    const body: LockFile = { pid: process.pid, startedAt: new Date().toISOString(), token };
    await handle.writeFile(JSON.stringify(body) + "\n");
  } finally {
    await handle.close();
  }
  let released = false;
  return {
    path,
    async release() {
      if (released) return;
      released = true;
      const read = await readLockFile();
      if (read?.lock?.token !== token) return;
      try {
        await unlink(path);
      } catch {
        // Already gone.
      }
    },
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

export interface AcquireMapSaveLockOptions {
  /** How long to wait for a live holder. Defaults to 10 minutes. */
  waitMs?: number;
  pollMs?: number;
  /** Called once when the lock is held by someone else, before waiting. */
  onWait?: (holder: MapSaveLockHolder) => void;
  /** Stops the wait; the call then throws. */
  signal?: AbortSignal;
}

/**
 * Take the lock, clearing a stale one and waiting for a live one. Throws
 * {@link MapSaveLockBusy} when a live holder outlasts the wait.
 */
export async function acquireMapSaveLock(opts: AcquireMapSaveLockOptions = {}): Promise<MapSaveLock> {
  const waitMs = opts.waitMs ?? 10 * 60_000;
  const pollMs = opts.pollMs ?? 500;
  const deadline = Date.now() + waitMs;
  let told = false;
  for (;;) {
    const lock = await tryCreate();
    if (lock) return lock;
    const read = await readLockFile();
    // Released between the two reads: try again at once.
    if (read === null) continue;
    if (!isLive(read)) {
      // Stale: clear it, unless another Save already replaced it, and try again.
      const again = await readLockFile();
      if (again !== null && again.lock?.token === read.lock?.token && !isLive(again)) {
        try {
          await unlink(mapSaveLockPath());
        } catch (err) {
          // Someone else cleared it first; anything else would loop forever.
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        }
      }
      continue;
    }
    const holder: MapSaveLockHolder =
      read.lock !== null ? { pid: read.lock.pid, startedAt: read.lock.startedAt } : { pid: 0, startedAt: "" };
    if (opts.signal?.aborted || Date.now() >= deadline) throw new MapSaveLockBusy(holder);
    if (!told) {
      told = true;
      opts.onWait?.(holder);
    }
    await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())), opts.signal);
  }
}
