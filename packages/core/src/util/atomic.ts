import { type FileHandle, open, rename, copyFile, mkdir, access, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function fsyncDirectory(dir: string): Promise<void> {
  if (process.platform === "win32") {
    return;
  }
  const dirFd = await open(dir, "r");
  try {
    await dirFd.sync();
  } finally {
    await dirFd.close();
  }
}

export async function atomicWrite(
  dest: string,
  content: string | Buffer,
  opts: { backup?: boolean; mode?: number; fsync?: boolean } = {}
): Promise<void> {
  const dir = dirname(dest);
  await mkdir(dir, { recursive: true });

  if (opts.backup !== false && (await exists(dest))) {
    const backupPath = `${dest}.skillet-backup`;
    await copyFile(dest, backupPath);
  }

  const tmp = join(dir, `.skillet-tmp-${randomBytes(6).toString("hex")}`);
  let fd: FileHandle | null = null;
  try {
    fd = await open(tmp, "w", opts.mode);
    const buf = typeof content === "string" ? Buffer.from(content, "utf8") : content;
    await fd.write(buf);
    // Durability fsync is on by default; opt out (fsync: false) for soft caches
    // where the atomic rename is wanted but a per-write disk flush is not.
    if (opts.fsync !== false) await fd.sync();
    await fd.close();
    fd = null;
    await rename(tmp, dest);
    if (opts.fsync !== false) await fsyncDirectory(dir);
  } catch (err) {
    if (fd !== null) {
      try { await fd.close(); } catch { /* ignore */ }
      fd = null;
    }
    // Static unlink, not a dynamic import(): bundled sidecars can't resolve a
    // runtime import of a node builtin, so it would throw and leak the temp file.
    try {
      await unlink(tmp);
    } catch {
      // best effort
    }
    throw err;
  }
}
