import { readdir } from "node:fs/promises";
import { join, basename } from "node:path";
import matter from "gray-matter";
import { canonicalContentHash } from "@skillet/protocol";
import { readBundleFromDir } from "../bundle/read.js";
import { isSkilletSlugDirName, parseSkilletSlugDir } from "../bundle/write.js";
import { parseSkillRef } from "../registry/identifier.js";
import { readState } from "../kit/store.js";
import { importSkill, slugify } from "./import.js";
import type { Adapter } from "../adapter.js";
import type { SkillEntry } from "../kit/types.js";

/**
 * Cross-runtime skill discovery (first-run "wow").
 *
 * On first run, Skillet scans the runtimes the user already has installed
 * (Claude Code, Codex, …) for skills they already run, and surfaces a single
 * "we found N skills you already run — import them?" moment. Nobody starts
 * empty.
 *
 * This intentionally reuses the existing local-import path:
 *   - `readBundleFromDir` + `canonicalContentHash` do the scan + hashing
 *     (same code the single-path `skillet import <dir>` uses).
 *   - `importSkill` does the actual import (private-by-default `source:"local"`).
 * There is no second scanner.
 */

/** Friendly display names for the runtime adapter keys. The `windsurf` KEY is
 *  a frozen wire id; its LABEL is "Devin Desktop" after Cognition's June 2026
 *  rebrand of the Windsurf editor. */
const RUNTIME_LABELS: Record<string, string> = {
  "claude-code": "Claude Code",
  codex: "Universal",
  "codex-project": "Universal (project)",
  openclaw: "OpenClaw",
  hermes: "Hermes",
  cursor: "Cursor",
  windsurf: "Devin Desktop",
  devin: "Devin",
  // opencode reads the universal ~/.agents/skills baseline (like Cursor), so it
  // is surfaced as a detected runtime for labeling but is not a separate
  // materializer — the baseline already writes the skills it reads.
  opencode: "opencode",
  "opencode-project": "opencode (project)",
};

export function runtimeLabel(name: string): string {
  return RUNTIME_LABELS[name] ?? name;
}

/**
 * Render a list of runtime keys as a human phrase, e.g.
 * ["claude-code","codex"] → "Claude Code + Codex".
 */
export function runtimePhrase(names: string[]): string {
  return names.map(runtimeLabel).join(" + ");
}

export interface DiscoveredSkill {
  /** Best-effort slug derived from the bundle's `name` (display + import key). */
  slug: string;
  name: string;
  description: string;
  /** Canonical bundle content hash, `sha256:`-prefixed (§2.2). */
  hash: string;
  /** Runtime adapter names where this exact bundle (by hash) was found. */
  runtimes: string[];
  /** A representative on-disk bundle dir to import from. */
  bundleDir: string;
  /** True iff a kit entry already has this content hash (already imported). */
  alreadyInKit: boolean;
  /**
   * True when this on-disk bundle is already managed by Skillet — either
   * materialized under the `owner--slug` / `_local--slug` layout, or matched
   * to a registry entry in the kit by owner + slug.
   */
  fromSkillet: boolean;
}

export interface DiscoveryReport {
  /** Detected, scannable runtimes that were scanned (by adapter name). */
  scannedRuntimes: string[];
  /** Unique skills (deduped by content hash) found across scanned runtimes. */
  skills: DiscoveredSkill[];
  /** Subset of `skills` not already in the kit — the import candidates. */
  newSkills: DiscoveredSkill[];
}

// Bound the recursive scan so a deep tree under a runtime's skills dir can
// never run away. Real layouts are flat (`<root>/<slug>/SKILL.md`) or one level
// deeper for owned namespaces (`<root>/@owner/<slug>/SKILL.md`).
const MAX_SCAN_DEPTH = 3;

/**
 * Collect every directory at or under `root` (to `MAX_SCAN_DEPTH`) that
 * directly contains a `SKILL.md`. Descent stops at a bundle root so the
 * bundle's own subtree (`references/`, etc.) is not mistaken for nested skills.
 *
 * Never throws: a missing or unreadable directory is "no skills here", not an
 * error — discovery is best-effort by design.
 */
async function findBundleDirs(
  root: string,
  depth: number,
  out: string[],
): Promise<void> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  if (entries.some((e) => e.isFile() && e.name === "SKILL.md")) {
    out.push(root);
    return;
  }
  if (depth >= MAX_SCAN_DEPTH) return;
  for (const e of entries) {
    if (e.isDirectory()) {
      await findBundleDirs(join(root, e.name), depth + 1, out);
    }
  }
}

interface ScannedBundle {
  dir: string;
  hash: string;
  name: string;
  description: string;
  slug: string;
}

/**
 * Scan one global runtime's skills directory for existing skill bundles.
 * Project-scoped adapters expose no host-wide dir to scan and are skipped by
 * the caller. Invalid bundles (symlinks, oversize, missing root) are skipped
 * silently — one bad dir never aborts discovery.
 */
async function scanRuntime(adapter: Adapter): Promise<ScannedBundle[]> {
  const dirs: string[] = [];
  await findBundleDirs(adapter.targetDir, 0, dirs);

  const found: ScannedBundle[] = [];
  for (const dir of dirs) {
    try {
      const bundle = await readBundleFromDir(dir);
      const entrypoint = bundle.get("SKILL.md");
      if (!entrypoint) continue;
      const hash = canonicalContentHash(bundle);
      const parsed = matter(Buffer.from(entrypoint).toString("utf8"));
      const fm = parsed.data as Record<string, unknown>;
      const name = typeof fm["name"] === "string" ? fm["name"] : basename(dir);
      const description =
        typeof fm["description"] === "string" ? fm["description"] : "";
      found.push({ dir, hash, name, description, slug: slugify(name) });
    } catch {
      // unreadable/invalid bundle — skip, never throw
    }
  }
  return found;
}

function normalizeOwner(owner: string | null | undefined): string | null {
  if (!owner) return null;
  const trimmed = owner.trim();
  if (!trimmed) return null;
  return trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
}

function entryOwnerSlug(entry: SkillEntry): { owner: string | null; slug: string } {
  if (entry.slug.startsWith("@") && entry.slug.includes("/")) {
    const parsed = parseSkillRef(entry.slug);
    return { owner: parsed.author, slug: parsed.slug };
  }
  return { owner: normalizeOwner(entry.owner), slug: entry.slug };
}

function isFromSkillet(
  bundleDir: string,
  hash: string,
  kitHashes: Set<string>,
  registryKeys: Set<string>,
): boolean {
  if (kitHashes.has(hash)) return true;

  const dirName = basename(bundleDir);
  if (isSkilletSlugDirName(dirName)) return true;

  const parsed = parseSkilletSlugDir(dirName);
  if (parsed) {
    const owner = normalizeOwner(parsed.owner);
    const key = owner ? `${owner}/${parsed.slug}` : parsed.slug;
    if (registryKeys.has(key)) return true;
  }

  return false;
}

/**
 * Discover skills the user already runs across their installed runtimes.
 *
 * Skills are deduped by canonical content hash, so the same bundle present in
 * both Claude Code and Codex counts once (with both runtimes listed). Skills
 * whose hash already exists in the kit are flagged `alreadyInKit` and excluded
 * from `newSkills`.
 */
export async function discoverExistingSkills(
  adapters: Adapter[],
): Promise<DiscoveryReport> {
  const state = await readState();
  const kitHashes = new Set(Object.values(state.skills).map((s) => s.hash));
  const registryKeys = new Set<string>();
  for (const entry of Object.values(state.skills)) {
    if (entry.source !== "registry") continue;
    const { owner, slug } = entryOwnerSlug(entry);
    const key = owner ? `${owner}/${slug}` : slug;
    registryKeys.add(key);
  }

  const scannedRuntimes: string[] = [];
  const byHash = new Map<string, DiscoveredSkill>();

  for (const adapter of adapters) {
    if (adapter.kind === "project") continue;
    let detected = false;
    try {
      detected = await adapter.detect();
    } catch {
      detected = false;
    }
    if (!detected) continue;
    scannedRuntimes.push(adapter.name);

    for (const f of await scanRuntime(adapter)) {
      const existing = byHash.get(f.hash);
      if (existing) {
        if (!existing.runtimes.includes(adapter.name)) {
          existing.runtimes.push(adapter.name);
        }
        continue;
      }
      const alreadyInKit = kitHashes.has(f.hash);
      const fromSkillet = isFromSkillet(f.dir, f.hash, kitHashes, registryKeys);
      byHash.set(f.hash, {
        slug: f.slug,
        name: f.name,
        description: f.description,
        hash: f.hash,
        runtimes: [adapter.name],
        bundleDir: f.dir,
        alreadyInKit,
        fromSkillet,
      });
    }
  }

  const skills = [...byHash.values()];
  const newSkills = skills.filter((s) => !s.alreadyInKit && !s.fromSkillet);

  // Note: local discovery (scanning your machine) is intentionally NOT recorded
  // — it reads as snooping, and it's passive. Activity captures actions you take
  // against your account (sync/add/publish), not what's on your disk.

  return { scannedRuntimes, skills, newSkills };
}

export interface ImportDiscoveredResult {
  imported: SkillEntry[];
  failed: Array<{ name: string; error: string }>;
}

/**
 * Import a set of discovered skills into the kit by reusing the local-import
 * path (`importSkill`). Each is stored private-by-default (`source:"local"`,
 * no owner). One bad bundle does not abort the rest.
 */
export async function importDiscoveredSkills(
  skills: DiscoveredSkill[],
): Promise<ImportDiscoveredResult> {
  const imported: SkillEntry[] = [];
  const failed: Array<{ name: string; error: string }> = [];
  for (const s of skills) {
    try {
      imported.push(await importSkill(s.bundleDir));
    } catch (err) {
      failed.push({ name: s.name, error: (err as Error).message });
    }
  }
  return { imported, failed };
}

/** Union of runtimes across a set of discovered skills (preserves first-seen order). */
export function runtimesAcross(skills: DiscoveredSkill[]): string[] {
  const seen: string[] = [];
  for (const s of skills) {
    for (const r of s.runtimes) {
      if (!seen.includes(r)) seen.push(r);
    }
  }
  return seen;
}
