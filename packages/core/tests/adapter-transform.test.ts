/**
 * Adapter interface: kind + project root + transform hook.
 *
 * Foundation tests for the project-scoped adapter shape (Windsurf) and the
 * SKILL.md → native-format translation hook.
 */

import { describe, it, expect } from "vitest";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

import {
  applyAdapterTransform,
  writeFilesToRoot,
  validateAdapterRoot,
  validateProjectAdapterRoot,
  resolveAdapterRoot,
  PROJECT_TARGET_ALLOWLIST,
  type Adapter,
  type DecodedBundle,
} from "../src/index.js";

function bundle(entries: Record<string, string | Buffer>): DecodedBundle {
  const m = new Map<string, Uint8Array>();
  for (const [k, v] of Object.entries(entries)) {
    m.set(k, typeof v === "string" ? Buffer.from(v, "utf8") : v);
  }
  return m;
}

function mkProjectAdapter(overrides: Partial<Adapter> = {}): Adapter {
  return {
    name: "windsurf",
    kind: "project",
    targetDir: ".windsurf/rules",
    projectRoot: (cwd: string) => join(cwd, ".windsurf", "rules"),
    detect: async () => true,
    materialize: async () => [],
    targetPath: () => "",
    targetSkillDir: () => "",
    ...overrides,
  };
}

// ----------------------------------------------------------------------
// AdapterKind default + resolveAdapterRoot
// ----------------------------------------------------------------------

describe("AdapterKind defaults", () => {
  it("omitting kind is treated as global by resolveAdapterRoot", () => {
    const a: Adapter = {
      name: "fake-global",
      targetDir: join(homedir(), ".claude", "skills"),
      detect: async () => true,
      materialize: async () => [],
      targetPath: () => "",
      targetSkillDir: () => "",
    };
    expect(resolveAdapterRoot(a)).toBe(a.targetDir);
  });

  it("kind='global' explicit also returns static targetDir", () => {
    const a: Adapter = {
      name: "claude-code",
      kind: "global",
      targetDir: join(homedir(), ".claude", "skills"),
      detect: async () => true,
      materialize: async () => [],
      targetPath: () => "",
      targetSkillDir: () => "",
    };
    expect(resolveAdapterRoot(a, { cwd: "/tmp/whatever" })).toBe(a.targetDir);
  });

  it("kind='project' requires cwd", () => {
    const a = mkProjectAdapter();
    expect(() => resolveAdapterRoot(a)).toThrow(/cwd is required/);
    expect(resolveAdapterRoot(a, { cwd: "/tmp/proj" })).toBe(
      join("/tmp/proj", ".windsurf", "rules"),
    );
  });

  it("kind='project' without projectRoot impl throws", () => {
    const a = mkProjectAdapter();
    delete (a as { projectRoot?: unknown }).projectRoot;
    expect(() => resolveAdapterRoot(a, { cwd: "/tmp/proj" })).toThrow(
      /does not implement projectRoot/,
    );
  });
});

// ----------------------------------------------------------------------
// PROJECT_TARGET_ALLOWLIST
// ----------------------------------------------------------------------

describe("PROJECT_TARGET_ALLOWLIST", () => {
  it("lists the v1 project roots (Windsurf, Cursor)", () => {
    expect(PROJECT_TARGET_ALLOWLIST).toContain(".windsurf/rules");
    expect(PROJECT_TARGET_ALLOWLIST).toContain(".cursor/rules");
  });

  it("is frozen (not mutable at runtime)", () => {
    expect(Object.isFrozen(PROJECT_TARGET_ALLOWLIST)).toBe(true);
    expect(() => {
      (PROJECT_TARGET_ALLOWLIST as string[]).push("/tmp/attacker");
    }).toThrow();
  });
});

// ----------------------------------------------------------------------
// validateProjectAdapterRoot
// ----------------------------------------------------------------------

describe("validateProjectAdapterRoot", () => {
  it("accepts an allowlisted project root with cwd", () => {
    expect(() =>
      validateProjectAdapterRoot(mkProjectAdapter(), "/tmp/proj"),
    ).not.toThrow();
  });

  it("rejects a global adapter passed in", () => {
    const g: Adapter = {
      name: "claude-code",
      targetDir: join(homedir(), ".claude", "skills"),
      detect: async () => true,
      materialize: async () => [],
      targetPath: () => "",
      targetSkillDir: () => "",
    };
    expect(() => validateProjectAdapterRoot(g, "/tmp/proj")).toThrow(
      /not project-scoped/,
    );
  });

  it("rejects an absolute targetDir", () => {
    expect(() =>
      validateProjectAdapterRoot(
        mkProjectAdapter({ targetDir: "/etc/passwd" }),
        "/tmp/proj",
      ),
    ).toThrow(/relative POSIX path/);
  });

  it("rejects a non-allowlisted relative path", () => {
    expect(() =>
      validateProjectAdapterRoot(
        mkProjectAdapter({
          targetDir: "arbitrary/place",
          projectRoot: (cwd) => join(cwd, "arbitrary", "place"),
        }),
        "/tmp/proj",
      ),
    ).toThrow(/project-target allowlist/);
  });

  it("rejects projectRoot(cwd) that escapes cwd", () => {
    expect(() =>
      validateProjectAdapterRoot(
        mkProjectAdapter({ projectRoot: () => "/etc/passwd" }),
        "/tmp/proj",
      ),
    ).toThrow(/escapes cwd/);
  });

  it("rejects empty cwd", () => {
    expect(() => validateProjectAdapterRoot(mkProjectAdapter(), "")).toThrow(
      /non-empty cwd/,
    );
  });

  it("rejects null-byte in cwd", () => {
    expect(() =>
      validateProjectAdapterRoot(mkProjectAdapter(), "/tmp/proj\0evil"),
    ).toThrow(/null byte/);
  });

  it("rejects missing projectRoot impl", () => {
    const a = mkProjectAdapter();
    delete (a as { projectRoot?: unknown }).projectRoot;
    expect(() => validateProjectAdapterRoot(a, "/tmp/proj")).toThrow(
      /does not implement projectRoot/,
    );
  });
});

// ----------------------------------------------------------------------
// validateAdapterRoot — unified entry point
// ----------------------------------------------------------------------

describe("validateAdapterRoot (unified)", () => {
  it("validates global adapters without needing cwd", () => {
    const g: Adapter = {
      name: "claude-code",
      targetDir: join(homedir(), ".claude", "skills"),
      detect: async () => true,
      materialize: async () => [],
      targetPath: () => "",
      targetSkillDir: () => "",
    };
    expect(() => validateAdapterRoot(g)).not.toThrow();
  });

  it("validates project adapters with cwd", () => {
    expect(() =>
      validateAdapterRoot(mkProjectAdapter(), { cwd: "/tmp/proj" }),
    ).not.toThrow();
  });

  it("project adapter without cwd is a clear error", () => {
    expect(() => validateAdapterRoot(mkProjectAdapter())).toThrow(
      /cwd is required/,
    );
  });
});

// ----------------------------------------------------------------------
// applyAdapterTransform — SKILL.md → flat-rule example (acceptance criterion #2)
// ----------------------------------------------------------------------

/**
 * Example transform that turns a Skillet bundle (`SKILL.md` + extras) into a
 * single flat rule file with rewrapped frontmatter. Used as the
 * acceptance-criterion test for the format-translation hook.
 */
function skillMdToRule(): NonNullable<Adapter["transform"]> {
  return async (slug, src) => {
    const md = Buffer.from(src.get("SKILL.md")!).toString("utf8");
    const stripped = md.replace(/^---[\s\S]*?---\s*/, "");
    const rule = `---\ndescription: Skillet skill ${slug}\nalwaysApply: false\n---\n${stripped}`;
    const out: DecodedBundle = new Map();
    out.set(`${slug}.md`, Buffer.from(rule, "utf8"));
    for (const [k, v] of src) {
      if (k === "SKILL.md") continue;
      out.set(k, v);
    }
    return out;
  };
}

describe("applyAdapterTransform — SKILL.md → flat-rule example", () => {
  it("returns the original bundle when transform is absent", async () => {
    const a = {};
    const b = bundle({ "SKILL.md": "hello" });
    const out = await applyAdapterTransform(a, "test", b);
    expect(out).toBe(b);
  });

  it("translates a SKILL.md bundle into a flat rule file", async () => {
    const a = { transform: skillMdToRule() };
    const b = bundle({
      "SKILL.md": "---\nname: my-skill\n---\n\n# heading\n\nbody.\n",
      "references/a.md": "ref",
    });
    const out = await applyAdapterTransform(a, "my-skill", b);
    expect(out.has("my-skill.md")).toBe(true);
    expect(out.has("SKILL.md")).toBe(false);
    const rule = Buffer.from(out.get("my-skill.md")!).toString("utf8");
    expect(rule).toMatch(/^---\ndescription: Skillet skill my-skill/);
    expect(rule).toContain("alwaysApply: false");
    expect(rule).toContain("# heading");
    expect(out.has("references/a.md")).toBe(true);
  });

  it("the transformed bundle can be written via writeFilesToRoot", async () => {
    const tmp = join(tmpdir(), `skillet-rule-${randomBytes(4).toString("hex")}`);
    await mkdir(tmp, { recursive: true });
    try {
      const a = { transform: skillMdToRule() };
      const b = bundle({
        "SKILL.md": "---\nname: my-skill\n---\nbody\n",
        "references/a.md": "ref",
      });
      const out = await applyAdapterTransform(a, "my-skill", b);
      const written = await writeFilesToRoot(tmp, out);
      expect(written).toContain(join(tmp, "my-skill.md"));
      expect(written).toContain(join(tmp, "references", "a.md"));
      expect(await readFile(join(tmp, "my-skill.md"), "utf8")).toMatch(
        /^---\ndescription: Skillet skill my-skill/,
      );
      expect(await readFile(join(tmp, "references", "a.md"), "utf8")).toBe(
        "ref",
      );
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

// ----------------------------------------------------------------------
// writeFilesToRoot — atomicity + path-escape rejection
// ----------------------------------------------------------------------

describe("writeFilesToRoot", () => {
  it("rejects path traversal in file keys", async () => {
    const tmp = join(tmpdir(), `skillet-flat-${randomBytes(4).toString("hex")}`);
    await mkdir(tmp, { recursive: true });
    try {
      await expect(
        writeFilesToRoot(tmp, new Map([["../evil", Buffer.from("x")]])),
      ).rejects.toThrow(/Path escape rejected/);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("rejects empty paths", async () => {
    const tmp = join(tmpdir(), `skillet-flat-${randomBytes(4).toString("hex")}`);
    await mkdir(tmp, { recursive: true });
    try {
      await expect(
        writeFilesToRoot(tmp, new Map([["", Buffer.from("x")]])),
      ).rejects.toThrow(/empty target path/);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("rejects null-byte in paths", async () => {
    const tmp = join(tmpdir(), `skillet-flat-${randomBytes(4).toString("hex")}`);
    await mkdir(tmp, { recursive: true });
    try {
      await expect(
        writeFilesToRoot(tmp, new Map([["foo\0bar", Buffer.from("x")]])),
      ).rejects.toThrow(/null byte/);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("overwrites atomically and leaves NO .skillet-backup twin", async () => {
    const tmp = join(tmpdir(), `skillet-flat-${randomBytes(4).toString("hex")}`);
    await mkdir(tmp, { recursive: true });
    try {
      await writeFilesToRoot(tmp, new Map([["rule.md", Buffer.from("v1")]]));
      await writeFilesToRoot(tmp, new Map([["rule.md", Buffer.from("v2")]]));
      expect(await readFile(join(tmp, "rule.md"), "utf8")).toBe("v2");
      // Materialized files are derived from the kit; no backup copy is kept
      // (they used to litter every agent folder with a twin of every file).
      await expect(readFile(join(tmp, "rule.md.skillet-backup"))).rejects.toThrow();
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("accepts a plain object as input", async () => {
    const tmp = join(tmpdir(), `skillet-flat-${randomBytes(4).toString("hex")}`);
    await mkdir(tmp, { recursive: true });
    try {
      const written = await writeFilesToRoot(tmp, {
        "a.md": Buffer.from("a"),
        "b/c.md": Buffer.from("c"),
      });
      expect(written).toEqual([
        join(tmp, "a.md"),
        join(tmp, "b", "c.md"),
      ]);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

// ----------------------------------------------------------------------
// End-to-end: project-scoped adapter using kind + projectRoot + transform
// ----------------------------------------------------------------------

describe("end-to-end: project-scoped Windsurf-style adapter", () => {
  it("validates, resolves root from cwd, transforms, and writes the rule", async () => {
    const tmp = join(tmpdir(), `skillet-e2e-${randomBytes(4).toString("hex")}`);
    const projectCwd = join(tmp, "proj");
    await mkdir(projectCwd, { recursive: true });
    try {
      const a: Adapter = {
        name: "windsurf",
        kind: "project",
        targetDir: ".windsurf/rules",
        projectRoot: (cwd) => join(cwd, ".windsurf", "rules"),
        detect: async () => true,
        transform: skillMdToRule(),
        async materialize(slug, src, opts = {}) {
          if (!opts.cwd) throw new Error("project adapter requires cwd");
          const root = this.projectRoot!(opts.cwd);
          const translated = await applyAdapterTransform(this, slug, src, opts);
          return writeFilesToRoot(root, translated);
        },
        targetPath(slug, opts = {}) {
          return join(this.projectRoot!(opts.cwd!), `${slug}.md`);
        },
        targetSkillDir(_slug, opts = {}) {
          return this.projectRoot!(opts.cwd!);
        },
      };

      // Security gate: kind+cwd path passes the allowlist.
      expect(() => validateAdapterRoot(a, { cwd: projectCwd })).not.toThrow();

      const written = await a.materialize(
        "my-skill",
        bundle({ "SKILL.md": "---\nname: my-skill\n---\nbody\n" }),
        { cwd: projectCwd, owner: null },
      );

      const expected = join(projectCwd, ".windsurf", "rules", "my-skill.md");
      expect(written).toContain(expected);
      expect(await readFile(expected, "utf8")).toMatch(
        /^---\ndescription: Skillet skill my-skill/,
      );
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
