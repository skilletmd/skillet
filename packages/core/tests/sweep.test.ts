// U12 — adapter-deprecation orphan sweep. Moves Skillet-managed skill folders
// under an arbitrary root to the restorable trash; foreign files are untouched.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, mkdtemp, writeFile, rm, stat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { sweepOrphans, restoreTrash } from "../src/commands/restore.js";

let home: string; // SKILLET_DIR (trash root)
let runtime: string; // a (now-deprecated) runtime's skills root

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function writeSkillDir(parent: string, name: string): Promise<void> {
  await mkdir(join(parent, name), { recursive: true });
  await writeFile(join(parent, name, "SKILL.md"), `---\nname: ${name}\ndescription: x\n---\n# ${name}\n`);
}

describe("sweepOrphans", () => {
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "skillet-home-"));
    runtime = await mkdtemp(join(tmpdir(), "skillet-runtime-"));
    process.env["SKILLET_DIR"] = home;
    process.env["SKILLET_SKILL_ROOTS"] = runtime; // allow restoring back to this root
  });
  afterEach(async () => {
    delete process.env["SKILLET_DIR"];
    delete process.env["SKILLET_SKILL_ROOTS"];
    await rm(home, { recursive: true, force: true });
    await rm(runtime, { recursive: true, force: true });
  });

  it("leaves a name-matching dir that has no SKILL.md (not a real bundle)", async () => {
    // e.g. an unrelated `react--router` clone — matches the name pattern but is
    // not a Skillet bundle, so it must NOT be swept.
    await mkdir(join(runtime, "react--router"), { recursive: true });
    await writeFile(join(runtime, "react--router", "package.json"), "{}");
    await writeSkillDir(runtime, "alice--real"); // a genuine bundle

    const res = await sweepOrphans(runtime);
    expect(res.trashed).toEqual(["alice--real"]);
    expect(await exists(join(runtime, "react--router"))).toBe(true); // untouched
  });

  it("trashes Skillet-managed dirs, leaves foreign files untouched", async () => {
    await writeSkillDir(runtime, "alice--foo"); // managed (owner--slug)
    await writeSkillDir(runtime, "_local--bar"); // managed (local)
    await mkdir(join(runtime, "not-skillet"), { recursive: true }); // foreign
    await writeFile(join(runtime, "README.md"), "hi"); // foreign file

    const res = await sweepOrphans(runtime);

    expect(res.trashed.sort()).toEqual(["_local--bar", "alice--foo"]);
    expect(res.trashDir).toBeTruthy();
    // managed dirs moved out
    expect(await exists(join(runtime, "alice--foo"))).toBe(false);
    expect(await exists(join(runtime, "_local--bar"))).toBe(false);
    // foreign untouched
    expect(await exists(join(runtime, "not-skillet"))).toBe(true);
    expect(await exists(join(runtime, "README.md"))).toBe(true);
    // a restorable ledger was written
    const ledger = JSON.parse(await readFile(join(res.trashDir!, "manifest.json"), "utf8"));
    expect(ledger.items.map((i: { slug: string }) => i.slug).sort()).toEqual(["_local--bar", "alice--foo"]);
  });

  it("swept folders are restorable", async () => {
    await writeSkillDir(runtime, "alice--foo");
    const res = await sweepOrphans(runtime);
    expect(res.trashDir).toBeTruthy();

    await restoreTrash(basename(res.trashDir!));
    expect(await exists(join(runtime, "alice--foo", "SKILL.md"))).toBe(true);
  });

  it("is a no-op on an empty or absent root", async () => {
    expect(await sweepOrphans(join(runtime, "nope"))).toEqual({ trashed: [], trashDir: null });
    expect(await sweepOrphans(runtime)).toEqual({ trashed: [], trashDir: null });
  });
});
