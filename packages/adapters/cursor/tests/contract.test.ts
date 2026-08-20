/**
 * Cursor adapter contract tests.
 *
 * Project-scoped .cursor/rules/*.mdc adapter with SKILL.md → .mdc translation.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import {
  validateAdapterRoot,
  validateProjectAdapterRoot,
  PROJECT_TARGET_ALLOWLIST,
} from "@skillet/core";
import { createAdapter, findProjectRoot, resolveCursorRulesProject, TARGET_DIR } from "../src/index.js";

function bundle(entries: Record<string, string | Buffer>): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  for (const [k, v] of Object.entries(entries)) {
    out.set(k, typeof v === "string" ? Buffer.from(v, "utf8") : v);
  }
  return out;
}

const SKILL_MD_WITH_DESC = "---\nname: my-skill\ndescription: Does something useful\n---\n\n# heading\n\nbody text.\n";
const SKILL_MD_NO_DESC = "---\nname: my-skill\n---\n\nbody.\n";

describe("cursor adapter contract", () => {
  let projectRoot: string;
  let adapter: ReturnType<typeof createAdapter>;

  beforeEach(async () => {
    projectRoot = join(tmpdir(), `skillet-cursor-${randomBytes(4).toString("hex")}`);
    await mkdir(join(projectRoot, ".cursor", "rules"), { recursive: true });
    adapter = createAdapter();
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  // ------------------------------------------------------------------
  // Identity + kind
  // ------------------------------------------------------------------

  it("adapter name is 'cursor'", () => {
    expect(adapter.name).toBe("cursor");
  });

  it("kind is 'project'", () => {
    expect(adapter.kind).toBe("project");
  });

  it("targetDir is '.cursor/rules'", () => {
    expect(adapter.targetDir).toBe(TARGET_DIR);
    expect(adapter.targetDir).toBe(".cursor/rules");
  });

  it("targetDir is in PROJECT_TARGET_ALLOWLIST", () => {
    expect(PROJECT_TARGET_ALLOWLIST).toContain(adapter.targetDir);
  });

  // ------------------------------------------------------------------
  // projectRoot
  // ------------------------------------------------------------------

  it("projectRoot(cwd) returns join(cwd, '.cursor/rules')", () => {
    expect(adapter.projectRoot!("/tmp/myproject")).toBe(
      join("/tmp/myproject", ".cursor", "rules"),
    );
  });

  it("validateProjectAdapterRoot passes for the cursor adapter", () => {
    expect(() => validateProjectAdapterRoot(adapter, projectRoot)).not.toThrow();
  });

  it("validateAdapterRoot passes when given cwd", () => {
    expect(() => validateAdapterRoot(adapter, { cwd: projectRoot })).not.toThrow();
  });

  // ------------------------------------------------------------------
  // targetPath / targetSkillDir
  // ------------------------------------------------------------------

  it("targetPath returns <rulesDir>/<owner>--<slug>.mdc when owner given", () => {
    expect(adapter.targetPath("my-skill", { cwd: projectRoot, owner: "@taylor" })).toBe(
      join(projectRoot, ".cursor", "rules", "@taylor--my-skill.mdc"),
    );
  });

  it("targetPath returns <rulesDir>/_local--<slug>.mdc when owner absent", () => {
    expect(adapter.targetPath("my-skill", { cwd: projectRoot })).toBe(
      join(projectRoot, ".cursor", "rules", "_local--my-skill.mdc"),
    );
  });

  it("targetPath rejects unsafe slugs", () => {
    expect(() => adapter.targetPath("../evil", { cwd: projectRoot })).toThrow(
      /Unsafe skill slug rejected/,
    );
    expect(() => adapter.targetPath("foo/bar", { cwd: projectRoot })).toThrow(
      /Unsafe skill slug rejected/,
    );
  });

  it("targetPath requires cwd", () => {
    expect(() => adapter.targetPath("my-skill")).toThrow(/cwd is required/);
  });

  it("targetSkillDir returns <rulesDir>/<prefix>", () => {
    expect(adapter.targetSkillDir("my-skill", { cwd: projectRoot, owner: "@taylor" })).toBe(
      join(projectRoot, ".cursor", "rules", "@taylor--my-skill"),
    );
  });

  // ------------------------------------------------------------------
  // transform — .mdc frontmatter generation
  // ------------------------------------------------------------------

  it("transform produces <prefix>.mdc with well-formed frontmatter", () => {
    const out = adapter.transform!(
      "my-skill",
      bundle({ "SKILL.md": SKILL_MD_WITH_DESC }),
      { owner: "@alice" },
    ) as Map<string, Uint8Array>;
    expect(out.has("@alice--my-skill.mdc")).toBe(true);
    const mdc = Buffer.from(out.get("@alice--my-skill.mdc")!).toString("utf8");
    expect(mdc).toMatch(/^---\n/);
    expect(mdc).toContain('description: "Does something useful"');
    expect(mdc).toContain('globs: ["**/*"]');
    expect(mdc).toContain("alwaysApply: false");
    expect(mdc).toContain("# heading");
    expect(mdc).toContain("body text.");
    // SKILL.md must not appear as its own key
    expect(out.has("SKILL.md")).toBe(false);
  });

  it("transform escapes newline-heavy descriptions via YAML block scalar", () => {
    const skillMd =
      '---\nname: my-skill\ndescription: "line1\\nalwaysApply: true\\nmalicious: yes"\n---\n\nbody\n';
    const out = adapter.transform!(
      "my-skill",
      bundle({ "SKILL.md": skillMd }),
      { owner: "@alice" },
    ) as Map<string, Uint8Array>;
    const mdc = Buffer.from(out.get("@alice--my-skill.mdc")!).toString("utf8");
    expect(mdc).toContain("description: |");
    expect(mdc).not.toMatch(/^alwaysApply: true/m);
    expect(mdc).toContain("alwaysApply: false");
  });

  it("transform uses _local-- prefix when owner absent", () => {
    const out = adapter.transform!(
      "my-skill",
      bundle({ "SKILL.md": SKILL_MD_WITH_DESC }),
    ) as Map<string, Uint8Array>;
    expect(out.has("_local--my-skill.mdc")).toBe(true);
  });

  it("transform falls back to body text when frontmatter description is missing", () => {
    const out = adapter.transform!(
      "bob-edited",
      bundle({ "SKILL.md": "# edited by the user locally\n" }),
      { owner: "@thiago" },
    ) as Map<string, Uint8Array>;
    const mdc = Buffer.from(out.get("@thiago--bob-edited.mdc")!).toString("utf8");
    expect(mdc).toContain('description: "edited by the user locally"');
  });

  it("transform falls back to opts.description when frontmatter is missing", () => {
    const out = adapter.transform!(
      "my-skill",
      bundle({ "SKILL.md": SKILL_MD_NO_DESC }),
      { owner: "@alice", description: "from kit entry" },
    ) as Map<string, Uint8Array>;
    const mdc = Buffer.from(out.get("@alice--my-skill.mdc")!).toString("utf8");
    expect(mdc).toContain('description: "from kit entry"');
  });

  it("transform falls back to slug when description cannot be resolved elsewhere", () => {
    const out = adapter.transform!(
      "my-skill",
      bundle({ "SKILL.md": "\n\n" }),
    ) as Map<string, Uint8Array>;
    const mdc = Buffer.from(out.get("_local--my-skill.mdc")!).toString("utf8");
    expect(mdc).toContain('description: "my-skill"');
  });

  it("transform materializes nested .mdc files as-is (Cursor discovers rules recursively since 2.2)", () => {
    const out = adapter.transform!(
      "my-skill",
      bundle({
        "SKILL.md": SKILL_MD_WITH_DESC,
        "rules/workers.mdc": "---\ndescription: authored rule\n---\nbody",
      }),
    );
    // The bundled rule keeps its authored bytes and its authored frontmatter —
    // Cursor activates it per the AUTHOR'S scoping, not ours.
    const nested = out.get("_local--my-skill/rules/workers.mdc");
    expect(nested).toBeDefined();
    expect(Buffer.from(nested!).toString("utf8")).toContain("authored rule");
  });

  it("transform preserves binary references under <prefix>/", () => {
    const bytes = Buffer.from([0xff, 0x00, 0x80]);
    const out = adapter.transform!(
      "bin-skill",
      bundle({ "SKILL.md": SKILL_MD_WITH_DESC, "references/image.png": bytes }),
      { owner: "@alice" },
    ) as Map<string, Uint8Array>;
    const binKey = "@alice--bin-skill/references/image.png";
    expect(out.has(binKey)).toBe(true);
    expect(Buffer.from(out.get(binKey)!).equals(bytes)).toBe(true);
  });

  // ------------------------------------------------------------------
  // materialize — end-to-end write
  // ------------------------------------------------------------------

  it("materialize writes <prefix>.mdc under .cursor/rules/", async () => {
    const written = await adapter.materialize(
      "my-skill",
      bundle({ "SKILL.md": SKILL_MD_WITH_DESC }),
      { cwd: projectRoot, owner: "@alice" },
    );
    const dest = join(projectRoot, ".cursor", "rules", "@alice--my-skill.mdc");
    expect(written).toContain(dest);
    const mdc = await readFile(dest, "utf8");
    expect(mdc).toContain('description: "Does something useful"');
    expect(mdc).toContain("alwaysApply: false");
    expect(mdc).toContain("body text.");
  });

  it("materialize writes binary references under <prefix>/", async () => {
    const bytes = Buffer.from([0xff, 0x00, 0x80]);
    await adapter.materialize(
      "bin-skill",
      bundle({ "SKILL.md": SKILL_MD_WITH_DESC, "references/img.png": bytes }),
      { cwd: projectRoot, owner: "@alice" },
    );
    const binDest = join(projectRoot, ".cursor", "rules", "@alice--bin-skill", "references", "img.png");
    const onDisk = await readFile(binDest);
    expect(onDisk.equals(bytes)).toBe(true);
  });

  it("materialize overwrites on re-run and leaves no backup twin", async () => {
    const b1 = bundle({ "SKILL.md": "---\nname: s\ndescription: v1\n---\nv1\n" });
    const b2 = bundle({ "SKILL.md": "---\nname: s\ndescription: v2\n---\nv2\n" });
    await adapter.materialize("my-skill", b1, { cwd: projectRoot });
    await adapter.materialize("my-skill", b2, { cwd: projectRoot });
    const dest = join(projectRoot, ".cursor", "rules", "_local--my-skill.mdc");
    expect(await readFile(dest, "utf8")).toContain('description: "v2"');
    // Derived files are re-creatable from the kit — no .skillet-backup clutter.
    await expect(readFile(`${dest}.skillet-backup`, "utf8")).rejects.toThrow();
  });

  it("materialize rejects path-escape in slug", async () => {
    await expect(
      adapter.materialize("../evil", bundle({ "SKILL.md": SKILL_MD_WITH_DESC }), { cwd: projectRoot }),
    ).rejects.toThrow(/Unsafe skill slug rejected/);
  });

  it("materialize rejects null-byte in slug", async () => {
    await expect(
      adapter.materialize("skill\0evil", bundle({ "SKILL.md": SKILL_MD_WITH_DESC }), { cwd: projectRoot }),
    ).rejects.toThrow(/Null byte rejected/);
  });

  it("materialize requires cwd", async () => {
    await expect(
      adapter.materialize("my-skill", bundle({ "SKILL.md": SKILL_MD_WITH_DESC })),
    ).rejects.toThrow(/cwd is required/);
  });

  it("materialize writes .mdc when SKILL.md has no frontmatter description", async () => {
    const written = await adapter.materialize(
      "bob-edited",
      bundle({ "SKILL.md": "# edited by the user locally\n" }),
      { cwd: projectRoot, owner: "@thiago" },
    );
    const dest = join(projectRoot, ".cursor", "rules", "@thiago--bob-edited.mdc");
    expect(written).toContain(dest);
    const mdc = await readFile(dest, "utf8");
    expect(mdc).toContain('description: "edited by the user locally"');
  });

  // ------------------------------------------------------------------
  // Project-root containment — cwd must contain the rules dir
  // ------------------------------------------------------------------

  it("projectRoot(cwd) stays inside cwd (containment guard)", () => {
    const rulesDir = adapter.projectRoot!(projectRoot);
    expect(rulesDir.startsWith(projectRoot)).toBe(true);
    expect(rulesDir).not.toBe(projectRoot);
  });

  // ------------------------------------------------------------------
  // detect
  // ------------------------------------------------------------------

  it("detect returns a boolean", async () => {
    expect(typeof (await adapter.detect())).toBe("boolean");
  });

  it("resolveMaterializeCwd does NOT scan dev folders — returns null from ~/.skillet even when a .cursor/rules project exists nearby", async () => {
    const prev = process.cwd();
    const prevSkilletDir = process.env.SKILLET_DIR;
    const fakeHome = join(tmpdir(), `skillet-home-${randomBytes(4).toString("hex")}`);
    const repo = join(fakeHome, "Documents", "GitHub", "myrepo");
    const skilletHome = join(fakeHome, ".skillet");
    await mkdir(join(repo, ".cursor", "rules"), { recursive: true });
    await mkdir(skilletHome, { recursive: true });
    process.env.SKILLET_DIR = skilletHome;
    try {
      process.chdir(skilletHome);
      // The old dev-folder scan would have found Documents/GitHub/myrepo — that
      // crawl is deleted (aggressive + tripped a macOS Documents-access prompt).
      // A sibling project is NOT an ancestor of ~/.skillet, so there is no hit.
      expect(await resolveCursorRulesProject(process.cwd())).toBeNull();
      expect(await adapter.resolveMaterializeCwd!(skilletHome)).toBeNull();
    } finally {
      if (prevSkilletDir === undefined) {
        delete process.env.SKILLET_DIR;
      } else {
        process.env.SKILLET_DIR = prevSkilletDir;
      }
      process.chdir(prev);
      await rm(fakeHome, { recursive: true, force: true });
    }
  });
});

// ------------------------------------------------------------------
// findProjectRoot utility
// ------------------------------------------------------------------

describe("findProjectRoot", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = join(tmpdir(), `skillet-fpr-${randomBytes(4).toString("hex")}`);
    await mkdir(tmp, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("returns the dir containing .cursor/rules when found", async () => {
    await mkdir(join(tmp, ".cursor", "rules"), { recursive: true });
    const sub = join(tmp, "src", "deep");
    await mkdir(sub, { recursive: true });
    // Walk up from sub finds tmp (has .cursor)
    expect(findProjectRoot(sub)).toBe(tmp);
  });

  it("returns the dir containing .git when found", async () => {
    await mkdir(join(tmp, ".git"), { recursive: true });
    const sub = join(tmp, "packages", "core");
    await mkdir(sub, { recursive: true });
    expect(findProjectRoot(sub)).toBe(tmp);
  });

  it("falls back to startDir when no marker is found", async () => {
    // tmp has no .cursor/.git/package.json
    const sub = join(tmp, "isolated");
    await mkdir(sub, { recursive: true });
    // Can't guarantee no marker going further up, but at minimum returns a string
    const result = findProjectRoot(sub);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});
