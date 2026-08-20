import { join, sep, dirname } from "node:path";
import { homedir } from "node:os";
import { access } from "node:fs/promises";
import type { Adapter, MaterializeOptions, TargetPathOptions } from "@skillet/core";
import type { DecodedBundle } from "@skillet/core";
import {
  assertSafeSlug,
  materializeSlugDir,
  validateMaterializationPath,
  writeBundleToDir,
  CLAUDE_ENV_ROOT,
} from "@skillet/core";

export type { Adapter };

// Claude Code's own resolver is `CLAUDE_CONFIG_DIR ?? ~/.claude` with skills
// under `<root>/skills` (verified against the 2.1.206 binary). When the env
// var is set, `~/.claude/skills` is a directory Claude Code never reads —
// detection and materialization must both follow the resolved root.
const CLAUDE_SKILLS_DIR = CLAUDE_ENV_ROOT ?? join(homedir(), ".claude", "skills");

export async function detect(): Promise<boolean> {
  try {
    await access(dirname(CLAUDE_SKILLS_DIR));
    return true;
  } catch {
    return false;
  }
}

export async function materialize(
  slug: string,
  bundle: DecodedBundle,
  opts: MaterializeOptions = {},
): Promise<string[]> {
  assertSafeSlug(slug);
  const slugDir = materializeSlugDir(slug, opts.owner ?? null, { dirName: opts.dirName });
  validateMaterializationPath(CLAUDE_SKILLS_DIR, slugDir);
  return writeBundleToDir(CLAUDE_SKILLS_DIR, slugDir, bundle);
}

export function targetPath(
  slug: string,
  opts: TargetPathOptions = {},
): string {
  assertSafeSlug(slug);
  const slugDir = materializeSlugDir(slug, opts.owner ?? null, { dirName: opts.dirName });
  const rel = `${slugDir}/SKILL.md`;
  const hostRel = sep === "/" ? rel : rel.split("/").join(sep);
  return join(CLAUDE_SKILLS_DIR, hostRel);
}

export function targetSkillDir(
  slug: string,
  opts: TargetPathOptions = {},
): string {
  assertSafeSlug(slug);
  return join(CLAUDE_SKILLS_DIR, materializeSlugDir(slug, opts.owner ?? null, { dirName: opts.dirName }));
}

export const claudeCodeAdapter: Adapter = {
  name: "claude-code",
  targetDir: CLAUDE_SKILLS_DIR,
  detect,
  materialize,
  targetPath,
  targetSkillDir,
};

export default claudeCodeAdapter;
