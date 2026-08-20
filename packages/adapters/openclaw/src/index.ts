import { join, sep } from "node:path";
import { homedir } from "node:os";
import { access, readFile, readdir, lstat } from "node:fs/promises";
import type {
  Adapter,
  MaterializeOptions,
  ShadowFinding,
  ShadowFindOptions,
  TargetPathOptions,
} from "@skillet/core";
import type { DecodedBundle } from "@skillet/core";
import {
  assertSafeSlug,
  materializeSlugDir,
  validateMaterializationPath,
  writeBundleToDir,
} from "@skillet/core";

export type { Adapter };

const DEFAULT_TARGET_DIR = join(homedir(), ".openclaw", "skills");

// OpenClaw discovers a skill wherever a SKILL.md appears (up to six levels
// deep) and identifies it by frontmatter `name`, falling back to the dir name
// — the folder path is organizational only. Support dirs it never treats as
// skill roots (mirrors OpenClaw's own excluded set).
const SHADOW_WALK_DEPTH = 6;
const SUPPORT_DIRS = new Set(["references", "templates", "assets", "scripts", "node_modules"]);

/** Frontmatter `name:` from SKILL.md text, or null. */
function frontmatterName(text: string): string | null {
  const fm = text.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return null;
  const m = fm[1]!.match(/^name:\s*(.+)$/m);
  return m ? m[1]!.trim().replace(/^["']|["']$/g, "") : null;
}

/**
 * Walk `root` up to `SHADOW_WALK_DEPTH` levels for SKILL.md files, yielding
 * `{ path, name }` per skill (name = frontmatter name, else containing dir
 * name). lstat-based: never follows symlinks out of the root; skips support
 * dirs. Never throws — a missing/unreadable path yields nothing.
 */
async function collectSkills(
  root: string,
  depth: number,
): Promise<Array<{ path: string; name: string }>> {
  if (depth < 0) return [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: Array<{ path: string; name: string }> = [];
  for (const e of entries) {
    if (e.isSymbolicLink()) continue; // never follow symlinks off-root
    if (e.name === "SKILL.md" && e.isFile()) {
      const filePath = join(root, e.name);
      try {
        const text = await readFile(filePath, "utf8");
        out.push({ path: filePath, name: frontmatterName(text) ?? basenameOf(root) });
      } catch {
        // unreadable → skip
      }
    } else if (e.isDirectory() && !SUPPORT_DIRS.has(e.name)) {
      out.push(...(await collectSkills(join(root, e.name), depth - 1)));
    }
  }
  return out;
}

function basenameOf(p: string): string {
  const parts = p.split(sep);
  return parts[parts.length - 1] ?? p;
}

// OpenClaw resolves skills across six precedence levels (docs.openclaw.ai
// /tools/skills-config). Skillet materializes into ~/.openclaw/skills — level
// #4. These three higher-precedence locations silently override it when
// they hold a same-slug SKILL.md, so we surface them as shadows on sync.
function shadowSearchPaths(
  workspaceDir: string | undefined,
): Array<{ root: string; location: string }> {
  const paths: Array<{ root: string; location: string }> = [];
  if (workspaceDir) {
    paths.push({
      root: join(workspaceDir, "skills"),
      location: "<workspace>/skills",
    });
    paths.push({
      root: join(workspaceDir, ".agents", "skills"),
      location: "<workspace>/.agents/skills",
    });
  }
  paths.push({
    root: join(homedir(), ".agents", "skills"),
    location: "~/.agents/skills",
  });
  return paths;
}

export function createAdapter(baseDir = DEFAULT_TARGET_DIR): Adapter {
  return {
    name: "openclaw",
    targetDir: baseDir,

    async detect(): Promise<boolean> {
      try {
        await access(join(homedir(), ".openclaw"));
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

    async findShadows(
      slug: string,
      opts: ShadowFindOptions = {},
    ): Promise<ShadowFinding[]> {
      assertSafeSlug(slug);
      const slugDir = materializeSlugDir(slug, opts.owner ?? null, { dirName: opts.dirName });

      // OpenClaw keys skill identity on the frontmatter `name`, not the folder
      // name — so a higher-precedence skill under ANY folder shadows ours when
      // its name matches. Resolve our own effective name from the SKILL.md we
      // just materialized (frontmatter name, else our dir name), then scan the
      // higher-precedence roots by name. Falls back to the dir name if our copy
      // is unreadable.
      let ourName = slugDir;
      try {
        const ours = await readFile(join(baseDir, slugDir, "SKILL.md"), "utf8");
        ourName = frontmatterName(ours) ?? slugDir;
      } catch {
        // use dir name
      }

      const findings: ShadowFinding[] = [];
      for (const { root, location } of shadowSearchPaths(opts.workspaceDir)) {
        try {
          await lstat(root);
        } catch {
          continue; // missing higher-precedence root is the common case
        }
        for (const found of await collectSkills(root, SHADOW_WALK_DEPTH)) {
          if (found.name === ourName) findings.push({ path: found.path, location });
        }
      }
      return findings;
    },
  };
}

export const openclawAdapter: Adapter = createAdapter();
export default openclawAdapter;
