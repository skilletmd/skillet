import { join, sep, resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { access } from "node:fs/promises";
import type { Adapter, MaterializeOptions, TargetPathOptions } from "@skillet/core";
import type { DecodedBundle } from "@skillet/core";
import {
  assertSafeSlug,
  materializeSlugDir,
  validateMaterializationPath,
  validateProjectAdapterRoot,
  writeBundleToDir,
} from "@skillet/core";

export type { Adapter };

// Codex global skills live at ~/.agents/skills (repo scope shipped in
// rust-v0.94.0, 2026-02-02; personal ~/.agents/skills in rust-v0.95.0,
// 2026-02-04). The previous path (~/.codex/skills) is a deprecated back-compat
// location Codex STILL READS — so pre-move copies surface as duplicates in
// skill selectors, cleaned up by sync's cleanupLegacyCodexSkills. We detect
// either directory so Skillet claims hosts with the old dir installed, but we
// only materialize into the supported path.
const DEFAULT_TARGET_DIR = join(homedir(), ".agents", "skills");
const LEGACY_DETECT_DIR = join(homedir(), ".codex");
const PRIMARY_DETECT_DIR = join(homedir(), ".agents");

// Relative POSIX path under the project root; must match PROJECT_TARGET_ALLOWLIST.
const PROJECT_TARGET_DIR = ".agents/skills";

/**
 * Walk up from startDir looking for the nearest ancestor directory that marks
 * a project root. Returns the absolute path of the first match, or null if the
 * filesystem root is reached without a match.
 *
 * Markers are `.git` (Codex's own project-root default) and `.agents` (whose
 * presence proves a prior project materialization). `package.json` was dropped
 * (2026-07): it made a bare Node package with no git dir route project-scoped,
 * diverging from Codex, which keys project scope on the repo root.
 *
 * Codex resolution precedence when the same skill name appears in multiple
 * scopes: project (repo `.agents/skills`) > user (`~/.agents/skills`) > admin.
 * Skillet writes to the repo path when a project root is detected via this
 * walk-up; otherwise it writes to the user path.
 */
/**
 * Walk up from `startDir` looking for a project marker.
 *
 * `stopAt` bounds the walk: the search includes that directory and goes no
 * higher. Without it the walk only stops at the filesystem root, which makes
 * tests depend on what happens to sit above their fixture — and on Windows
 * `tmpdir()` lives INSIDE the home dir, so a fixture under it inherits the
 * user's real `~/.git` or `~/.agents` and "no project root here" quietly
 * becomes "the home directory is the project root". Production callers want
 * the unbounded walk and pass nothing.
 */
export async function findProjectRoot(
  startDir: string,
  stopAt?: string,
): Promise<string | null> {
  let current = resolve(startDir);
  const boundary = stopAt === undefined ? null : resolve(stopAt);
  while (true) {
    for (const marker of [".git", ".agents"]) {
      try {
        await access(join(current, marker));
        return current;
      } catch {
        // marker not present in this directory; continue
      }
    }
    if (boundary !== null && current === boundary) return null; // bounded walk
    const parent = dirname(current);
    if (parent === current) return null; // reached filesystem root
    current = parent;
  }
}

export function createAdapter(baseDir = DEFAULT_TARGET_DIR): Adapter {
  return {
    name: "codex",
    targetDir: baseDir,

    async detect(): Promise<boolean> {
      for (const dir of [PRIMARY_DETECT_DIR, LEGACY_DETECT_DIR]) {
        try {
          await access(dir);
          return true;
        } catch {
          // try next
        }
      }
      return false;
    },

    async materialize(
      slug: string,
      bundle: DecodedBundle,
      opts: MaterializeOptions = {},
    ): Promise<string[]> {
      assertSafeSlug(slug);
      const slugDir = materializeSlugDir(slug, opts.owner ?? null, { dirName: opts.dirName });
      validateMaterializationPath(baseDir, slugDir);
      return writeBundleToDir(baseDir, slugDir, bundle);
    },

    targetPath(slug: string, opts: TargetPathOptions = {}): string {
      assertSafeSlug(slug);
      const slugDir = materializeSlugDir(slug, opts.owner ?? null, { dirName: opts.dirName });
      const rel = `${slugDir}/SKILL.md`;
      const hostRel = sep === "/" ? rel : rel.split("/").join(sep);
      return join(baseDir, hostRel);
    },

    targetSkillDir(slug: string, opts: TargetPathOptions = {}): string {
      assertSafeSlug(slug);
      return join(baseDir, materializeSlugDir(slug, opts.owner ?? null, { dirName: opts.dirName }));
    },
  };
}

export function createProjectAdapter(): Adapter {
  const adapter: Adapter = {
    name: "codex-project",
    kind: "project",
    targetDir: PROJECT_TARGET_DIR,

    async detect(): Promise<boolean> {
      const root = await findProjectRoot(process.cwd());
      return root !== null;
    },

    projectRoot(cwd: string): string {
      // Given the project root directory, return the absolute write root.
      // Used by validateProjectAdapterRoot for structural safety checks.
      return join(cwd, ".agents", "skills");
    },

    async materialize(
      slug: string,
      bundle: DecodedBundle,
      opts: MaterializeOptions = {},
    ): Promise<string[]> {
      const startDir = opts.cwd ?? process.cwd();
      assertSafeSlug(slug);
      const projRoot = await findProjectRoot(startDir);
      if (!projRoot) {
        throw new Error(
          `No project root found from "${startDir}" — expected .agents/, .git/, or package.json in an ancestor directory`,
        );
      }
      validateProjectAdapterRoot(adapter, projRoot);
      const absRoot = join(projRoot, ".agents", "skills");
      // Guard: if the walk-up resolved to homedir (e.g. ~/.agents/ exists),
      // absRoot would silently equal the global adapter's target. Decline so
      // the caller falls through to the global codexAdapter instead.
      if (resolve(absRoot) === resolve(join(homedir(), ".agents", "skills"))) {
        throw new Error(
          `No project-specific root found from "${startDir}" — walk-up resolved to the global Codex path. Use codexAdapter (global) instead.`,
        );
      }
      const slugDir = materializeSlugDir(slug, opts.owner ?? null, { dirName: opts.dirName });
      return writeBundleToDir(absRoot, slugDir, bundle);
    },

    targetPath(slug: string, opts: TargetPathOptions = {}): string {
      const cwd = opts.cwd ?? process.cwd();
      assertSafeSlug(slug);
      const slugDir = materializeSlugDir(slug, opts.owner ?? null, { dirName: opts.dirName });
      const rel = `${slugDir}/SKILL.md`;
      const hostRel = sep === "/" ? rel : rel.split("/").join(sep);
      return join(cwd, ".agents", "skills", hostRel);
    },

    targetSkillDir(slug: string, opts: TargetPathOptions = {}): string {
      const cwd = opts.cwd ?? process.cwd();
      assertSafeSlug(slug);
      return join(cwd, ".agents", "skills", materializeSlugDir(slug, opts.owner ?? null, { dirName: opts.dirName }));
    },
  };
  return adapter;
}

export const codexAdapter: Adapter = createAdapter();
export const codexProjectAdapter: Adapter = createProjectAdapter();
export default codexAdapter;
