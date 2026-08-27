import { readFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import type { DecodedBundle } from '@skillet/protocol';
import { isSkilletBackupPath } from '@skillet/protocol';
import { fromSlugDir } from '@skillet/protocol/skill-id';
import { atomicWrite } from '../util/atomic.js';
import { assertNoPathEscape } from '../util/pathsafe.js';

/**
 * Atomic write that SKIPS the write when the destination is already byte-identical.
 *
 * A full `skillet sync` re-materializes every skill into every detected adapter on
 * every run. Without this guard an unchanged sync rewrites hundreds of files — each
 * a backup-copy + temp-write + fsync + rename + dir-fsync — and takes 10s+. A read
 * is far cheaper than that durable write, so comparing first makes an unchanged sync
 * near-instant. Callers still report the path as "written" — the file IS
 * materialized on disk, it just didn't need rewriting.
 */
async function writeFileIfChanged(dest: string, buf: Buffer): Promise<void> {
  try {
    if ((await readFile(dest)).equals(buf)) return;
  } catch {
    // missing / unreadable → fall through and write it
  }
  // backup: false — this function is never called over a hand-edited dir.
  // One layer up, sync detects drift against `entry.hash` and marks the
  // skill `customized_from`; from then on the skill is never materialized
  // over — the edit stays live in the folder forever, and this function is
  // simply skipped for it. There is no heal. A backup is only ever taken at
  // reconcile time (Take theirs / Restore original), written to
  // `~/.skillet/edits` before that action replaces the user's version.
  await atomicWrite(dest, buf, { backup: false });
}

/**
 * Materialize a bundle into a directory using the layout `<root>/<owner>--<slug>/<bundle paths>`.
 *
 * Each file is written atomically (temp + rename); no backup files are
 * written here. Hand-edits are preserved by never calling this function
 * over them — sync marks a drifted skill `customized_from` and leaves it
 * live in place; backups happen only at reconcile time (Take theirs /
 * Restore original), not here. Every target path is validated against the per-runtime root
 * allowlist AND a path-escape check — the bundle path is POSIX-relative but
 * is joined back into the host directory, so a malicious `references/../../`
 * would otherwise reach outside `targetSlugDir`. The protocol validators on
 * publish should catch this earlier; this is defense in depth.
 *
 * @param adapterRoot The allowlisted runtime root (e.g. `~/.claude/skills`).
 * @param slugDir     The owner-prefixed skill dir name (e.g. `@taylor--festival-ops`).
 * @param bundle      The decoded bundle to write.
 * @returns           The list of written absolute paths, in stable lexicographic order.
 */
export async function writeBundleToDir(
  adapterRoot: string,
  slugDir: string,
  bundle: DecodedBundle,
): Promise<string[]> {
  const written: string[] = [];

  // Hash paths in a stable order so test assertions are predictable.
  const paths = [...bundle.keys()].sort();

  for (const bundlePath of paths) {
    if (isSkilletBackupPath(bundlePath)) continue;
    // `slugDir/bundlePath` is the path *relative to the adapter root*.
    // Defense in depth: even though `assertSafeBundlePath` (via the publish
    // validator) already rejected `..`, re-check that the joined path can't
    // escape the allowlisted root. Allowlist enforcement is the adapter's
    // job (`validateMaterializationPath` on the slug dir before calling us).
    const rel = `${slugDir}/${bundlePath}`;
    assertNoPathEscape(adapterRoot, rel);
    // Translate POSIX path to host separators for the actual write.
    const hostRel = sep === '/' ? rel : rel.split('/').join(sep);
    const dest = join(adapterRoot, hostRel);
    const bytes = bundle.get(bundlePath)!;
    await writeFileIfChanged(dest, Buffer.from(bytes));
    written.push(dest);
  }

  return written;
}

/**
 * Write a flat map of POSIX-relative paths under `root`.
 *
 * Unlike `writeBundleToDir`, no `<owner>--<slug>` directory prefix is
 * implied — the adapter chooses the layout. Used by project-scoped
 * adapters (Cursor) whose runtime native format is a flat set of
 * rule files (e.g. `.cursor/rules/<slug>.mdc`).
 *
 * Same atomicity + path-escape guarantees as `writeBundleToDir`. Caller is
 * responsible for validating `root` (e.g. via `validateProjectAdapterRoot`
 * for project adapters).
 */
export async function writeFilesToRoot(
  root: string,
  files: DecodedBundle | Record<string, Uint8Array>,
): Promise<string[]> {
  const written: string[] = [];
  const entries =
    files instanceof Map
      ? [...files.entries()]
      : Object.entries(files);
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  for (const [rel, bytes] of entries) {
    if (isSkilletBackupPath(rel)) continue;
    if (!rel || rel.length === 0) {
      throw new Error(`Path rejected: empty target path`);
    }
    if (rel.includes('\0')) {
      throw new Error(`Path rejected: null byte in path`);
    }
    assertNoPathEscape(root, rel);
    const hostRel = sep === '/' ? rel : rel.split('/').join(sep);
    const dest = join(root, hostRel);
    await writeFileIfChanged(dest, Buffer.from(bytes));
    written.push(dest);
  }
  return written;
}

/**
 * The owner-prefixed slug directory for a skill, e.g. `@taylor--festival-ops`.
 *
 * §6.4: "Bundles write as `<adapter-root>/<owner>--<slug>/<bundle paths>`.
 * The `owner--` prefix prevents cross-author collisions."
 *
 * Owner is optional during early v1 — a slug-only skill (no handle yet) is
 * permitted; we still apply a `_local--` prefix so the unowned namespace can
 * never collide with a real handle.
 */
export interface MaterializeDirOptions {
  dirName?: string;
}

/**
 * Resolve the on-disk skill directory name for adapter materialization.
 * When `dirName` is set (e.g. bundled `@skillet/route` → `skillet`), we use it
 * verbatim so runtimes that key slash commands off the folder name expose `/skillet`.
 */
export function materializeSlugDir(
  slug: string,
  owner?: string | null,
  opts?: MaterializeDirOptions,
): string {
  const dirName = opts?.dirName;
  if (dirName) {
    if (!/^[a-z0-9-]{1,63}$/.test(dirName)) {
      throw new Error(`unsafe materialize dirName: ${JSON.stringify(dirName)}`);
    }
    return dirName;
  }
  return bundleSlugDir(slug, owner);
}

export function bundleSlugDir(slug: string, owner?: string | null): string {
  if (owner && owner.length > 0) {
    // Defense in depth: this dir name feeds filesystem sinks (materialize and
    // now the prune's rm/rename). Callers pass regex-gated author handles, but
    // enforce path-safety at the sink so a future caller can't introduce a
    // traversal via `owner` (e.g. `..` or a path separator).
    if (!/^@?[a-z0-9-]{1,40}$/.test(owner)) {
      throw new Error(`unsafe owner for bundle dir: ${JSON.stringify(owner)}`);
    }
    // KEPT LOCAL (not delegated to the shared `toSlugDirParts`): this encoder
    // PRESERVES a leading `@` in the emitted dir name (`@alice--slug`), while
    // the shared converter strips it (`alice--slug`). Existing on-disk dirs and
    // the bundle tests depend on the `@` being preserved, so the shared module
    // cannot express this without a regression. It also intentionally does not
    // grammar-validate `slug` here (the looser `[a-z0-9-]` owner gate is the
    // only sink check). See U2 report.
    return `${owner}--${slug}`;
  }
  return `_local--${slug}`;
}

/**
 * True when `name` is a Skillet materialized skill directory (§6.4), e.g.
 * `thiago--skillet-sync`, `@thiago--skillet-sync`, or `_local--my-skill`.
 *
 * Delegates the decode to the shared `fromSlugDir` (single source of truth):
 * a name is a Skillet dir iff it decodes to an `{ owner, slug }`.
 */
export function isSkilletSlugDirName(name: string): boolean {
  return fromSlugDir(name) !== null;
}

/**
 * Parse a Skillet slug dir back into owner (no `@`) + bare slug; null if not
 * Skillet layout. Delegates to the shared `fromSlugDir` — same `skillet`→route
 * mapping, `_local--` unowned handling, and leading-`@` strip.
 */
export function parseSkilletSlugDir(
  name: string,
): { owner: string | null; slug: string } | null {
  return fromSlugDir(name);
}
