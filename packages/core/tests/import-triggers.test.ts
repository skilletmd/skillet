/**
 * `triggers:` schema enforcement at the import boundary.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

async function writeSkillDir(root: string, name: string, content: string): Promise<string> {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), content, "utf8");
  return dir;
}

describe.sequential("import: triggers schema enforcement", () => {
  let skilletDir: string;
  let srcDir: string;

  beforeEach(async () => {
    skilletDir = await mkdtemp(join(tmpdir(), "skillet-imp-home-"));
    srcDir = await mkdtemp(join(tmpdir(), "skillet-imp-src-"));
    process.env["SKILLET_DIR"] = skilletDir;
    vi.resetModules();
  });

  afterEach(async () => {
    await rm(skilletDir, { recursive: true, force: true });
    await rm(srcDir, { recursive: true, force: true });
    delete process.env["SKILLET_DIR"];
  });

  it("rejects a malformed triggers block at import", async () => {
    const { importSkill } = await import("../src/commands/import.js");
    const dir = await writeSkillDir(
      srcDir,
      "bad",
      `---
name: bad-triggers
description: bad triggers shape.
triggers: not-an-array
---

# bad-triggers
`,
    );

    await expect(importSkill(dir)).rejects.toMatchObject({
      name: "TriggersError",
      message: /must be an array/,
    });
  });

  it("imports a skill with well-formed triggers", async () => {
    const { importSkill } = await import("../src/commands/import.js");
    const dir = await writeSkillDir(
      srcDir,
      "good",
      `---
name: good-triggers
description: good triggers.
triggers:
  - user asks about deploy
---

# good-triggers
`,
    );

    const entry = await importSkill(dir);
    expect(entry.slug).toBe("good-triggers");
  });
});
