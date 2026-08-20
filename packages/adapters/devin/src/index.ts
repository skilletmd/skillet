import { join, sep, delimiter, dirname } from "node:path";
import { homedir, platform } from "node:os";
import { access } from "node:fs/promises";
import type { Adapter, MaterializeOptions, TargetPathOptions } from "@skillet/core";
import type { DecodedBundle } from "@skillet/core";
import {
  assertSafeSlug,
  isTccProtectedPath,
  materializeSlugDir,
  validateMaterializationPath,
  writeBundleToDir,
} from "@skillet/core";

export type { Adapter };

// Devin CLI/Local reads user-global skills from `~/.config/devin/skills/`
// (POSIX) / `%APPDATA%\devin\skills` (Windows) — the same SKILL.md-per-folder
// layout as Claude Code and Codex (docs.devin.ai/cli/extensibility/skills/
// overview). Rules, separately, come from `.claude/` + `AGENTS.md`; those are
// not skills. So Devin is a GLOBAL adapter, not the project-scoped
// `.devin/rules` writer it used to be (which Devin never read).
function resolveTargetDir(): string {
  if (platform() === "win32") {
    const appData = process.env["APPDATA"];
    return appData && appData.length > 0
      ? join(appData, "devin", "skills")
      : join(homedir(), "AppData", "Roaming", "devin", "skills");
  }
  return join(homedir(), ".config", "devin", "skills");
}
const DEFAULT_TARGET_DIR = resolveTargetDir();

/**
 * Best-effort existence scan for a `devin` binary across PATH entries — a
 * pure filesystem check, NEVER spawning the binary: detect() runs unattended
 * from the tray, so executing whatever PATH resolves would turn routine
 * detection into arbitrary code execution.
 */
async function devinOnPath(): Promise<boolean> {
  const pathVar = process.env["PATH"];
  if (!pathVar) return false;
  const names = platform() === "win32" ? ["devin.exe", "devin.cmd", "devin.bat"] : ["devin"];
  for (const dir of pathVar.split(delimiter)) {
    if (!dir) continue;
    // TCC hygiene (U2): a PATH entry resolving into a macOS-protected folder
    // (~/Documents, ~/Desktop, ~/Downloads) is never probed. Not because the
    // access() would prompt — metadata probes (stat/access) are TCC-exempt;
    // only content reads (readdir/open) trip the consent dialog (see the
    // policy note in core's pathsafe.ts and the tcc probe-contract test).
    // The filter is uniformity: PATH-derived candidates are dropped at the
    // boundary so they can never become content-read targets downstream. The
    // deliberate trade-off is that a devin binary living inside a protected
    // folder is never discovered.
    if (isTccProtectedPath(dir)) continue;
    for (const name of names) {
      try {
        await access(join(dir, name));
        return true;
      } catch {
        // keep scanning
      }
    }
  }
  return false;
}

export function createAdapter(baseDir?: string): Adapter {
  const targetDir = baseDir ?? DEFAULT_TARGET_DIR;

  return {
    name: "devin",
    targetDir,

    async detect(): Promise<boolean> {
      // Devin CLI's install footprint: ~/.config/devin (created at install/
      // first-config) or a `devin` binary on PATH. Deliberately NOT
      // /Applications/Devin.app — since the 2026-06 rebrand that is Devin
      // Desktop, the former Windsurf editor, which the windsurf adapter owns.
      // Devin Desktop also creates ~/.config/devin (observed on a fresh
      // 3.4.27 install: cli/ + config.json), and that is a TRUE positive:
      // Desktop ships Devin Local, which shares the CLI's skills discovery —
      // such machines legitimately run both surfaces.
      try {
        await access(dirname(targetDir));
        return true;
      } catch {
        // fall through to the PATH scan
      }
      return devinOnPath();
    },

    async materialize(
      slug: string,
      bundle: DecodedBundle,
      opts: MaterializeOptions = {},
    ): Promise<string[]> {
      assertSafeSlug(slug);
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

export const devinAdapter: Adapter = createAdapter();
export default devinAdapter;
