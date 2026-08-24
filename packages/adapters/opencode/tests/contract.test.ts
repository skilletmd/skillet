import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// validateMaterializationPath and validateProjectAdapterRoot allowlist checks
// are tested in packages/core/tests/pathsafe.test.ts. Adapter tests use temp
// dirs for isolation; mock both here so they don't reject non-allowlisted roots.
vi.mock("@skillet/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@skillet/core")>();
  return {
    ...actual,
    validateMaterializationPath: vi.fn(),
    validateProjectAdapterRoot: vi.fn(),
  };
});
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { createAdapter, createProjectAdapter, findProjectRoot } from "../src/index.js";

function bundle(entries: Record<string, string | Buffer>): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  for (const [k, v] of Object.entries(entries)) {
    out.set(k, typeof v === "string" ? Buffer.from(v, "utf8") : v);
  }
  return out;
}

// ─── Global adapter ──────────────────────────────────────────────────────────

describe("opencode adapter contract", () => {
  let tmpBase: string;
  let adapter: ReturnType<typeof createAdapter>;

  beforeEach(async () => {
    tmpBase = join(tmpdir(), `skillet-opencode-${randomBytes(4).toString("hex")}`);
    await mkdir(tmpBase, { recursive: true });
    adapter = createAdapter(tmpBase);
  });

  afterEach(async () => {
    await rm(tmpBase, { recursive: true, force: true });
  });

  it("adapter name is 'opencode'", () => {
    expect(adapter.name).toBe("opencode");
  });

  it("kind is undefined (global default)", () => {
    expect(adapter.kind).toBeUndefined();
  });

  it("targetDir matches the baseDir passed to createAdapter", () => {
    expect(adapter.targetDir).toBe(tmpBase);
  });

  it("targetPath returns <baseDir>/<owner>--<slug>/SKILL.md when owner is given", () => {
    const p = adapter.targetPath("my-skill", { owner: "@taylor" });
    expect(p).toBe(join(tmpBase, "@taylor--my-skill", "SKILL.md"));
  });

  it("targetPath uses the _local-- prefix when owner is absent", () => {
    const p = adapter.targetPath("my-skill");
    expect(p).toBe(join(tmpBase, "_local--my-skill", "SKILL.md"));
  });

  it("targetPath rejects unsafe slugs", () => {
    expect(() => adapter.targetPath("../evil")).toThrow(/Unsafe skill slug rejected/);
    expect(() => adapter.targetPath("foo/bar")).toThrow(/Unsafe skill slug rejected/);
  });

  it("sync contract: materialize writes the full bundle tree", async () => {
    const content = "---\nname: Test\n---\n\nHello from opencode.\n";
    const refMd = "Reference text.\n";
    const written = await adapter.materialize(
      "test-skill",
      bundle({ "SKILL.md": content, "references/policy.md": refMd }),
      { owner: "@alice" },
    );

    const skillRoot = join(tmpBase, "@alice--test-skill");
    expect(written).toEqual([
      join(skillRoot, "SKILL.md"),
      join(skillRoot, "references", "policy.md"),
    ]);
    expect(await readFile(join(skillRoot, "SKILL.md"), "utf8")).toBe(content);
    expect(await readFile(join(skillRoot, "references", "policy.md"), "utf8")).toBe(refMd);
  });

  it("sync contract: materialize preserves arbitrary depth", async () => {
    const written = await adapter.materialize(
      "deep",
      bundle({
        "SKILL.md": "x",
        "scripts/lib/util/format.py": "print(1)\n",
      }),
    );
    expect(written).toContain(
      join(tmpBase, "_local--deep", "scripts", "lib", "util", "format.py"),
    );
  });

  it("sync contract: materialize writes binary files exactly", async () => {
    const bytes = Buffer.from([0xff, 0x00, 0x80, 0x7f, 0x01]);
    const written = await adapter.materialize(
      "bin",
      bundle({ "SKILL.md": "x", "references/policy.pdf": bytes }),
    );
    expect(written.length).toBe(2);
    const onDisk = await readFile(
      join(tmpBase, "_local--bin", "references", "policy.pdf"),
    );
    expect(onDisk.equals(bytes)).toBe(true);
  });

  it("materialize rejects unsafe slugs", async () => {
    await expect(adapter.materialize("../evil", bundle({ "SKILL.md": "x" }))).rejects.toThrow();
  });

  it("materialize rejects null-byte in slug", async () => {
    await expect(
      adapter.materialize("skill\0evil", bundle({ "SKILL.md": "x" })),
    ).rejects.toThrow(/Null byte rejected/);
  });

  it("materialize rejects path traversal in slug", async () => {
    await expect(
      adapter.materialize("../../etc/passwd", bundle({ "SKILL.md": "x" })),
    ).rejects.toThrow();
  });

  it("materialize overwrites on re-run and leaves no .skillet-backup twin", async () => {
    await adapter.materialize("my-skill", bundle({ "SKILL.md": "original" }));
    await adapter.materialize("my-skill", bundle({ "SKILL.md": "updated" }));
    const dest = join(tmpBase, "_local--my-skill", "SKILL.md");
    expect(await readFile(dest, "utf8")).toBe("updated");
    await expect(readFile(`${dest}.skillet-backup`, "utf8")).rejects.toThrow();
  });

  it("detect returns a boolean", async () => {
    const result = await adapter.detect();
    expect(typeof result).toBe("boolean");
  });
});

// ─── Project adapter ──────────────────────────────────────────────────────────

describe("opencode project adapter contract", () => {
  let tmpProject: string;
  let adapter: ReturnType<typeof createProjectAdapter>;

  beforeEach(async () => {
    tmpProject = join(tmpdir(), `skillet-opencode-proj-${randomBytes(4).toString("hex")}`);
    await mkdir(tmpProject, { recursive: true });
    // Simulate a project root by placing a .git marker
    await mkdir(join(tmpProject, ".git"), { recursive: true });
    adapter = createProjectAdapter();
  });

  afterEach(async () => {
    await rm(tmpProject, { recursive: true, force: true });
  });

  it("adapter name is 'opencode-project'", () => {
    expect(adapter.name).toBe("opencode-project");
  });

  it("kind is 'project'", () => {
    expect(adapter.kind).toBe("project");
  });

  it("targetDir is the relative project path '.agents/skills'", () => {
    expect(adapter.targetDir).toBe(".agents/skills");
  });

  it("projectRoot(cwd) returns join(cwd, '.agents/skills')", () => {
    expect(adapter.projectRoot!("/some/project")).toBe(join("/some/project", ".agents", "skills"));
  });

  it("detect returns a boolean", async () => {
    const result = await adapter.detect();
    expect(typeof result).toBe("boolean");
  });

  it("project mode writes to <projectRoot>/.agents/skills/<owner>--<slug>/SKILL.md", async () => {
    const content = "---\nname: Proj\n---\n\nProject skill.\n";
    const written = await adapter.materialize(
      "proj-skill",
      bundle({ "SKILL.md": content }),
      { owner: "@bob", cwd: tmpProject },
    );

    const absRoot = join(tmpProject, ".agents", "skills");
    const skillRoot = join(absRoot, "@bob--proj-skill");
    expect(written).toEqual([join(skillRoot, "SKILL.md")]);
    expect(await readFile(join(skillRoot, "SKILL.md"), "utf8")).toBe(content);
  });

  it("project mode writes the full bundle tree", async () => {
    const content = "---\nname: Full\n---\n\nFull bundle.\n";
    const refMd = "Reference.\n";
    const written = await adapter.materialize(
      "full-skill",
      bundle({ "SKILL.md": content, "references/guide.md": refMd }),
      { owner: "@carol", cwd: tmpProject },
    );

    const absRoot = join(tmpProject, ".agents", "skills", "@carol--full-skill");
    expect(written).toEqual([
      join(absRoot, "SKILL.md"),
      join(absRoot, "references", "guide.md"),
    ]);
    expect(await readFile(join(absRoot, "references", "guide.md"), "utf8")).toBe(refMd);
  });

  it("project mode uses _local-- prefix when owner is absent", async () => {
    const written = await adapter.materialize(
      "local-skill",
      bundle({ "SKILL.md": "x" }),
      { cwd: tmpProject },
    );
    expect(written[0]).toBe(join(tmpProject, ".agents", "skills", "_local--local-skill", "SKILL.md"));
  });

  it("project mode rejects unsafe slugs", async () => {
    await expect(
      adapter.materialize("../evil", bundle({ "SKILL.md": "x" }), { cwd: tmpProject }),
    ).rejects.toThrow(/Unsafe skill slug rejected/);
  });

  it("project mode rejects null-byte in slug", async () => {
    await expect(
      adapter.materialize("skill\0evil", bundle({ "SKILL.md": "x" }), { cwd: tmpProject }),
    ).rejects.toThrow(/Null byte rejected/);
  });

  it("project mode rejects path traversal in slug", async () => {
    await expect(
      adapter.materialize("../../etc/passwd", bundle({ "SKILL.md": "x" }), { cwd: tmpProject }),
    ).rejects.toThrow();
  });

  it("project mode overwrites on re-run and leaves no .skillet-backup twin", async () => {
    await adapter.materialize("my-skill", bundle({ "SKILL.md": "original" }), { cwd: tmpProject });
    await adapter.materialize("my-skill", bundle({ "SKILL.md": "updated" }), { cwd: tmpProject });
    const dest = join(tmpProject, ".agents", "skills", "_local--my-skill", "SKILL.md");
    expect(await readFile(dest, "utf8")).toBe("updated");
    await expect(readFile(`${dest}.skillet-backup`, "utf8")).rejects.toThrow();
  });

  it("project mode is idempotent (re-run with same content does not error)", async () => {
    const content = "---\nname: Idem\n---\n\nIdempotent.\n";
    await adapter.materialize("idem-skill", bundle({ "SKILL.md": content }), { cwd: tmpProject });
    await expect(
      adapter.materialize("idem-skill", bundle({ "SKILL.md": content }), { cwd: tmpProject }),
    ).resolves.toBeDefined();
  });

  it("project mode declines when there is no project root", async () => {
    const orphan = await mkdtemp(join(tmpdir(), "skillet-orphan-"));
    try {
      // Two different refusals, both correct, and which one you get depends on
      // where tmpdir lives:
      //   - "No project root found"          — the walk found no marker at all
      //   - "No project-specific root found" — it climbed into the HOME dir and
      //     hit the global .agents, so materialize declines and hands off to the
      //     global adapter (src/index.ts guard)
      // On Windows tmpdir is inside the home dir, so a real ~/.agents makes the
      // second one fire. Assert the behavior — project mode refuses — not which
      // sentence it refuses with.
      await expect(
        adapter.materialize("my-skill", bundle({ "SKILL.md": "x" }), { cwd: orphan }),
      ).rejects.toThrow(/No project(-specific)? root found/);
    } finally {
      await rm(orphan, { recursive: true, force: true });
    }
  });

  it("targetPath returns <cwd>/.agents/skills/<owner>--<slug>/SKILL.md", () => {
    const p = adapter.targetPath("test-skill", { owner: "@dave", cwd: "/my/project" });
    expect(p).toBe(join("/my/project", ".agents", "skills", "@dave--test-skill", "SKILL.md"));
  });

  it("targetPath uses _local-- when owner is absent", () => {
    const p = adapter.targetPath("test-skill", { cwd: "/my/project" });
    expect(p).toBe(join("/my/project", ".agents", "skills", "_local--test-skill", "SKILL.md"));
  });

  it("targetPath rejects unsafe slugs", () => {
    expect(() => adapter.targetPath("../evil", { cwd: "/my/project" })).toThrow(
      /Unsafe skill slug rejected/,
    );
  });

  it("targetSkillDir returns <cwd>/.agents/skills/<owner>--<slug>", () => {
    const p = adapter.targetSkillDir("test-skill", { owner: "@dave", cwd: "/my/project" });
    expect(p).toBe(join("/my/project", ".agents", "skills", "@dave--test-skill"));
  });
});

// ─── findProjectRoot ─────────────────────────────────────────────────────────

describe("findProjectRoot", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = join(tmpdir(), `skillet-root-${randomBytes(4).toString("hex")}`);
    await mkdir(tmpRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it("finds a directory with .git/", async () => {
    await mkdir(join(tmpRoot, ".git"));
    const found = await findProjectRoot(tmpRoot);
    expect(found).toBe(tmpRoot);
  });

  it("finds a directory with .opencode/ (opencode project marker)", async () => {
    await mkdir(join(tmpRoot, ".opencode"));
    const found = await findProjectRoot(tmpRoot);
    expect(found).toBe(tmpRoot);
  });

  it("finds a directory with .agents/", async () => {
    await mkdir(join(tmpRoot, ".agents"));
    const found = await findProjectRoot(tmpRoot);
    expect(found).toBe(tmpRoot);
  });

  it("does NOT treat a bare package.json as a project root", async () => {
    // opencode keys project scope on the repo root — a Node package with no
    // git/opencode/agents dir is global-scoped, not project-scoped.
    await writeFile(join(tmpRoot, "package.json"), "{}");
    // Bound the walk at the fixture. Unbounded it climbs past tmpdir, and on
    // Windows tmpdir sits INSIDE the home dir, so it finds the user's real
    // ~/.agents and answers with the home directory instead of null.
    const found = await findProjectRoot(tmpRoot, tmpRoot);
    expect(found).toBeNull();
  });

  it("walks up to find a marker in a parent directory", async () => {
    await mkdir(join(tmpRoot, ".git"));
    const sub = join(tmpRoot, "src", "lib");
    await mkdir(sub, { recursive: true });
    const found = await findProjectRoot(sub);
    expect(found).toBe(tmpRoot);
  });

  it("returns string or null when no marker is found", async () => {
    const noMarker = join(tmpdir(), `skillet-nomarker-${randomBytes(4).toString("hex")}`);
    await mkdir(noMarker, { recursive: true });
    try {
      const result = await findProjectRoot(noMarker);
      expect(result === null || typeof result === "string").toBe(true);
    } finally {
      await rm(noMarker, { recursive: true, force: true });
    }
  });
});
