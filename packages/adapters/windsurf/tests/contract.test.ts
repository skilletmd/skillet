import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@skillet/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@skillet/core")>();
  return { ...actual, validateMaterializationPath: vi.fn() };
});
import { mkdir, readFile, rm } from "node:fs/promises";
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

// Devin Desktop (né Windsurf) is a native SKILL.md runtime as of the June 2026
// rebrand: a global skills-folder materializer, no longer the .windsurf/rules
// project writer. baseDir override bypasses the ~/.codeium/windsurf root-exists
// guard so tests write into a temp dir.
describe("windsurf/Devin Desktop adapter contract (global skills folder)", () => {
  let tmpBase: string;
  let adapter: ReturnType<typeof createAdapter>;

  beforeEach(async () => {
    tmpBase = join(tmpdir(), `skillet-windsurf-${randomBytes(4).toString("hex")}`);
    await mkdir(tmpBase, { recursive: true });
    adapter = createAdapter(tmpBase);
  });

  afterEach(async () => {
    await rm(tmpBase, { recursive: true, force: true });
  });

  it("adapter name stays 'windsurf' (wire contract) despite the Devin Desktop label", () => {
    expect(adapter.name).toBe("windsurf");
  });

  it("is a global adapter, not project-scoped", () => {
    expect(adapter.kind).toBeUndefined();
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

  it("materialize writes the full SKILL.md bundle tree (native format, not rules files)", async () => {
    const content = "---\nname: Test\ndescription: d\n---\nbody";
    const written = await adapter.materialize(
      "test-skill",
      bundle({ "SKILL.md": content, "references/p.md": "ref" }),
      { owner: "@alice" },
    );
    const root = join(tmpBase, "@alice--test-skill");
    expect(written).toEqual([join(root, "SKILL.md"), join(root, "references", "p.md")]);
    // Frontmatter is preserved verbatim — no stripping, no comment header.
    expect(await readFile(join(root, "SKILL.md"), "utf8")).toBe(content);
  });

  it("materialize preserves nested .mdc and binary bytes verbatim", async () => {
    const bytes = Buffer.from([0xff, 0x00, 0x80]);
    await adapter.materialize(
      "bin",
      bundle({ "SKILL.md": "x", "rules/workers.mdc": "rule", "assets/p.pdf": bytes }),
    );
    expect(await readFile(join(tmpBase, "_local--bin", "rules", "workers.mdc"), "utf8")).toBe("rule");
    const onDisk = await readFile(join(tmpBase, "_local--bin", "assets", "p.pdf"));
    expect(onDisk.equals(bytes)).toBe(true);
  });

  it("materialize rejects unsafe slugs", async () => {
    await expect(adapter.materialize("../evil", bundle({ "SKILL.md": "x" }))).rejects.toThrow();
  });

  it("materialize overwrites on re-run, no .skillet-backup twin", async () => {
    await adapter.materialize("my-skill", bundle({ "SKILL.md": "original" }));
    await adapter.materialize("my-skill", bundle({ "SKILL.md": "updated" }));
    const dest = join(tmpBase, "_local--my-skill", "SKILL.md");
    expect(await readFile(dest, "utf8")).toBe("updated");
    await expect(readFile(`${dest}.skillet-backup`, "utf8")).rejects.toThrow();
  });

  it("detect returns a boolean", async () => {
    expect(typeof (await adapter.detect())).toBe("boolean");
  });
});
