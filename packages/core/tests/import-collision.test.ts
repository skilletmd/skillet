/**
 * Local import must refuse slug collisions unless force is set.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

async function writeSkillDir(
  root: string,
  name: string,
  skillName: string,
  body = "# skill",
): Promise<string> {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "SKILL.md"),
    `---
name: ${skillName}
description: test skill.
---

${body}
`,
    "utf8",
  );
  return dir;
}

describe.sequential("import: slug collision guard", () => {
  let skilletDir: string;
  let srcDir: string;

  beforeEach(async () => {
    skilletDir = await mkdtemp(join(tmpdir(), "skillet-col-home-"));
    srcDir = await mkdtemp(join(tmpdir(), "skillet-col-src-"));
    process.env["SKILLET_DIR"] = skilletDir;
    vi.resetModules();
  });

  afterEach(async () => {
    await rm(skilletDir, { recursive: true, force: true });
    await rm(srcDir, { recursive: true, force: true });
    delete process.env["SKILLET_DIR"];
  });

  it("imports into an empty slug", async () => {
    const { importSkill } = await import("../src/commands/import.js");
    const dir = await writeSkillDir(srcDir, "first", "collision-skill");
    const entry = await importSkill(dir);
    expect(entry.slug).toBe("collision-skill");
  });

  it("rejects a second import with the same slug", async () => {
    const { importSkill, ImportCollisionError } = await import("../src/commands/import.js");
    const { readState } = await import("../src/kit/store.js");
    const dirA = await writeSkillDir(srcDir, "a", "dup-skill", "# first");
    const dirB = await writeSkillDir(srcDir, "b", "dup-skill", "# second");

    await importSkill(dirA);
    await expect(importSkill(dirB)).rejects.toBeInstanceOf(ImportCollisionError);

    const onDisk = await readFile(
      join(skilletDir, "skills", "dup-skill", "SKILL.md"),
      "utf8",
    );
    expect(onDisk).toContain("# first");
    const state = await readState();
    expect(state.skills["dup-skill"]?.hash).toBeTruthy();
  });

  it("overwrites bundle and state when force is set", async () => {
    const { importSkill } = await import("../src/commands/import.js");
    const { readState } = await import("../src/kit/store.js");
    const dirA = await writeSkillDir(srcDir, "a", "force-skill", "# original");
    const dirB = await writeSkillDir(srcDir, "b", "force-skill", "# replaced");

    const first = await importSkill(dirA);
    const second = await importSkill(dirB, { force: true });
    expect(second.hash).not.toBe(first.hash);

    const onDisk = await readFile(
      join(skilletDir, "skills", "force-skill", "SKILL.md"),
      "utf8",
    );
    expect(onDisk).toContain("# replaced");
    const state = await readState();
    expect(state.skills["force-skill"]?.hash).toBe(second.hash);
  });
});
