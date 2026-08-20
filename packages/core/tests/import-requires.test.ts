/**
 * `requires:` schema enforcement at the import boundary.
 *
 * A malformed `requires` block must be rejected by importSkill (no kit entry
 * written); a well-formed one imports cleanly. selfRef is omitted at import —
 * the skill has no minted @author/slug ref yet — so a bare skill dep that would
 * be a self-dependency at publish is still accepted here.
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

describe.sequential("import: requires schema enforcement", () => {
  let skilletDir: string;
  let srcDir: string;

  beforeEach(async () => {
    skilletDir = await mkdtemp(join(tmpdir(), "skillet-imp-home-"));
    srcDir = await mkdtemp(join(tmpdir(), "skillet-imp-src-"));
    // The kit store keys isolation off SKILLET_DIR (see src/kit/store.ts); this
    // must match it exactly, or every test here writes into the real ~/.skillet
    // and the malformed-import assertion sees a sibling test's leftover skill.
    process.env["SKILLET_DIR"] = skilletDir;
    vi.resetModules();
  });

  afterEach(async () => {
    await rm(skilletDir, { recursive: true, force: true });
    await rm(srcDir, { recursive: true, force: true });
    delete process.env["SKILLET_DIR"];
  });

  it("rejects a malformed requires block at import", async () => {
    const { importSkill } = await import("../src/commands/import.js");
    const { readState } = await import("../src/kit/store.js");
    const dir = await writeSkillDir(
      srcDir,
      "bad",
      `---
name: bad-import
description: malformed requires.
requires:
  - skill: not-a-canonical-ref
---

# bad-import
`
    );

    await expect(importSkill(dir)).rejects.toMatchObject({
      name: "RequiresError",
      message: /canonical @author\/slug ref/,
    });

    // Nothing was written into the kit.
    const state = await readState();
    expect(Object.keys(state.skills)).toHaveLength(0);
  });

  it("imports a skill with a well-formed requires block", async () => {
    const { importSkill } = await import("../src/commands/import.js");
    const dir = await writeSkillDir(
      srcDir,
      "good",
      `---
name: good-import
description: well-formed requires.
requires:
  - skill: "@alice/helper"
    version: ">=2"
    optional: true
---

# good-import
`
    );

    const entry = await importSkill(dir);
    expect(entry.slug).toBe("good-import");
  });
});
