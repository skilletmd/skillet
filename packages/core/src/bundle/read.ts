import { readdir, readFile, lstat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { BundleError, type DecodedBundle, validateBundle } from '@skillet/protocol';

/**
 * Read a skill bundle from a directory on disk into a path→bytes map.
 *
 * - POSIX-relative paths only (we re-join with `/`); preserves the full subtree.
 * - Rejects symlinks anywhere in the tree (`unsafe_path` per §2.1) before any
 *   bytes are read; a symlink in `references/` could otherwise point at
 *   `~/.ssh/id_ed25519` and pull a key into the bundle.
 * - Validates the resulting bundle (`SKILL.md` at root, size caps, safe paths).
 */
export async function readBundleFromDir(
  skillDir: string,
  opts?: { includeSkilletBackups?: boolean },
): Promise<DecodedBundle> {
  const bundle: DecodedBundle = new Map();
  await walk(skillDir, skillDir, bundle, opts?.includeSkilletBackups === true);
  validateBundle(bundle);
  return bundle;
}

async function walk(
  root: string,
  dir: string,
  out: DecodedBundle,
  includeSkilletBackups: boolean,
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const absPath = join(dir, entry.name);
    // withFileTypes returns the *type from readdir's dirent*, which on most
    // platforms is the lstat type — but we re-lstat to be safe and consistent.
    const st = await lstat(absPath);
    if (st.isSymbolicLink()) {
      throw new BundleError(
        'unsafe_path',
        `Symlink in bundle is rejected (§2.1): ${relative(root, absPath)}`,
      );
    }
    if (st.isDirectory()) {
      await walk(root, absPath, out, includeSkilletBackups);
      continue;
    }
    if (!st.isFile()) {
      // sockets, fifos, devices — none of these belong in a skill bundle.
      throw new BundleError(
        'unsafe_path',
        `Non-regular file in bundle is rejected: ${relative(root, absPath)}`,
      );
    }
    if (!includeSkilletBackups && entry.name.endsWith('.skillet-backup')) {
      continue;
    }
    const rel = relative(root, absPath);
    // Convert host separator to POSIX. On Windows this turns "agents\\r.md" into
    // "agents/r.md" so the canonical hash (which hashes path bytes) is stable.
    const posix = sep === '/' ? rel : rel.split(sep).join('/');
    const bytes = await readFile(absPath);
    out.set(posix, bytes);
  }
}
