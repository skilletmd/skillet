import { readFile, mkdir, lstat, mkdtemp, rm, readdir } from "node:fs/promises";
import { resolve, basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import matter from "gray-matter";
import { canonicalContentHash, validateRequires, validateTriggers, slugify as canonicalSlugify, type DecodedBundle } from "@skillet/protocol";
import { assertSafeSlug } from "../util/pathsafe.js";
import { readState, writeBundleToSkillStore, upsertSkill, skillContentDir } from "../kit/store.js";
import { readBundleFromDir } from "../bundle/read.js";
import { recordEvent, detectInitiator } from "../metrics.js";
import type { SkillEntry } from "../kit/types.js";

const execFileAsync = promisify(execFile);

export class ImportCollisionError extends Error {
  readonly code = "slug_collision" as const;

  constructor(public readonly slug: string) {
    super(
      `Skill slug "${slug}" already exists in your kit. Re-import with --force to overwrite.`,
    );
    this.name = "ImportCollisionError";
  }
}

export interface ImportSkillOptions {
  force?: boolean;
}

async function assertImportAllowed(slug: string, force?: boolean): Promise<void> {
  const state = await readState();
  if (state.skills[slug] && !force) {
    throw new ImportCollisionError(slug);
  }
}

export function slugify(name: string): string {
  return canonicalSlugify(name, { maxLength: 64 });
}

/**
 * Import a skill from the filesystem.
 *
 * Accepts either:
 *   - a directory containing `SKILL.md` at its root (preferred — full bundle, §2.1), or
 *   - a path to a `SKILL.md` file (legacy single-file import — the bundle is the
 *     containing directory).
 *
 * The skill is hashed canonically (§2.2) and stored as the full bundle tree
 * under `~/.skillet/skills/<slug>/`, ready for sync to materialize.
 */
export async function importSkill(
  skillPath: string,
  opts: ImportSkillOptions = {},
): Promise<SkillEntry> {
  const resolvedPath = resolve(skillPath);
  const skillDir = await resolveSkillDir(resolvedPath);

  const bundle = await readBundleFromDir(skillDir);

  const entrypointBytes = bundle.get("SKILL.md")!;
  const parsed = matter(Buffer.from(entrypointBytes).toString("utf8"));
  const fm = parsed.data as Record<string, unknown>;
  const rawName =
    typeof fm["name"] === "string" ? fm["name"] : basename(skillDir);
  const description =
    typeof fm["description"] === "string" ? fm["description"] : "";

  // Enforce the `requires:` schema at the import boundary. selfRef is
  // omitted: the skill has no minted @author/slug ref yet, so self-dependency
  // detection runs later at publish (per the module contract). A malformed
  // `requires` block throws RequiresError and aborts the import.
  validateRequires(fm["requires"]);
  validateTriggers(fm["triggers"]);

  const slug = slugify(rawName);
  assertSafeSlug(slug);
  await assertImportAllowed(slug, opts.force);

  const hash = canonicalContentHash(bundle);
  const now = new Date().toISOString();

  await mkdir(skillContentDir(slug), { recursive: true });
  await writeBundleToSkillStore(slug, bundle);

  const entry: SkillEntry = {
    slug,
    name: rawName,
    description,
    version: 1,
    hash,
    source: "local",
    importedAt: now,
    updatedAt: now,
  };

  await upsertSkill(entry);

  recordEvent("skill.import", detectInitiator(), { slug });

  return entry;
}

async function resolveSkillDir(p: string): Promise<string> {
  const st = await lstat(p);
  if (st.isDirectory()) {
    // Confirm SKILL.md is at the root — readBundleFromDir will assert this too,
    // but we can give a better error message before the walk.
    try {
      await lstat(join(p, "SKILL.md"));
    } catch {
      throw new Error(`Skill directory "${p}" is missing SKILL.md at its root.`);
    }
    return p;
  }
  if (st.isFile() && basename(p) === "SKILL.md") {
    return dirname(p);
  }
  throw new Error(`Cannot import "${p}": expected a directory or a path to SKILL.md.`);
}

// Compatibility export — older code paths and tests may still call readFile
// patterns; keep the name available for the (rare) case where a caller wants
// just the entrypoint text.
export async function readSkillEntrypoint(skillDir: string): Promise<string> {
  return await readFile(join(skillDir, "SKILL.md"), "utf8");
}

export type { DecodedBundle };

// `skillet import <owner>/<repo>` — clone a GitHub repo and
// import every skill found in it (directories containing SKILL.md at root).
// Uses `git clone --depth 1` for speed; temp dir is cleaned up on exit.

const GITHUB_REPO_RE = /^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/;

export function isGithubRepoRef(input: string): boolean {
  return GITHUB_REPO_RE.test(input);
}

export async function importFromGithubRepo(
  ownerRepo: string,
  opts: ImportSkillOptions = {},
): Promise<SkillEntry[]> {
  const match = GITHUB_REPO_RE.exec(ownerRepo);
  if (!match) {
    throw new Error(
      `Invalid repo reference "${ownerRepo}". Expected format: owner/repo`,
    );
  }
  const [, owner, repo] = match;
  const cloneUrl = `https://github.com/${owner}/${repo}.git`;

  const tmpDir = await mkdtemp(join(tmpdir(), "skillet-import-"));
  try {
    // Shallow clone — we only need the latest tree.
    await execFileAsync("git", ["clone", "--depth", "1", "--quiet", cloneUrl, tmpDir]);

    // Find all directories containing a SKILL.md at their root.
    const skillDirs = await findSkillDirs(tmpDir);
    if (skillDirs.length === 0) {
      throw new Error(
        `No skills found in ${ownerRepo}. A skill directory must contain SKILL.md at its root.`,
      );
    }

    const imported: SkillEntry[] = [];
    for (const dir of skillDirs) {
      const entry = await importSkill(dir, opts);
      imported.push(entry);
    }

    recordEvent("skill.import.github", detectInitiator(), {
      repo: ownerRepo,
      count: imported.length,
    });

    return imported;
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

// Walk `root` depth-first. A directory that has SKILL.md at its root is a
// skill dir; we don't recurse into it (nested skills are not supported).
async function findSkillDirs(root: string): Promise<string[]> {
  const results: string[] = [];
  await walkForSkills(root, root, results);
  return results;
}

async function walkForSkills(
  root: string,
  dir: string,
  acc: string[],
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }

  if (entries.includes("SKILL.md")) {
    acc.push(dir);
    return; // don't recurse into a skill dir
  }

  // Skip common non-skill dirs to keep the walk fast.
  const skip = new Set(["node_modules", ".git", ".github", "dist", "build"]);
  for (const name of entries) {
    if (skip.has(name)) continue;
    const child = join(dir, name);
    let st;
    try {
      st = await lstat(child);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      await walkForSkills(root, child, acc);
    }
  }
}
