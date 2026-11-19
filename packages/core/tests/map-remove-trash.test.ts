/**
 * The kit map's Remove trash and its restore (plan U11, KTD8; R7 R19).
 *
 * HOME and SKILLET_DIR point into a throwaway folder before core loads, so the
 * compile-time allowlist is built from the fixture home and nothing here can
 * touch a real skills folder or ~/.skillet. Each test starts from an empty home.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { existsSync, lstatSync, readFileSync, readlinkSync } from "node:fs";
import { mkdir, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { symlinksAvailable } from "./symlink-support.js";

const HOME = vi.hoisted(() => {
  const { redirectHome } = require("./helpers/redirect-home.cjs");
  return redirectHome("skillet-map-trash") as string;
});

import { listMapTrash, mapTrashRoot, trashMapFolders, type MapTrashTarget } from "../src/map/remove-trash.js";
import { clearOldTrash, listTrash, restoreTrash } from "../src/commands/restore.js";
import { MAP_FOLDER_ROOT_ALLOWLIST, MATERIALIZATION_ROOT_ALLOWLIST, mapFolderRootOf } from "../src/util/pathsafe.js";
import { writeState } from "../src/kit/store.js";

const SKILLET = join(HOME, ".skillet");
const CLAUDE = join(HOME, ".claude", "skills");
const AGENTS = join(HOME, ".agents", "skills");
const CODEX = join(HOME, ".codex", "skills");
const KEY = `sha256:${"a".repeat(64)}`;
const DAY = 86_400_000;

async function writeSkill(dir: string, name: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${name} helper\n---\n\n# ${name}\n`);
}

function target(path: string, name = "notes", key = KEY): MapTrashTarget {
  return { key, name, source: "local", path };
}

/** A map-trash run written by hand, as a planted or older ledger would be. */
async function stageMapRun(stamp: string, trashedAt: string, items: Array<Record<string, unknown>>): Promise<string> {
  const runDir = join(SKILLET, "map-trash", stamp);
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, "manifest.json"), JSON.stringify({ trashedAt, kind: "map-remove", items }, null, 2));
  return runDir;
}

beforeEach(async () => {
  await rm(HOME, { recursive: true, force: true });
  await mkdir(HOME, { recursive: true });
});

describe("the allowlist", () => {
  it("the map's roots add ~/.codex/skills; sync's materialization roots still leave it out", () => {
    expect(MAP_FOLDER_ROOT_ALLOWLIST).toContain(CODEX);
    expect(MAP_FOLDER_ROOT_ALLOWLIST).toContain(CLAUDE);
    expect(MAP_FOLDER_ROOT_ALLOWLIST).toContain(AGENTS);
    expect(MATERIALIZATION_ROOT_ALLOWLIST).not.toContain(CODEX);
    expect(Object.isFrozen(MAP_FOLDER_ROOT_ALLOWLIST)).toBe(true);
  });

  it("names the root a skill folder sits directly in, and nothing else", () => {
    expect(mapFolderRootOf(join(CODEX, "notes"))).toBe(CODEX);
    expect(mapFolderRootOf(join(CLAUDE, "notes"))).toBe(CLAUDE);
    expect(mapFolderRootOf(join(CLAUDE, "synced", "org", "notes"))).toBeNull();
    expect(mapFolderRootOf(join(HOME, ".ssh", "notes"))).toBeNull();
    expect(mapFolderRootOf(join(CLAUDE, "..", "..", ".ssh"))).toBeNull();
    expect(mapFolderRootOf(join(CLAUDE, ".hidden"))).toBeNull();
    expect(mapFolderRootOf("relative/notes")).toBeNull();
    expect(mapFolderRootOf(CLAUDE)).toBeNull();
  });
});

describe("trashMapFolders", () => {
  it("Remove trashes all three copies of one skill into ~/.skillet/map-trash, never ~/.skillet/trash, and restore puts all three back with the kit store unchanged", async () => {
    for (const root of [CLAUDE, AGENTS, CODEX]) await writeSkill(join(root, "notes"), "notes");
    await writeState({ version: 1, skills: {} });
    const stateBefore = readFileSync(join(SKILLET, "state.json"), "utf8");

    const res = await trashMapFolders([CLAUDE, AGENTS, CODEX].map((root) => target(join(root, "notes"))));

    expect(res.skipped).toEqual([]);
    expect(res.moved.map((m) => m.from)).toEqual([CLAUDE, AGENTS, CODEX].map((root) => join(root, "notes")));
    expect(res.moved.map((m) => m.root)).toEqual([CLAUDE, AGENTS, CODEX]);
    for (const root of [CLAUDE, AGENTS, CODEX]) expect(existsSync(join(root, "notes"))).toBe(false);
    expect(res.runId).not.toBeNull();
    expect(await readdir(mapTrashRoot())).toEqual([res.runId]);
    expect(mapTrashRoot()).toBe(join(SKILLET, "map-trash"));
    expect(existsSync(join(SKILLET, "trash")), "today's prune trash is never used").toBe(false);
    for (const item of res.moved) expect(readFileSync(join(item.to, "SKILL.md"), "utf8")).toContain("name: notes");

    const runs = await listTrash();
    expect(runs).toEqual([expect.objectContaining({ id: res.runId, kind: "map-remove", skills: ["notes"] })]);
    expect(await listMapTrash()).toEqual([expect.objectContaining({ id: res.runId, skills: ["notes"] })]);

    const restored = await restoreTrash();
    expect(restored).toEqual({ runId: res.runId, restored: ["notes"], reimported: [], skipped: [] });
    for (const root of [CLAUDE, AGENTS, CODEX]) {
      expect(readFileSync(join(root, "notes", "SKILL.md"), "utf8")).toContain("name: notes");
    }
    expect(readFileSync(join(SKILLET, "state.json"), "utf8"), "restore never re-imports").toBe(stateBefore);
  });

  it("a removed skill in ~/.codex/skills restores to its path", async () => {
    await writeSkill(join(CODEX, "old-codex"), "old-codex");
    const res = await trashMapFolders([target(join(CODEX, "old-codex"), "old-codex")]);
    expect(res.moved).toHaveLength(1);
    expect(existsSync(join(CODEX, "old-codex"))).toBe(false);

    const restored = await restoreTrash(res.runId!);
    expect(restored?.restored).toEqual(["old-codex"]);
    expect(readFileSync(join(CODEX, "old-codex", "SKILL.md"), "utf8")).toContain("name: old-codex");
  });

  it("restore refuses when a folder now sits at the original path, and keeps the trashed copy", async () => {
    await writeSkill(join(CLAUDE, "notes"), "notes");
    const res = await trashMapFolders([target(join(CLAUDE, "notes"))]);
    await writeSkill(join(CLAUDE, "notes"), "a-new-notes");

    const restored = await restoreTrash(res.runId!);
    expect(restored?.restored).toEqual([]);
    expect(restored?.skipped).toEqual([{ slug: "notes", reason: "destination_exists" }]);
    expect(readFileSync(join(CLAUDE, "notes", "SKILL.md"), "utf8")).toContain("name: a-new-notes");
    expect(existsSync(join(res.moved[0]!.to, "SKILL.md"))).toBe(true);
  });

  it("a folder outside the allowlist is never moved", async () => {
    const outside = join(HOME, "projects", "notes");
    await writeSkill(outside, "notes");
    const res = await trashMapFolders([target(outside)]);
    expect(res.moved).toEqual([]);
    expect(res.skipped).toEqual([{ key: KEY, name: "notes", path: outside, reason: "outside-allowlist" }]);
    expect(res.runId).toBeNull();
    expect(existsSync(join(outside, "SKILL.md"))).toBe(true);
    expect(existsSync(mapTrashRoot())).toBe(false);
  });

  it("a folder already gone is skipped, so a rerun never trashes twice", async () => {
    await writeSkill(join(CLAUDE, "notes"), "notes");
    const first = await trashMapFolders([target(join(CLAUDE, "notes"))]);
    expect(first.moved).toHaveLength(1);

    const again = await trashMapFolders([target(join(CLAUDE, "notes"))]);
    expect(again.moved).toEqual([]);
    expect(again.skipped).toEqual([{ key: KEY, name: "notes", path: join(CLAUDE, "notes"), reason: "missing" }]);
    expect(again.runId).toBeNull();
    expect(await readdir(mapTrashRoot())).toEqual([first.runId]);
  });

  it.skipIf(!symlinksAvailable)("a linked skill folder moves as the link; the folder it points at stays", async () => {
    const real = join(HOME, "dev", "notes");
    await writeSkill(real, "notes");
    await mkdir(CLAUDE, { recursive: true });
    await symlink(real, join(CLAUDE, "notes"), "dir");

    const res = await trashMapFolders([target(join(CLAUDE, "notes"))]);
    expect(res.moved).toHaveLength(1);
    expect(existsSync(join(CLAUDE, "notes"))).toBe(false);
    expect(readFileSync(join(real, "SKILL.md"), "utf8")).toContain("name: notes");
    expect(lstatSync(res.moved[0]!.to).isSymbolicLink()).toBe(true);

    await restoreTrash(res.runId!);
    expect(lstatSync(join(CLAUDE, "notes")).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(CLAUDE, "notes"))).toBe(real);
  });
});

describe("a root spelled through a link", () => {
  it.skipIf(!symlinksAvailable)("a skill found through a linked spelling of an allowed root is recorded and restored under the root's own spelling", async () => {
    await writeSkill(join(CLAUDE, "notes"), "notes");
    const alias = join(HOME, "skills-alias");
    await symlink(CLAUDE, alias, "dir");

    const res = await trashMapFolders([target(join(alias, "notes"))]);
    expect(res.moved).toHaveLength(1);
    expect(res.moved[0]).toMatchObject({ root: CLAUDE, folder: "notes", from: join(CLAUDE, "notes"), path: join(alias, "notes") });
    expect(existsSync(join(CLAUDE, "notes"))).toBe(false);

    const restored = await restoreTrash(res.runId!);
    expect(restored?.restored).toEqual(["notes"]);
    expect(readFileSync(join(CLAUDE, "notes", "SKILL.md"), "utf8")).toContain("name: notes");
  });

  it.skipIf(!symlinksAvailable)("two allowed roots that are one folder: a skill named under both moves once, and neither is a failed move", async () => {
    // ~/.claude/skills -> ~/.agents/skills.
    await writeSkill(join(AGENTS, "notes"), "notes");
    await mkdir(join(HOME, ".claude"), { recursive: true });
    await symlink(AGENTS, CLAUDE, "dir");

    const res = await trashMapFolders([target(join(AGENTS, "notes")), target(join(CLAUDE, "notes"))]);

    expect(res.skipped).toEqual([]);
    expect(res.moved).toHaveLength(1);
    expect(res.moved[0]).toMatchObject({ root: AGENTS, folder: "notes", from: join(AGENTS, "notes"), path: join(AGENTS, "notes") });
    expect(existsSync(join(AGENTS, "notes"))).toBe(false);

    const restored = await restoreTrash(res.runId!);
    expect(restored).toEqual({ runId: res.runId, restored: ["notes"], reimported: [], skipped: [] });
    expect(readFileSync(join(AGENTS, "notes", "SKILL.md"), "utf8")).toContain("name: notes");
  });
});

describe("restoring a map-trash run never trusts its ledger", () => {
  it("a ledger entry whose path points outside the allowlist, such as ~/.ssh, is refused", async () => {
    const stamp = "2026-11-16T10-00-00-000Z-ssh001";
    const runDir = join(SKILLET, "map-trash", stamp);
    const payload = join(runDir, "0", "authorized_keys");
    await writeSkill(payload, "evil");
    const traversal = join(runDir, "1", "x");
    await writeSkill(traversal, "evil");
    await stageMapRun(stamp, new Date().toISOString(), [
      {
        key: KEY,
        name: "planted",
        source: "local",
        root: join(HOME, ".ssh"),
        folder: "authorized_keys",
        from: join(HOME, ".ssh", "authorized_keys"),
        to: payload,
      },
      {
        key: KEY,
        name: "traversal",
        source: "local",
        root: CLAUDE,
        folder: "x",
        from: join(CLAUDE, "..", "..", ".ssh", "x"),
        to: traversal,
      },
    ]);

    const res = await restoreTrash(stamp);
    expect(res?.restored).toEqual([]);
    expect(res?.skipped).toEqual([
      { slug: "planted", reason: "unsafe_destination" },
      { slug: "traversal", reason: "unsafe_destination" },
    ]);
    expect(existsSync(join(HOME, ".ssh"))).toBe(false);
  });

  it("a ledger entry whose trashed copy sits outside its run is refused", async () => {
    const stamp = "2026-11-16T10-00-00-000Z-src001";
    const elsewhere = join(HOME, "elsewhere", "notes");
    await writeSkill(elsewhere, "notes");
    await stageMapRun(stamp, new Date().toISOString(), [
      { key: KEY, name: "notes", source: "local", root: CLAUDE, folder: "notes", from: join(CLAUDE, "notes"), to: elsewhere },
    ]);

    const res = await restoreTrash(stamp);
    expect(res?.skipped).toEqual([{ slug: "notes", reason: "unsafe_source" }]);
    expect(existsSync(join(CLAUDE, "notes"))).toBe(false);
    expect(existsSync(join(elsewhere, "SKILL.md"))).toBe(true);
  });

  it("clearOldTrash leaves a 40-day-old map-remove run untouched, because it never reads ~/.skillet/map-trash", async () => {
    const now = Date.parse("2026-11-16T10:00:00.000Z");
    const old = new Date(now - 40 * DAY).toISOString();
    const mapStamp = "2026-10-07T10-00-00-000Z-map001";
    const mapRun = await stageMapRun(mapStamp, old, [
      { key: KEY, name: "notes", source: "local", root: CLAUDE, folder: "notes", from: join(CLAUDE, "notes"), to: join(SKILLET, "map-trash", mapStamp, "0", "notes") },
    ]);
    await writeSkill(join(mapRun, "0", "notes"), "notes");
    // An old prune run beside it shows the sweep itself still runs.
    const pruneStamp = "2026-10-07T10-00-00-000Z-prn001";
    await mkdir(join(SKILLET, "trash", pruneStamp), { recursive: true });
    await writeFile(join(SKILLET, "trash", pruneStamp, "manifest.json"), JSON.stringify({ trashedAt: old, items: [] }));

    const cleared = await clearOldTrash(30, now);

    expect(cleared).toBe(1);
    expect(existsSync(join(SKILLET, "trash", pruneStamp))).toBe(false);
    expect(existsSync(join(mapRun, "0", "notes", "SKILL.md"))).toBe(true);
    expect(existsSync(join(mapRun, "manifest.json"))).toBe(true);
  });
});
