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

// opencode reads Agent Skills from several roots (opencode.ai/docs/skills):
// its native `~/.config/opencode/skills` + project `.opencode/skills`, the
// Claude-compatible `~/.claude/skills`, AND the agent-compatible
// `~/.agents/skills` (global) / `.agents/skills` (project). Skillet materializes
// into the agent-compatible `.agents/skills` path — the SAME path Codex uses —
// so a single materialization serves both runtimes (see the shared-path shadow
// handling in @skillet/core). We detect an opencode install by its own config
// dir (`~/.config/opencode`) rather than `.agents/`, which any agent tool may
// create, so detection stays specific to opencode.
const DEFAULT_TARGET_DIR = join(homedir(), ".agents", "skills");
const PRIMARY_DETECT_DIR = join(homedir(), ".config", "opencode");

// Relative POSIX path under the project root; must match PROJECT_TARGET_ALLOWLIST.
const PROJECT_TARGET_DIR = ".agents/skills";

/**
 * Walk up from startDir looking for the nearest ancestor directory that marks
 * a project root. Returns the absolute path of the first match, or null if the
 * filesystem root is reached without a match.
 *
 * Markers are `.git` (the repo root opencode resolves project scope against),
 * `.opencode` (an opencode project config dir), and `.agents` (whose presence
 * proves a prior project materialization). opencode walks up to the git worktree
 * to resolve project-local skills, so keying on the repo root matches it.
 *
 * opencode resolution when the same skill name appears in multiple scopes:
 * project (repo `.agents/skills`) is loaded alongside user (`~/.agents/skills`).
 * Skillet writes to the repo path when a project root is detected via this
 * walk-up; otherwise it writes to the user path.
 */
export async function findProjectRoot(
  startDir: string,
  stopAt?: string,
): Promise<string | null> {
  let current = resolve(startDir);
  // `stopAt` bounds the walk (that directory is searched, nothing above it).
  // Unbounded, the walk only stops at the filesystem root, so tests depend on
  // whatever sits above their fixture — and on Windows `tmpdir()` lives INSIDE
  // the home dir, so a fixture under it inherits the user's real ~/.agents and
  // "no project root here" quietly becomes "home is the project root".
  // Production callers want the unbounded walk and pass nothing.
  const boundary = stopAt === undefined ? null : resolve(stopAt);
  while (true) {
    for (const marker of [".git", ".opencode", ".agents"]) {
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
    name: "opencode",
    targetDir: baseDir,

    async detect(): Promise<boolean> {
      try {
        await access(PRIMARY_DETECT_DIR);
        return true;
      } catch {
        return false;
      }
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
    name: "opencode-project",
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
          `No project root found from "${startDir}" — expected .git/, .opencode/, or .agents/ in an ancestor directory`,
        );
      }
      validateProjectAdapterRoot(adapter, projRoot);
      const absRoot = join(projRoot, ".agents", "skills");
      // Guard: if the walk-up resolved to homedir (e.g. ~/.agents/ exists),
      // absRoot would silently equal the global adapter's target. Decline so
      // the caller falls through to the global opencodeAdapter instead.
      if (resolve(absRoot) === resolve(join(homedir(), ".agents", "skills"))) {
        throw new Error(
          `No project-specific root found from "${startDir}" — walk-up resolved to the global agent-skills path. Use opencodeAdapter (global) instead.`,
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

export const opencodeAdapter: Adapter = createAdapter();
export const opencodeProjectAdapter: Adapter = createProjectAdapter();
export default opencodeAdapter;
