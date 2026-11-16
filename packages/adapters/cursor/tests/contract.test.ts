/**
 * Cursor adapter contract tests.
 *
 * Cursor is a baseline reader: it loads the universal `.agents/skills` folders
 * the Codex baseline writes, so this adapter detects and labels Cursor and
 * shares the baseline layout. The old `.cursor/rules/*.mdc` writer is gone; its
 * leftovers are swept by `cleanupLegacyCursorRules` in @skillet/core.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// validateMaterializationPath is tested in packages/core/tests/pathsafe.test.ts.
// Adapter tests use temp dirs for isolation; mock it so a temp root is accepted.
vi.mock("@skillet/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@skillet/core")>();
  return {
    ...actual,
    validateMaterializationPath: vi.fn(),
  };
});
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { createAdapter, cursorAdapter } from "../src/index.js";

function bundle(entries: Record<string, string | Buffer>): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  for (const [k, v] of Object.entries(entries)) {
    out.set(k, typeof v === "string" ? Buffer.from(v, "utf8") : v);
  }
  return out;
}

const SKILL_MD = "---\nname: my-skill\ndescription: Does something useful\n---\n\n# heading\n\nbody text.\n";

describe("cursor adapter contract", () => {
  let tmpBase: string;
  let adapter: ReturnType<typeof createAdapter>;

  beforeEach(async () => {
    tmpBase = join(tmpdir(), `skillet-cursor-${randomBytes(4).toString("hex")}`);
    await mkdir(tmpBase, { recursive: true });
    adapter = createAdapter(tmpBase);
  });

  afterEach(async () => {
    await rm(tmpBase, { recursive: true, force: true });
  });

  it("adapter name is 'cursor'", () => {
    expect(adapter.name).toBe("cursor");
  });

  it("kind is undefined (global default): no per-project writer any more", () => {
    expect(adapter.kind).toBeUndefined();
    expect(adapter.projectRoot).toBeUndefined();
    expect(adapter.transform).toBeUndefined();
  });

  it("the shipped adapter shares the universal ~/.agents/skills root Cursor reads", () => {
    expect(cursorAdapter.targetDir).toBe(join(homedir(), ".agents", "skills"));
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

  it("targetSkillDir returns <baseDir>/<prefix>", () => {
    expect(adapter.targetSkillDir("my-skill", { owner: "@taylor" })).toBe(
      join(tmpBase, "@taylor--my-skill"),
    );
  });

  it("targetPath rejects unsafe slugs", () => {
    expect(() => adapter.targetPath("../evil")).toThrow(/Unsafe skill slug rejected/);
    expect(() => adapter.targetPath("foo/bar")).toThrow(/Unsafe skill slug rejected/);
  });

  it("materialize writes the bundle byte for byte as a SKILL.md folder, no .mdc", async () => {
    const written = await adapter.materialize(
      "my-skill",
      bundle({ "SKILL.md": SKILL_MD, "references/policy.md": "Reference text.\n" }),
      { owner: "@alice" },
    );
    const skillRoot = join(tmpBase, "@alice--my-skill");
    expect(written).toEqual([
      join(skillRoot, "SKILL.md"),
      join(skillRoot, "references", "policy.md"),
    ]);
    expect(await readFile(join(skillRoot, "SKILL.md"), "utf8")).toBe(SKILL_MD);
    expect(written.some((p) => p.endsWith(".mdc"))).toBe(false);
  });

  it("materialize preserves binary files exactly", async () => {
    const bytes = Buffer.from([0xff, 0x00, 0x80, 0x7f, 0x01]);
    await adapter.materialize(
      "bin",
      bundle({ "SKILL.md": SKILL_MD, "references/img.png": bytes }),
      { owner: "@alice" },
    );
    const onDisk = await readFile(join(tmpBase, "@alice--bin", "references", "img.png"));
    expect(onDisk.equals(bytes)).toBe(true);
  });

  it("materialize overwrites on re-run and leaves no .skillet-backup twin", async () => {
    await adapter.materialize("my-skill", bundle({ "SKILL.md": "v1" }));
    await adapter.materialize("my-skill", bundle({ "SKILL.md": "v2" }));
    const dest = join(tmpBase, "_local--my-skill", "SKILL.md");
    expect(await readFile(dest, "utf8")).toBe("v2");
    await expect(readFile(`${dest}.skillet-backup`, "utf8")).rejects.toThrow();
  });

  it("materialize rejects path-escape and null bytes in the slug", async () => {
    await expect(
      adapter.materialize("../evil", bundle({ "SKILL.md": SKILL_MD })),
    ).rejects.toThrow(/Unsafe skill slug rejected/);
    await expect(
      adapter.materialize("skill\0evil", bundle({ "SKILL.md": SKILL_MD })),
    ).rejects.toThrow(/Null byte rejected/);
  });

  it("detect returns a boolean", async () => {
    expect(typeof (await adapter.detect())).toBe("boolean");
  });
});
