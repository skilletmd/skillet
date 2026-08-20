/**
 * Read-only view of the Skillet canonical store for the MCP transport.
 *
 * The MCP layer is a pure consumer: it reads from `~/.skillet/skills/{slug}/`
 * (the already-gated, already-verified store) and never re-runs registry
 * pull, signature verification, scan, or the trust gate.
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  readState,
  skillContentDir,
  type KitState,
  type SkillEntry,
} from "@skillet/core";
import { resolveSkillFilePath, SkillPathError } from "./skill-path.js";

export { SkillPathError };

export { type KitState, type SkillEntry };

/** Flat list of bundle file paths (POSIX-relative) for a skill in the store. */
export async function listSkillFiles(slug: string): Promise<string[]> {
  const dir = skillContentDir(slug);
  const paths: string[] = [];
  await walkDir(dir, dir, paths);
  paths.sort();
  return paths;
}

async function walkDir(root: string, current: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(current, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    const abs = join(current, e.name);
    if (e.isDirectory()) {
      await walkDir(root, abs, out);
    } else if (e.isFile()) {
      const rel = abs.slice(root.length + 1).replace(/\\/g, "/");
      out.push(rel);
    }
  }
}

/** Read a single file from the skill store. Returns null if not found. */
export async function readSkillFile(
  slug: string,
  bundlePath: string,
): Promise<Buffer | null> {
  const dir = skillContentDir(slug);
  try {
    const abs = await resolveSkillFilePath(dir, bundlePath);
    return await readFile(abs);
  } catch (e) {
    if (e instanceof SkillPathError) throw e;
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

export { readState };

// ── Injectable skill source ───────────────────────────────────────────────────

/**
 * Abstraction over where skills come from. The MCP tool/resource layer reads
 * through this interface; local disk (`localSkillSource`) is the default so
 * CLI/stdio behavior is unchanged. Sources are dumb — auth filtering stays in
 * the caller, and slug/path validation happens before any `readFile` call.
 */
export interface SkillSource {
  /** All skill entries known to this source (pre-auth; caller filters). */
  listEntries(): Promise<SkillEntry[]>;
  /** Flat list of bundle file paths (POSIX-relative) for a skill. */
  listFiles(slug: string): Promise<string[]>;
  /** Read a single bundle file. Returns null if not found. */
  readFile(slug: string, path: string): Promise<Uint8Array | string | null>;
}

/** Default source: the canonical on-disk store (~/.skillet/skills/). */
export const localSkillSource: SkillSource = {
  async listEntries(): Promise<SkillEntry[]> {
    const state = await readState();
    return Object.values(state.skills);
  },
  listFiles(slug: string): Promise<string[]> {
    return listSkillFiles(slug);
  },
  readFile(slug: string, path: string): Promise<Uint8Array | string | null> {
    return readSkillFile(slug, path);
  },
};
