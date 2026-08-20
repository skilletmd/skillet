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

describe("hermes adapter contract", () => {
  let tmpBase: string;
  let adapter: ReturnType<typeof createAdapter>;

  beforeEach(async () => {
    tmpBase = join(tmpdir(), `skillet-hermes-${randomBytes(4).toString("hex")}`);
    await mkdir(tmpBase, { recursive: true });
    adapter = createAdapter(tmpBase);
  });

  afterEach(async () => {
    await rm(tmpBase, { recursive: true, force: true });
  });

  it("adapter name is 'hermes'", () => {
    expect(adapter.name).toBe("hermes");
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
});
