/**
 * One skill folder as the kit map keys it, and the backup the registry takes
 * for it: what Save (./apply.ts), the merge step (./merge-run.ts) and the map
 * trash (./remove-trash.ts) share. A leaf: it imports nothing else from the
 * map, so none of them import each other for it.
 */
import type { Dirent } from "node:fs";
import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import { SKILL_ENTRYPOINT, isSkilletBackupPath, type BundleFiles, type DecodedBundle } from "@skillet/protocol";
import type { KitMapMergeSource } from "@skillet/protocol/kit-map";

/** What a backup carries besides its hash: the registry's `PUT /backups/:hash` body. */
export interface MapBackupBody {
  files: BundleFiles;
  name: string;
  description: string;
  tools: string[];
  /** `scan`: a skill of the person's own, as Save found it. `merge`: a merged skill this computer wrote (./merge-run.ts). */
  origin: "scan" | "merge";
  /** A merge's sources, one per original: named when public, counted when private. */
  sources?: KitMapMergeSource[];
}

/** `final`: retrying won't help (a secret, a quota, a size cap); otherwise the next run tries again. */
export type MapBackupPut = { ok: true } | { ok: false; reason: string; file?: string; final: boolean };

/** A skill that is one SKILL.md and nothing else, as every merged skill is. */
export function skillMdBundle(skill: string): DecodedBundle {
  return new Map([[SKILL_ENTRYPOINT, Buffer.from(skill, "utf8")]]);
}

/** Present without following links: a link counts, so nothing is ever moved onto or through one. */
export async function present(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

type EntryKind = Pick<Dirent, "isFile" | "isDirectory" | "isSymbolicLink">;

/**
 * What a listed entry is, as its listing says, without following a link. Only
 * a listing that doesn't say (some filesystems leave the type unknown) costs
 * an lstat, which answers the same question.
 */
export async function entryKind(entry: Dirent, abs: string): Promise<EntryKind> {
  const known =
    entry.isFile() ||
    entry.isDirectory() ||
    entry.isSymbolicLink() ||
    entry.isFIFO() ||
    entry.isSocket() ||
    entry.isBlockDevice() ||
    entry.isCharacterDevice();
  return known ? entry : lstat(abs);
}

async function walkSkill(dir: string, rel: string, out: DecodedBundle): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const name = entry.name;
    if (name.startsWith(".") || isSkilletBackupPath(name)) continue;
    const abs = join(dir, name);
    const relPath = rel === "" ? name : `${rel}/${name}`;
    const info = await entryKind(entry, abs);
    if (info.isSymbolicLink()) {
      // A link is never part of a skill, except a linked SKILL.md, read as SKILL.md.
      if (relPath === SKILL_ENTRYPOINT) {
        const target = await realpath(abs);
        if ((await stat(target)).isFile()) out.set(SKILL_ENTRYPOINT, await readFile(target));
      }
      continue;
    }
    if (info.isDirectory()) await walkSkill(abs, relPath, out);
    else if (info.isFile()) out.set(relPath, await readFile(abs));
  }
}

/**
 * A skill folder's files by the scan's key rule (./scan.ts): the folder is
 * walked without following links, names that start with a dot and Skillet's
 * `*.skillet-backup` files are skipped, and a linked SKILL.md is read as
 * SKILL.md. Its canonical hash is the scan's key for it.
 */
export async function readMapSkillBundle(dir: string): Promise<DecodedBundle> {
  const out: DecodedBundle = new Map();
  await walkSkill(await realpath(dir), "", out);
  return out;
}
