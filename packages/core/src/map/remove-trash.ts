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
 */
import { lstat, readdir, readFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { skilletDir } from "../session-token.js";
import { atomicWrite } from "../util/atomic.js";
import { isMapFolderRoot, mapFolderRootOf } from "../util/pathsafe.js";
import { LEDGER_STAMP, ledgerStamp, moveDir } from "../commands/edits-store.js";

/** The folder under `~/.skillet` that holds map-remove runs. */
export const MAP_TRASH_DIRNAME = "map-trash";
/** The run kind this module writes and restores. */
export const MAP_REMOVE_RUN = "map-remove";

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

interface MapTrashLedger {
  trashedAt: string;
  kind: string;
  items: unknown[];
}

/** A map-remove run, in the shape `skillet restore` lists. */
export interface MapTrashRun {
  id: string;
  trashedAt: string;
  kind: typeof MAP_REMOVE_RUN;
  /** The names of the skills in it, once each. */
  skills: string[];
}

/** What restoring a run did, in the shape `skillet restore` prints. */
export interface MapTrashRestore {
  runId: string;
  restored: string[];
  /** Always empty: a map-remove restore never re-imports. */
  reimported: string[];
  skipped: Array<{ slug: string; reason: string }>;
}

/** Present without following links: a link counts, so nothing is ever moved onto or through one. */
async function present(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function writeLedger(runDir: string, ledger: MapTrashLedger): Promise<void> {
  await atomicWrite(join(runDir, MANIFEST), JSON.stringify(ledger, null, 2) + "\n", { backup: false });
}

/**
 * Move each target into one new run. The ledger is written before the first
 * move and again after the last, so a run cut short still lists every folder
 * it may have moved, and restore skips the ones that never left. A folder that
 * is already gone is skipped, so running the same Remove again moves nothing.
 */
export async function trashMapFolders(targets: readonly MapTrashTarget[]): Promise<MapTrashResult> {
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
  if (planned.length === 0) return { runId: null, moved: [], skipped };

  const trashedAt = new Date().toISOString();
  await writeLedger(runDir, { trashedAt, kind: MAP_REMOVE_RUN, items: planned });
  const moved: MapTrashItem[] = [];
  for (const item of planned) {
    if (await moveDir(item.path, item.to)) moved.push(item);
    else skipped.push({ key: item.key, name: item.name, path: item.path, reason: "move-failed" });
  }
  await writeLedger(runDir, { trashedAt, kind: MAP_REMOVE_RUN, items: moved });
  return { runId: moved.length > 0 ? stamp : null, moved, skipped };
}

async function readLedger(runDir: string): Promise<MapTrashLedger | null> {
  try {
    const value = JSON.parse(await readFile(join(runDir, MANIFEST), "utf8")) as unknown;
    if (typeof value !== "object" || value === null) return null;
    const ledger = value as Partial<MapTrashLedger>;
    if (ledger.kind !== MAP_REMOVE_RUN || typeof ledger.trashedAt !== "string" || !Array.isArray(ledger.items)) {
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

/** Every map-remove run, newest first. Never touches a folder that isn't a run. */
export async function listMapTrash(): Promise<MapTrashRun[]> {
  let names: string[];
  try {
    names = (await readdir(mapTrashRoot(), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && LEDGER_STAMP.test(entry.name))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
  const runs: MapTrashRun[] = [];
  for (const id of names) {
    const ledger = await readLedger(join(mapTrashRoot(), id));
    if (!ledger) continue;
    runs.push({
      id,
      trashedAt: ledger.trashedAt,
      kind: MAP_REMOVE_RUN,
      skills: [...new Set(ledger.items.map(itemName))],
    });
  }
  return runs.sort((a, b) => b.id.localeCompare(a.id));
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

/** Where an item may go back to, or null when its ledger entry can't be trusted. */
function destinationOf(item: Record<string, unknown>): string | null {
  const { root, folder, from } = item;
  if (typeof root !== "string" || !isMapFolderRoot(root) || !isPlainName(folder)) return null;
  const dest = join(root, folder);
  if (from !== dest || mapFolderRootOf(dest) !== root) return null;
  return dest;
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
  for (const raw of ledger.items) {
    const name = itemName(raw);
    const item = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    const dest = destinationOf(item);
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
