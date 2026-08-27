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

// ── Discovery source (optional; hosted transport only) ───────────────────────

/**
 * Reaching PUBLIC content, as distinct from the caller's kit.
 *
 * `SkillSource` above is kit-scoped and both transports implement it. Summon
 * needs the opposite: everyone else's public skills. Widening `SkillSource`
 * would force the on-disk loopback store to implement registry lookups it has
 * no business doing and would put a network concept into a package that
 * currently has none, so this is a separate capability the host may omit.
 *
 * When a host supplies no `DiscoverySource`, the summon tools are never
 * advertised — `skillet mcp` on loopback keeps exactly its current tool surface
 * and stays offline-capable. The hosted registry server supplies one.
 *
 * The shape mirrors the `/skillet` route skill's summon flow
 * (`packages/cli/bundled-skills/skillet-route/SKILL.md`) rather than inventing
 * an MCP dialect: same candidate set, same `via`/`ref` split, same fallback.
 * Two summon implementations that drift are worse than one slightly awkward
 * over MCP.
 */
export interface DiscoverySource {
  /** A handle's public kit as routing candidates. */
  summon(handle: string): Promise<SummonResult>;
  /** Cross-author fallback when the named handle has nothing that fits. */
  searchPublic(keywords: string): Promise<SummonCandidate[]>;
  /** Who an author is, for proposing someone the user did not name. */
  authorStanding(handle: string): Promise<AuthorStanding | null>;
  /** Load a public skill's body by ref. Records summon attribution when told. */
  readPublicSkill(ref: string, opts?: PublicReadOptions): Promise<PublicSkill | null>;
}

/** One summon candidate: a public skill a handle authored or curated. */
export interface SummonCandidate {
  /**
   * Canonical `owner/slug` of the TRUE author. For a curated skill this is not
   * the summoned handle — that goes in `via`. Collapsing the two would credit
   * the curator for someone else's work.
   */
  ref: string;
  /**
   * Display name when the source has one. The registry stores a name only in
   * version frontmatter, not on the skill row, so a candidate list built from
   * skill rows legitimately has none and the slug stands in.
   */
  name?: string | null;
  description: string | null;
  hash: string;
  versionLabel?: string | null;
  /** The curator's handle when this skill reached the set via their public kit. */
  via?: string | null;
}

/**
 * Unknown handle and "exists but publishes nothing" are different answers, and
 * the client branches on them differently: correct the handle, versus fall
 * back to searching everyone. The HTTP endpoint already separates them (404 vs
 * an empty array), so don't collapse them here.
 */
export type SummonResult =
  | { kind: "ok"; handle: string; candidates: SummonCandidate[] }
  | { kind: "unknown-handle"; handle: string };

/**
 * An author's standing, for naming who you are proposing.
 *
 * Counts are omitted when zero rather than reported as zero: at launch every
 * count is zero, and "used by 0 people" argues against the recommendation.
 */
export interface AuthorStanding {
  handle: string;
  name?: string | null;
  bio?: string | null;
  installs?: number;
  summons?: number;
  /** Set when the profile mirrors an upstream source rather than being authored here. */
  mirrorSource?: string | null;
}

export interface PublicReadOptions {
  /** Pin to a specific version; omit for latest. */
  hash?: string | null;
  /**
   * The summoned handle this ref came from, when it is NOT the skill's own
   * author. Attribution only: a curated pick credits the curator alongside the
   * author. Absent for a skill the summoned handle wrote themselves.
   */
  via?: string | null;
  /**
   * True when this read came from a summon, whatever the attribution. Counting
   * used to key off `via`, which is absent for an authored skill — the common
   * case — so an authored summon over MCP counted nothing while the same summon
   * over HTTP counted one. HTTP gates on `src=summon` with `via` optional; this
   * is the MCP equivalent.
   */
  summoned?: boolean;
}

export interface PublicSkill {
  ref: string;
  name?: string | null;
  description: string | null;
  hash: string;
  versionLabel?: string | null;
  skillMd: string | null;
  resources: string[];
}
