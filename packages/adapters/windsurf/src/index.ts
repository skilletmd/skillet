import { join, sep } from "node:path";
import { homedir } from "node:os";
import { access } from "node:fs/promises";
import type { Adapter, MaterializeOptions, TargetPathOptions } from "@skillet/core";
import type { DecodedBundle } from "@skillet/core";
import {
  AdapterSkipError,
  assertSafeSlug,
  materializeSlugDir,
  validateMaterializationPath,
  writeBundleToDir,
} from "@skillet/core";

export type { Adapter };

// Devin Desktop (né Windsurf, rebranded 2026-06-02) reads native Agent Skills:
// SKILL.md folders under ~/.codeium/windsurf/skills/ (global) — the same
// layout as Claude Code/Codex/Devin, spec at agentskills.io
// (docs.devin.ai/desktop/cascade/skills). This replaced the old rules-file
// flattening, which was format-hobbled three ways: activation frontmatter
// stripped, a 12k-char workspace-rule cap, and supporting files dropped.
// ~/.codeium/windsurf is stable across the rebrand (FAQ; verified on a fresh
// Devin.app 3.4.27 install — the root exists, skills/ is created on first
// write). The adapter id stays "windsurf": it is a wire contract with the
// tray; only display labels say "Devin Desktop".
const WINDSURF_SKILLS_DIR = join(homedir(), ".codeium", "windsurf", "skills");
const WINDSURF_ROOT = join(homedir(), ".codeium", "windsurf");

export function createAdapter(baseDir?: string): Adapter {
  const targetDir = baseDir ?? WINDSURF_SKILLS_DIR;

  return {
    name: "windsurf",
    targetDir,

    async detect(): Promise<boolean> {
      // Windsurf rebranded to Devin Desktop on 2026-06-02 (v3.0.12): the app
      // is now Devin.app and new data lands in Application Support/Devin,
      // while ~/.codeium/windsurf stays the config/skills home across the
      // rebrand (FAQ: "these paths remain the same"; verified on a fresh
      // 3.4.27 install). The rebrand ADDS markers, never removes them — an
      // un-updated legacy Windsurf install must keep detecting. Note
      // /Applications/Devin.app is the EDITOR: the devin adapter must never
      // claim it (Devin CLI detection is ~/.config/devin + PATH).
      for (const p of [
        join(homedir(), ".codeium", "windsurf"),
        "/Applications/Windsurf.app",
        join(homedir(), "Library", "Application Support", "Windsurf"),
        "/Applications/Devin.app",
        join(homedir(), "Library", "Application Support", "Devin"),
      ]) {
        try {
          await access(p);
          return true;
        } catch {
          // not this one
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
      // Never invent the harness's config root: if ~/.codeium/windsurf is
      // absent, writing into a manufactured tree would report success while
      // Devin Desktop reads nothing — a silent no-op wearing a green check.
      // The skills/ SUBDIR is created on write (fresh installs lack it until
      // something writes skills; observed 2026-07-10), but the root must
      // already exist. Callers surface the thrown error as a skip notice.
      if (targetDir === WINDSURF_SKILLS_DIR) {
        try {
          await access(WINDSURF_ROOT);
        } catch {
          // Detected but not launched yet: a benign skip, not a failure.
          throw new AdapterSkipError(
            "Devin Desktop config root (~/.codeium/windsurf) not found — skipping; launch the app once and sync again",
          );
        }
      }
      const slugDir = materializeSlugDir(slug, opts.owner ?? null, { dirName: opts.dirName });
      validateMaterializationPath(targetDir, slugDir);
      return writeBundleToDir(targetDir, slugDir, bundle);
    },

    targetPath(slug: string, opts: TargetPathOptions = {}): string {
      assertSafeSlug(slug);
      const slugDir = materializeSlugDir(slug, opts.owner ?? null, { dirName: opts.dirName });
      const rel = `${slugDir}/SKILL.md`;
      const hostRel = sep === "/" ? rel : rel.split("/").join(sep);
      return join(targetDir, hostRel);
    },

    targetSkillDir(slug: string, opts: TargetPathOptions = {}): string {
      assertSafeSlug(slug);
      return join(targetDir, materializeSlugDir(slug, opts.owner ?? null, { dirName: opts.dirName }));
    },
  };
}

export const windsurfAdapter: Adapter = createAdapter();
export default windsurfAdapter;
