import { join, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { existsSync, realpathSync } from "node:fs";
import { access } from "node:fs/promises";
import type { Adapter, MaterializeOptions, TargetPathOptions } from "@skillet/core";
import type { DecodedBundle } from "@skillet/core";
import {
  assertSafeSlug,
  applyAdapterTransform,
  materializeSlugDir,
  resolveSkillDescription,
  validateProjectAdapterRoot,
  writeFilesToRoot,
} from "@skillet/core";

export type { Adapter };

/** Relative POSIX path under the project root where Cursor loads rules. */
export const TARGET_DIR = ".cursor/rules";

/**
 * Walk up from `startDir` to the nearest ancestor containing `.cursor/`,
 * `.git/`, or `package.json`. Falls back to `startDir` itself.
 */
export function findProjectRoot(startDir: string): string {
  let dir = startDir;
    while (true) {
      if (
        existsSync(join(dir, ".cursor", "rules")) ||
        existsSync(join(dir, ".git")) ||
        existsSync(join(dir, "package.json"))
      ) {
        return dir;
      }
    const parent = dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  return startDir;
}

/** Canonical path for directory comparisons (macOS /var vs /private/var after chdir). */
function canonicalDir(dir: string): string {
  try {
    return realpathSync(dir);
  } catch {
    return resolve(dir);
  }
}

async function hasCursorRules(dir: string): Promise<boolean> {
  try {
    await access(join(dir, ".cursor", "rules"));
    return true;
  } catch {
    return false;
  }
}

async function walkUpForCursorRules(startDir: string): Promise<string | null> {
  let dir = startDir;
  while (true) {
    if (await hasCursorRules(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Resolve a project directory that contains `.cursor/rules` by walking UP from
 * the real cwd. Deliberately does NOT scan the user's dev folders (~/Documents,
 * ~/code, …): that crawl injected `.cursor/rules` into every project AND tripped
 * a macOS TCC "access your Documents folder" prompt. Cursor reads skills from the
 * global `~/.agents/skills` Skillet already writes (cursor.com/docs/skills), so
 * `.cursor/rules` materialize only happens when the CLI is run from a project.
 */
export async function resolveCursorRulesProject(
  startDir: string,
): Promise<string | null> {
  const fromWalk = await walkUpForCursorRules(startDir);
  return fromWalk ? canonicalDir(fromWalk) : null;
}

/**
 * Parse YAML frontmatter from SKILL.md content.
 * Returns the frontmatter key→value map and the body (content after the closing ---).
 */
function parseSkillMdFrontmatter(content: string): {
  frontmatter: Record<string, string>;
  body: string;
} {
  if (!content.startsWith("---\n")) {
    return { frontmatter: {}, body: content };
  }
  const end = content.indexOf("\n---\n", 4);
  if (end === -1) {
    return { frontmatter: {}, body: content };
  }
  const fmText = content.slice(4, end);
  const body = content.slice(end + 5);
  const frontmatter: Record<string, string> = {};
  const lines = fmText.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Only top-level (unindented) lines start a key. Indented lines belong to a
    // preceding multi-line value or nested mapping and are consumed below —
    // without this, a multi-line `description:` (value on the next indented
    // lines) parsed as empty and the adapter wrongly rejected the whole skill.
    if (/^\s/.test(line)) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    let val = line.slice(colon + 1).trim();
    const blockScalar = /^[|>][+-]?$/.test(val); // `|`, `>`, `|-`, `>-`
    if (val === "" || blockScalar) {
      // Gather the following indented lines. Literal (`|`) keeps newlines; plain
      // (empty) and folded (`>`) join with spaces, matching YAML folding.
      const literal = val.startsWith("|");
      const collected: string[] = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) {
        collected.push(lines[i + 1].replace(/^\s+/, ""));
        i++;
      }
      val = collected.join(literal ? "\n" : " ").trim();
    } else if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    frontmatter[key] = val;
  }
  return { frontmatter, body };
}

export function createAdapter(): Adapter {
  const adapter: Adapter = {
    name: "cursor",
    kind: "project",
    targetDir: TARGET_DIR,

    projectRoot(cwd: string): string {
      return join(cwd, ".cursor", "rules");
    },

    async detect(): Promise<boolean> {
      // Cursor is INSTALLED — not "a .cursor folder exists somewhere" (which
      // Skillet's own materialize creates, a self-perpetuating false positive).
      // Check the app bundle / user data only a real Cursor install produces.
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

    async resolveMaterializeCwd(syncCwd: string): Promise<string | null> {
      return resolveCursorRulesProject(syncCwd);
    },

    transform(slug: string, bundle: DecodedBundle, opts: MaterializeOptions = {}): DecodedBundle {
      assertSafeSlug(slug);
      const prefix = materializeSlugDir(slug, opts.owner ?? null, { dirName: opts.dirName });

      const skillMdBytes = bundle.get("SKILL.md");
      if (!skillMdBytes) {
        throw new Error(
          `Cursor adapter: bundle for "${slug}" is missing SKILL.md`,
        );
      }

      const skillMdContent = Buffer.from(skillMdBytes).toString("utf8");
      const { frontmatter, body } = parseSkillMdFrontmatter(skillMdContent);

      const { description: desc } = resolveSkillDescription({
        frontmatterDescription: frontmatter["description"],
        optsDescription: opts.description,
        body,
        slug,
      });

      // Escape YAML metacharacters via a block scalar (NF-008).
      const descYaml =
        desc.includes("\n") || desc.includes('"') || desc.includes(":") || desc.includes("#")
          ? `|\n${desc
              .split("\n")
              .map((line) => `  ${line}`)
              .join("\n")}`
          : `"${desc.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
      const mdc = `---\ndescription: ${descYaml}\nglobs: ["**/*"]\nalwaysApply: false\n---\n${body}`;

      const out: DecodedBundle = new Map();
      out.set(`${prefix}.mdc`, Buffer.from(mdc, "utf8"));

      // Nested .mdc files materialize as-is. Cursor discovers rules
      // recursively under .cursor/rules (documented since 2.2, verified
      // against the 3.8.11 bundle's `**/.cursor/rules/**/*.mdc` glob), so a
      // bundled .mdc becomes a live rule with its AUTHOR'S frontmatter —
      // which is the point of shipping one (e.g. cloudflare/skills'
      // rules/workers.mdc, an auto-attach rule for JS/TS files). Pre-2.2
      // Cursor ignores nested .mdc entirely: inert, never harmful. Content
      // safety stays with the scan/trust gates — the skill's own generated
      // rule above already injects its whole body, so a nested rule grants
      // nothing new.
      for (const [path, bytes] of bundle) {
        if (path === "SKILL.md") continue;
        out.set(`${prefix}/${path}`, bytes);
      }

      return out;
    },

    async materialize(
      slug: string,
      bundle: DecodedBundle,
      opts: MaterializeOptions = {},
    ): Promise<string[]> {
      if (!opts.cwd) {
        throw new Error(`Cursor adapter: cwd is required for project-scoped materialize`);
      }
      assertSafeSlug(slug);
      validateProjectAdapterRoot(adapter, opts.cwd);
      const root = adapter.projectRoot!(opts.cwd);
      const translated = await applyAdapterTransform(adapter, slug, bundle, opts);
      return writeFilesToRoot(root, translated);
    },

    targetPath(slug: string, opts: TargetPathOptions = {}): string {
      if (!opts.cwd) {
        throw new Error(`Cursor adapter: cwd is required for project-scoped targetPath`);
      }
      assertSafeSlug(slug);
      const prefix = materializeSlugDir(slug, opts.owner ?? null, { dirName: opts.dirName });
      return join(adapter.projectRoot!(opts.cwd), `${prefix}.mdc`);
    },

    targetSkillDir(slug: string, opts: TargetPathOptions = {}): string {
      if (!opts.cwd) {
        throw new Error(`Cursor adapter: cwd is required for project-scoped targetSkillDir`);
      }
      assertSafeSlug(slug);
      const prefix = materializeSlugDir(slug, opts.owner ?? null, { dirName: opts.dirName });
      return join(adapter.projectRoot!(opts.cwd), prefix);
    },
  };

  return adapter;
}

export const cursorAdapter: Adapter = createAdapter();
export default cursorAdapter;
