import { join, sep } from "node:path";
import { homedir } from "node:os";
import { access } from "node:fs/promises";
import type { Adapter, MaterializeOptions, TargetPathOptions } from "@skillet/core";
import type { DecodedBundle } from "@skillet/core";
import {
  assertSafeSlug,
  materializeSlugDir,
  validateMaterializationPath,
  writeBundleToDir,
} from "@skillet/core";

export type { Adapter };

// Cursor reads Agent Skills from the universal `~/.agents/skills` folder and a
// repo's `.agents/skills`, plus its own `.cursor/skills` and the Claude and
// Codex folders for compatibility (cursor.com/docs/skills; verified against the
// 3.13.10 bundle's `.agents/skills/**` and `.cursor/skills/**` globs). The
// universal baseline already writes both `.agents/skills` roots on every sync,
// so Cursor is a BASELINE READER like opencode: detected and labeled, never a
// second materialization. A Cursor-only copy under `.cursor/skills` would list
// every skill twice in Cursor.
//
// Until November 2026 this adapter translated each SKILL.md into one
// `.cursor/rules/<owner>--<slug>.mdc` rule. Cursor has read skills folders
// since 2.4 (January 2026), so those rules duplicated the baseline and fired on
// every file. Sync sweeps the ones it can prove it wrote
// (`cleanupLegacyCursorRules` in @skillet/core).
const DEFAULT_TARGET_DIR = join(homedir(), ".agents", "skills");

export function createAdapter(baseDir = DEFAULT_TARGET_DIR): Adapter {
  return {
    name: "cursor",
    targetDir: baseDir,

    async detect(): Promise<boolean> {
      // Cursor is INSTALLED: the app bundle or the user data only a real
      // install produces. Never "a .cursor folder exists in some repo", which
      // any editor session (or the old adapter) could have created.
      for (const p of [
        "/Applications/Cursor.app",
        join(homedir(), "Library", "Application Support", "Cursor"),
        join(homedir(), ".config", "Cursor"),
        join(homedir(), ".cursor"),
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

export const cursorAdapter: Adapter = createAdapter();
export default cursorAdapter;
