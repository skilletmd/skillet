/**
 * The kit map's trash (plan U11, KTD8; R19).
 *
 * Remove moves a skill folder out of a tool's skills folder into
 * `~/.skillet/map-trash/<stamp>/`, one run per Save, with a ledger naming each
 * folder, the allowed root it came from, and where it went. This is a root of
 * its own on purpose: today's `listTrash`, `restoreTrash` sweep and
 * `clearOldTrash` read `~/.skillet/trash`, and an older Skillet sharing
 * `~/.skillet` (the app's bundled CLI, an older global install) would age these
 * runs out after 30 days or re-import them. Nothing here ever deletes a run.
 *
 * The ledger is a file the person (or anything running as them) can write, so
 * restore trusts none of its paths on their own: a folder goes back only to
 * `<root>/<folder>`, where `root` is exactly one of the compile-time allowed
 * roots (util/pathsafe.ts) and `folder` is one plain name, and it comes only
 * from inside its own run. Restore never overwrites and never re-imports into
 * the kit store; `skillet restore` lists these runs beside today's.
 *
 * A replace (plan U15, KTD8 KTD13) writes a run of its own kind, `map-replace`:
 * the originals it moved, plus the merged skill folders it put in their place,
 * the merge they came from and its content hash. Restoring one first moves
 * each of those merged folders to the map trash, but only one that still holds
 * exactly the bytes this computer's own merge record names, then puts the
 * originals back. Any other folder at an original's path blocks that original,
 * as it would any restore.
 */
import { readdir, readFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { canonicalContentHash } from "@skillet/protocol";
import { KIT_MAP_HASH_RE } from "@skillet/protocol/kit-map";
import { skilletDir } from "../session-token.js";
import { atomicWrite } from "../util/atomic.js";
import { isMapFolderRoot, mapFolderRootOf } from "../util/pathsafe.js";
import { LEDGER_STAMP, ledgerStamp, moveDir } from "../commands/edits-store.js";
import { readMapMergeRecord } from "./merge-run.js";
import { present, readMapSkillBundle } from "./skill-fs.js";

/** The folder under `~/.skillet` that holds map-remove runs. */
export const MAP_TRASH_DIRNAME = "map-trash";
/** The run kind Remove writes and restores. */
export const MAP_REMOVE_RUN = "map-remove";
/** The run kind a replace writes: the originals it moved and the merged folders it put in their place. */
export const MAP_REPLACE_RUN = "map-replace";

/** The two kinds of map-trash run, as `skillet restore` lists them. */
export type MapRunKind = typeof MAP_REMOVE_RUN | typeof MAP_REPLACE_RUN;

const MANIFEST = "manifest.json";

export function mapTrashRoot(): string {
  return join(skilletDir(), MAP_TRASH_DIRNAME);
}

/** One folder Remove should move: a copy of one skill, as a fresh scan found it. */
export interface MapTrashTarget {
  /** The skill's content hash. */
  key: string;
  /** Its name on the map, for listing and restore. */
  name: string;
  /** Only the person's own folders and Skillet's imports are ever moved. */
  source: "local" | "skillet-imported";
  /** The folder, or the link to it, as its tools see it. */
  path: string;
}

/** One moved folder, as the run's ledger records it. */
export interface MapTrashItem extends MapTrashTarget {
  /** The allowed root it sat in, spelled as the allowlist spells it. */
  root: string;
  /** Its name in that root. */
  folder: string;
  /** `<root>/<folder>`: where restore puts it back (the same folder as `path`). */
  from: string;
  /** Where it went, inside its run. */
  to: string;
}

export type MapTrashSkipReason = "outside-allowlist" | "missing" | "move-failed";

export interface MapTrashSkip {
  key: string;
  name: string;
  path: string;
  reason: MapTrashSkipReason;
}

export interface MapTrashResult {
  /** The run's id (its stamp), or null when nothing moved. */
  runId: string | null;
  moved: MapTrashItem[];
  skipped: MapTrashSkip[];
}

/** A merged skill folder a replace put in place of its originals, at `<root>/<folder>`. */
export interface MapPlacedFolder {
  /** The allowed root, spelled as the allowlist spells it. */
  root: string;
  folder: string;
  /** `<root>/<folder>`. */
  from: string;
}

/** What a replace run records besides the originals it moved. */
export interface MapReplaceRecord {
  /** The replace change it applied. */
  change: string;
  /** The merge it put in place: its change id, which names this computer's merge record. */
  merge: string;
  /** The merged skill's content hash. */
  merged: string;
  /** Every merged folder in place of the originals, written by this run or found already there. */
  placed: MapPlacedFolder[];
  /** Another maker's originals taken out of the kit, which sync then removes. */
  kit: Array<{ key: string; owner: string; slug: string }>;
}

interface MapTrashLedger {
  trashedAt: string;
  kind: string;
  items: unknown[];
  /** Set on a replace run only. */
  change?: unknown;
  merge?: unknown;
  merged?: unknown;
  placed?: unknown;
  kit?: unknown;
}

/** A map-remove or map-replace run, in the shape `skillet restore` lists. */
export interface MapTrashRun {
  id: string;
  trashedAt: string;
  kind: MapRunKind;
  /** The names of the skills in it, once each. */
  skills: string[];
}

/** A replace run, as the next apply reads it back to finish what it started. */
export interface MapReplaceRun extends MapReplaceRecord {
  id: string;
  /** The originals it moved: their content hashes and roots. */
  moved: Array<{ key: string; root: string }>;
}

/** What restoring a run did, in the shape `skillet restore` prints. */
export interface MapTrashRestore {
  runId: string;
  restored: string[];
  /** Always empty: a map-remove restore never re-imports. */
  reimported: string[];
  skipped: Array<{ slug: string; reason: string }>;
}

async function writeLedger(runDir: string, ledger: MapTrashLedger): Promise<void> {
  await atomicWrite(join(runDir, MANIFEST), JSON.stringify(ledger, null, 2) + "\n", { backup: false });
}

/**
 * Move each target into one new run. The ledger is written before the first
 * move and again after the last, so a run cut short still lists every folder
 * it may have moved, and restore skips the ones that never left. A folder that
 * is already gone is skipped, so running the same Remove again moves nothing.
 *
 * With `replace`, the run is a replace's: its ledger also names the merge and
 * the merged folders in place of the originals, and it is written even when no
 * folder moves, so the next apply knows what a replace already did.
 */
export async function trashMapFolders(
  targets: readonly MapTrashTarget[],
  replace?: MapReplaceRecord,
): Promise<MapTrashResult> {
  const skipped: MapTrashSkip[] = [];
  const planned: MapTrashItem[] = [];
  const stamp = ledgerStamp();
  const runDir = join(mapTrashRoot(), stamp);
  const seen = new Set<string>();

  for (const target of targets) {
    const root = mapFolderRootOf(target.path);
    if (root === null) {
      skipped.push({ key: target.key, name: target.name, path: target.path, reason: "outside-allowlist" });
      continue;
    }
    if (seen.has(target.path)) continue;
    seen.add(target.path);
    if (!(await present(target.path))) {
      skipped.push({ key: target.key, name: target.name, path: target.path, reason: "missing" });
      continue;
    }
    const folder = basename(target.path);
    planned.push({
      ...target,
      root,
      folder,
      // The root's own spelling: restore puts it back at exactly `<root>/<folder>`.
      from: join(root, folder),
      to: join(runDir, String(planned.length), folder),
    });
  }
  if (planned.length === 0 && replace === undefined) return { runId: null, moved: [], skipped };

  const trashedAt = new Date().toISOString();
  const kind = replace === undefined ? MAP_REMOVE_RUN : MAP_REPLACE_RUN;
  const ledger = (items: MapTrashItem[]): MapTrashLedger => ({ trashedAt, kind, items, ...(replace ?? {}) });
  await writeLedger(runDir, ledger(planned));
  const moved: MapTrashItem[] = [];
  for (const item of planned) {
    if (await moveDir(item.path, item.to)) moved.push(item);
    else skipped.push({ key: item.key, name: item.name, path: item.path, reason: "move-failed" });
  }
  await writeLedger(runDir, ledger(moved));
  return { runId: moved.length > 0 || replace !== undefined ? stamp : null, moved, skipped };
}

async function readLedger(runDir: string): Promise<MapTrashLedger | null> {
  try {
    const value = JSON.parse(await readFile(join(runDir, MANIFEST), "utf8")) as unknown;
    if (typeof value !== "object" || value === null) return null;
    const ledger = value as Partial<MapTrashLedger>;
    if (
      (ledger.kind !== MAP_REMOVE_RUN && ledger.kind !== MAP_REPLACE_RUN) ||
      typeof ledger.trashedAt !== "string" ||
      !Array.isArray(ledger.items)
    ) {
      return null;
    }
    return ledger as MapTrashLedger;
  } catch {
    return null;
  }
}

function itemName(item: unknown): string {
  const name = (item as { name?: unknown } | null)?.name;
  return typeof name === "string" && name.length > 0 ? name : "a skill";
}

async function runIds(): Promise<string[]> {
  try {
    return (await readdir(mapTrashRoot(), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && LEDGER_STAMP.test(entry.name))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * Every map-remove and map-replace run with something in it to restore, newest
 * first. Never touches a folder that isn't a run.
 */
export async function listMapTrash(): Promise<MapTrashRun[]> {
  const runs: MapTrashRun[] = [];
  for (const id of await runIds()) {
    const ledger = await readLedger(join(mapTrashRoot(), id));
    if (!ledger || ledger.items.length === 0) continue;
    runs.push({
      id,
      trashedAt: ledger.trashedAt,
      kind: ledger.kind === MAP_REPLACE_RUN ? MAP_REPLACE_RUN : MAP_REMOVE_RUN,
      skills: [...new Set(ledger.items.map(itemName))],
    });
  }
  return runs.sort((a, b) => b.id.localeCompare(a.id));
}

const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0;

/**
 * A folder a ledger names, `<root>/<folder>`, or null when it points anywhere
 * a map folder can't be: `root` exactly one of the compile-time allowed roots,
 * `folder` one plain name, and `from` spelled as the two joined. A merged
 * folder a replace placed, and where a moved original goes back to.
 */
function placedOf(value: unknown): MapPlacedFolder | null {
  if (typeof value !== "object" || value === null) return null;
  const { root, folder, from } = value as Record<string, unknown>;
  if (typeof root !== "string" || !isMapFolderRoot(root) || !isPlainName(folder)) return null;
  const dest = join(root, folder);
  if (from !== dest || mapFolderRootOf(dest) !== root) return null;
  return { root, folder, from: dest };
}

/** The replace record a ledger holds, or null for a remove run or one that doesn't read. */
function replaceOf(ledger: MapTrashLedger): MapReplaceRecord | null {
  if (ledger.kind !== MAP_REPLACE_RUN) return null;
  if (!isText(ledger.change) || !isText(ledger.merge) || typeof ledger.merged !== "string" || !KIT_MAP_HASH_RE.test(ledger.merged)) {
    return null;
  }
  const placed = Array.isArray(ledger.placed) ? ledger.placed.map(placedOf).filter((p): p is MapPlacedFolder => p !== null) : [];
  const kit = Array.isArray(ledger.kit)
    ? ledger.kit.flatMap((k) => {
        const { key, owner, slug } = (k ?? {}) as Record<string, unknown>;
        return typeof key === "string" && KIT_MAP_HASH_RE.test(key) && isText(owner) && isText(slug) ? [{ key, owner, slug }] : [];
      })
    : [];
  return { change: ledger.change, merge: ledger.merge, merged: ledger.merged, placed, kit };
}

/** Every replace run, oldest first, as the next apply reads them back (never to restore from). */
export async function listMapReplaceRuns(): Promise<MapReplaceRun[]> {
  const runs: MapReplaceRun[] = [];
  for (const id of (await runIds()).sort()) {
    const ledger = await readLedger(join(mapTrashRoot(), id));
    const replace = ledger ? replaceOf(ledger) : null;
    if (!ledger || !replace) continue;
    const moved = ledger.items.flatMap((item) => {
      const { key, root } = (item ?? {}) as Record<string, unknown>;
      return typeof key === "string" && typeof root === "string" ? [{ key, root }] : [];
    });
    runs.push({ id, ...replace, moved });
  }
  return runs;
}

/** A plain folder name: one segment, no traversal, no dot-folder. */
function isPlainName(name: unknown): name is string {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    !name.includes("\x00") &&
    !name.includes("/") &&
    !name.includes("\\") &&
    !name.startsWith(".")
  );
}

/** The trashed copy, or null unless it sits inside this run. */
function sourceOf(item: Record<string, unknown>, runDir: string): string | null {
  const { to } = item;
  if (typeof to !== "string" || to.includes("\x00") || !isAbsolute(to)) return null;
  const rel = relative(runDir, resolve(to));
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel) || rel.split(sep).includes("..")) return null;
  return to;
}

/**
 * Put a map-remove run back (see the module comment). Null when there is no
 * such run. An item is skipped, never forced, when its ledger entry points
 * anywhere it shouldn't, when a folder now sits at its path, or when its
 * trashed copy is gone. Running it twice restores nothing the second time.
 */
export async function restoreMapTrash(runId: string): Promise<MapTrashRestore | null> {
  if (!LEDGER_STAMP.test(runId)) return null;
  const runDir = join(mapTrashRoot(), runId);
  const ledger = await readLedger(runDir);
  if (!ledger) return null;

  const restored: string[] = [];
  const skipped: MapTrashRestore["skipped"] = [];
  const replace = replaceOf(ledger);
  if (replace) await clearPlaced(replace, skipped);
  for (const raw of ledger.items) {
    const name = itemName(raw);
    const item = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    const dest = placedOf(item)?.from ?? null;
    if (dest === null) {
      skipped.push({ slug: name, reason: "unsafe_destination" });
      continue;
    }
    const from = sourceOf(item, runDir);
    if (from === null) {
      skipped.push({ slug: name, reason: "unsafe_source" });
      continue;
    }
    if (await present(dest)) {
      skipped.push({ slug: name, reason: "destination_exists" });
      continue;
    }
    if (!(await present(from))) {
      skipped.push({ slug: name, reason: "trash_missing" });
      continue;
    }
    if (await moveDir(from, dest)) {
      if (!restored.includes(name)) restored.push(name);
    } else {
      skipped.push({ slug: name, reason: "move_failed" });
    }
  }
  return { runId, restored, reimported: [], skipped };
}

/**
 * A replace's merged folders go to the map trash before its originals come
 * back: each one that still holds exactly the merged skill this computer's own
 * merge record names. One that changed since is left where it is.
 */
async function clearPlaced(replace: MapReplaceRecord, skipped: MapTrashRestore["skipped"]): Promise<void> {
  const record = await readMapMergeRecord(replace.merge);
  const name = record?.name ?? "the merged skill";
  const targets: MapTrashTarget[] = [];
  for (const placed of replace.placed) {
    if (!(await present(placed.from))) continue;
    let hash: string | null = null;
    try {
      hash = canonicalContentHash(await readMapSkillBundle(placed.from));
    } catch {
      hash = null;
    }
    if (record === null || record.merged !== replace.merged || hash !== replace.merged) {
      skipped.push({ slug: name, reason: "merged_changed" });
      continue;
    }
    targets.push({ key: replace.merged, name, source: "local", path: placed.from });
  }
  if (targets.length > 0) await trashMapFolders(targets);
}
