import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@skillet/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@skillet/core")>();
  return { ...actual, validateMaterializationPath: vi.fn() };
});
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { createAdapter } from "../src/index.js";

function bundle(entries: Record<string, string | Buffer>): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  for (const [k, v] of Object.entries(entries)) {
    out.set(k, typeof v === "string" ? Buffer.from(v, "utf8") : v);
  }
  return out;
}

describe("openclaw adapter contract", () => {
  let tmpBase: string;
  let adapter: ReturnType<typeof createAdapter>;

  beforeEach(async () => {
    tmpBase = join(tmpdir(), `skillet-openclaw-${randomBytes(4).toString("hex")}`);
    await mkdir(tmpBase, { recursive: true });
    adapter = createAdapter(tmpBase);
  });

  afterEach(async () => {
    await rm(tmpBase, { recursive: true, force: true });
  });

  it("adapter name is 'openclaw'", () => {
    expect(adapter.name).toBe("openclaw");
  });

  it("targetDir matches the baseDir passed to createAdapter", () => {
    expect(adapter.targetDir).toBe(tmpBase);
  });

  it("targetPath returns <baseDir>/<owner>--<slug>/SKILL.md when owner is given", () => {
    expect(adapter.targetPath("my-skill", { owner: "@taylor" })).toBe(
      join(tmpBase, "@taylor--my-skill", "SKILL.md"),
    );
  });

  it("targetPath uses the _local-- prefix when owner is absent", () => {
    expect(adapter.targetPath("my-skill")).toBe(join(tmpBase, "_local--my-skill", "SKILL.md"));
  });

  it("targetPath rejects unsafe slugs", () => {
    expect(() => adapter.targetPath("../evil")).toThrow(/Unsafe skill slug rejected/);
    expect(() => adapter.targetPath("foo/bar")).toThrow(/Unsafe skill slug rejected/);
  });

  it("sync contract: materialize writes the full bundle tree", async () => {
    const content = "---\nname: Test\n---\n";
    const written = await adapter.materialize(
      "test-skill",
      bundle({ "SKILL.md": content, "references/p.md": "ref" }),
      { owner: "@alice" },
    );
    const root = join(tmpBase, "@alice--test-skill");
    expect(written).toEqual([join(root, "SKILL.md"), join(root, "references", "p.md")]);
    expect(await readFile(join(root, "SKILL.md"), "utf8")).toBe(content);
  });

  it("sync contract: materialize preserves binary bytes", async () => {
    const bytes = Buffer.from([0xff, 0x00, 0x80]);
    await adapter.materialize(
      "bin",
      bundle({ "SKILL.md": "x", "references/p.pdf": bytes }),
    );
    const onDisk = await readFile(join(tmpBase, "_local--bin", "references", "p.pdf"));
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

  it("materialize overwrites on re-run and leaves no .skillet-backup twin", async () => {
    await adapter.materialize("my-skill", bundle({ "SKILL.md": "original" }));
    await adapter.materialize("my-skill", bundle({ "SKILL.md": "updated" }));
    const dest = join(tmpBase, "_local--my-skill", "SKILL.md");
    expect(await readFile(dest, "utf8")).toBe("updated");
    await expect(readFile(`${dest}.skillet-backup`, "utf8")).rejects.toThrow();
  });

  it("detect returns a boolean", async () => {
    expect(typeof (await adapter.detect())).toBe("boolean");
  });

  describe("findShadows (workspace-shadowing detection)", () => {
    it("returns [] when no higher-precedence skill exists", async () => {
      const ws = join(tmpdir(), `skillet-openclaw-ws-${randomBytes(4).toString("hex")}`);
      await mkdir(ws, { recursive: true });
      try {
        const findings = await adapter.findShadows!("test-skill", {
          owner: "@alice",
          workspaceDir: ws,
        });
        expect(findings).toEqual([]);
      } finally {
        await rm(ws, { recursive: true, force: true });
      }
    });

    it("flags <workspace>/skills as a shadow when a same-slug SKILL.md exists there", async () => {
      const ws = join(tmpdir(), `skillet-openclaw-ws-${randomBytes(4).toString("hex")}`);
      const skillDir = join(ws, "skills", "@alice--shadowed");
      await mkdir(skillDir, { recursive: true });
      const shadowPath = join(skillDir, "SKILL.md");
      await writeFile(shadowPath, "shadow", "utf8");
      try {
        const findings = await adapter.findShadows!("shadowed", {
          owner: "@alice",
          workspaceDir: ws,
        });
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({
          path: shadowPath,
          location: "<workspace>/skills",
        });
      } finally {
        await rm(ws, { recursive: true, force: true });
      }
    });

    it("flags <workspace>/.agents/skills as a shadow when a same-slug SKILL.md exists there", async () => {
      const ws = join(tmpdir(), `skillet-openclaw-ws-${randomBytes(4).toString("hex")}`);
      const skillDir = join(ws, ".agents", "skills", "_local--shadowed");
      await mkdir(skillDir, { recursive: true });
      const shadowPath = join(skillDir, "SKILL.md");
      await writeFile(shadowPath, "shadow", "utf8");
      try {
        const findings = await adapter.findShadows!("shadowed", { workspaceDir: ws });
        expect(findings).toHaveLength(1);
        expect(findings[0]?.location).toBe("<workspace>/.agents/skills");
        expect(findings[0]?.path).toBe(shadowPath);
      } finally {
        await rm(ws, { recursive: true, force: true });
      }
    });

    it("returns multiple findings when more than one higher-precedence dir shadows", async () => {
      const ws = join(tmpdir(), `skillet-openclaw-ws-${randomBytes(4).toString("hex")}`);
      const dir1 = join(ws, "skills", "_local--shadowed");
      const dir2 = join(ws, ".agents", "skills", "_local--shadowed");
      await mkdir(dir1, { recursive: true });
      await mkdir(dir2, { recursive: true });
      await writeFile(join(dir1, "SKILL.md"), "a", "utf8");
      await writeFile(join(dir2, "SKILL.md"), "b", "utf8");
      try {
        const findings = await adapter.findShadows!("shadowed", { workspaceDir: ws });
        const locations = findings.map((f) => f.location).sort();
        expect(locations).toEqual([
          "<workspace>/.agents/skills",
          "<workspace>/skills",
        ]);
      } finally {
        await rm(ws, { recursive: true, force: true });
      }
    });

    it("does not flag a workspace skill with a different owner prefix", async () => {
      const ws = join(tmpdir(), `skillet-openclaw-ws-${randomBytes(4).toString("hex")}`);
      // Skillet would sync @alice--shadowed; a @bob--shadowed copy lives elsewhere
      // and is a different skill, not a shadow.
      const other = join(ws, "skills", "@bob--shadowed");
      await mkdir(other, { recursive: true });
      await writeFile(join(other, "SKILL.md"), "x", "utf8");
      try {
        const findings = await adapter.findShadows!("shadowed", {
          owner: "@alice",
          workspaceDir: ws,
        });
        expect(findings).toEqual([]);
      } finally {
        await rm(ws, { recursive: true, force: true });
      }
    });

    it("rejects unsafe slugs (no fs probe on path-escape input)", async () => {
      await expect(
        adapter.findShadows!("../evil", { workspaceDir: tmpBase }),
      ).rejects.toThrow(/Unsafe skill slug rejected/);
    });

    it("works with workspaceDir omitted (only checks ~/.agents/skills)", async () => {
      // No workspace context means we cannot construct workspace paths, so we
      // should only consult the HOME-level fallback. The test environment's
      // ~/.agents/skills typically does not exist, so we expect an empty list
      // — and crucially, no throw.
      const findings = await adapter.findShadows!("nonexistent-skill-xyz");
      expect(Array.isArray(findings)).toBe(true);
    });
  });
});
