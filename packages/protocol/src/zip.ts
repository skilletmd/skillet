import { zipSync } from 'fflate';
import { assertSafeBundlePath, SKILL_ENTRYPOINT, type DecodedBundle } from './bundle.js';

/**
 * Pack a decoded skill bundle into a `.zip` for export.
 *
 * Lives in the protocol package so both the client (`@skillet/core` → CLI) and
 * the server (`@skillet/registry` download endpoint) share one packer without
 * the registry depending on client code.
 *
 * Determinism: fflate stamps each entry with the current time by default, which
 * would make output non-reproducible. We pin a fixed mtime and pack entries in
 * sorted path order so the same bundle yields byte-stable output within a
 * runtime (fflate writes the DOS timestamp from local-time fields, so the bytes
 * are not guaranteed identical across timezones — the registry keys its ETag on
 * the content hash, not on these bytes, so cross-machine drift is harmless).
 *
 * Safety: every bundle path is re-validated with `assertSafeBundlePath` before
 * it becomes a zip entry name — a zip-slip guard that holds even for an
 * in-memory bundle that never passed the publish validator.
 */

// DOS/zip timestamps must fall in 1980-2099; fflate reads the Date in local
// time, so we pick a mid-year, mid-day local constant that stays in range in
// every timezone. Only its constancy matters for reproducible output.
const FIXED_MTIME = new Date(1985, 5, 15, 12, 0, 0);
const ZIP_OPTS = { level: 6, mtime: FIXED_MTIME } as const;

function collectInto(
  files: Record<string, Uint8Array>,
  bundle: DecodedBundle,
  prefix: string,
): void {
  if (!bundle.has(SKILL_ENTRYPOINT)) {
    throw new Error(`Cannot export bundle: no ${SKILL_ENTRYPOINT} at the bundle root`);
  }
  for (const path of [...bundle.keys()].sort()) {
    assertSafeBundlePath(path);
    files[prefix ? `${prefix}/${path}` : path] = bundle.get(path)!;
  }
}

/**
 * Pack a single skill bundle. With no prefix the `SKILL.md` sits at the zip
 * root — the shape ChatGPT Skills and Claude Projects expect on upload. Pass a
 * `prefix` (e.g. `owner--slug`) to nest it, which kit export uses to keep
 * multiple skills from colliding in one archive.
 */
export function bundleToZip(
  bundle: DecodedBundle,
  opts: { prefix?: string } = {},
): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  collectInto(files, bundle, opts.prefix ?? '');
  return zipSync(files, ZIP_OPTS);
}

/**
 * Pack several skill bundles into one archive, each under its own prefix
 * directory (use `bundleSlugDir` for collision-free `owner--slug` names).
 */
export function bundlesToZip(
  entries: Array<{ prefix: string; bundle: DecodedBundle }>,
): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const { prefix, bundle } of entries) collectInto(files, bundle, prefix);
  return zipSync(files, ZIP_OPTS);
}
