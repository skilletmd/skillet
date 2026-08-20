// `skillet restore` + trash auto-clear — round-trips files out of the prune
// trash, never clobbers, idempotent, and ages out only its own old stamp dirs.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, mkdtemp, writeFile, rm, stat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listTrash, restoreTrash, clearOldTrash } from "../src/commands/restore.js";

let home: string; // SKILLET_DIR → trash lives at home/trash
let adapters: string; // a fake adapter root (where skills get restored to)

const STAMP = "2026-06-20T10-00-00-000Z-aaa111";

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Write a valid bundle (importSkill needs frontmatter) at `dir`. */
async function writeBundle(dir: string, name: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: a skill\n---\n# ${name}\n`);
}

/** Stage a trash run: a bundle under trash + a ledger pointing back to `from`. */
async function stageTrashRun(
  stamp: string,
  trashedAt: string,
  items: Array<{ slug: string; owner: string; adapter: string; from: string }>,
): Promise<void> {
  const runDir = join(home, "trash", stamp);
  const ledgerItems = [];
  for (const it of items) {
    const to = join(runDir, it.adapter, `${it.owner}--${it.slug.split("/")[1]}`);
    await writeBundle(to, it.slug.split("/")[1]);
    ledgerItems.push({ slug: it.slug, owner: it.owner, hash: "sha256:x", adapter: it.adapter, from: it.from, to });
  }
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, "manifest.json"), JSON.stringify({ trashedAt, items: ledgerItems }, null, 2));
}

describe("restore", () => {
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "skillet-home-"));
    adapters = await mkdtemp(join(tmpdir(), "skillet-adapters-"));
    process.env["SKILLET_DIR"] = home;
    process.env["SKILLET_SKILL_ROOTS"] = adapters; // sandbox adapter root is restorable
  });
  afterEach(async () => {
    delete process.env["SKILLET_DIR"];
    delete process.env["SKILLET_SKILL_ROOTS"];
    await rm(home, { recursive: true, force: true });
    await rm(adapters, { recursive: true, force: true });
  });

  it("lists trash runs newest-first with their skills", async () => {
    await stageTrashRun(STAMP, "2026-06-20T10:00:00.000Z", [
      { slug: "@alice/drop", owner: "alice", adapter: "claude", from: join(adapters, "alice--drop") },
    ]);
    const runs = await listTrash();
    expect(runs).toHaveLength(1);
    expect(runs[0].id).toBe(STAMP);
    expect(runs[0].skills).toEqual(["@alice/drop"]);
  });

  it("restores the latest run: files back, re-registered, trash emptied", async () => {
    const from = join(adapters, "alice--drop");
    await stageTrashRun(STAMP, "2026-06-20T10:00:00.000Z", [
      { slug: "@alice/drop", owner: "alice", adapter: "claude", from },
    ]);

    const res = await restoreTrash(); // latest
    expect(res?.restored).toEqual(["@alice/drop"]);
    expect(res?.reimported).toEqual(["@alice/drop"]);
    // files back at the original adapter path
    expect(await exists(join(from, "SKILL.md"))).toBe(true);
    // moved out of trash
    expect(await exists(join(home, "trash", STAMP, "claude", "alice--drop"))).toBe(false);
    // re-registered into local state (the import wrote a content store entry)
    expect((await readFile(join(from, "SKILL.md"), "utf8")).includes("name: drop")).toBe(true);
  });

  it("never clobbers an existing destination", async () => {
    const from = join(adapters, "alice--drop");
    await writeBundle(from, "drop"); // destination already present
    await stageTrashRun(STAMP, "2026-06-20T10:00:00.000Z", [
      { slug: "@alice/drop", owner: "alice", adapter: "claude", from },
    ]);

    const res = await restoreTrash();
    expect(res?.restored).toEqual([]);
    expect(res?.skipped).toEqual([{ slug: "@alice/drop", reason: "destination_exists" }]);
    // trash copy untouched (still there)
    expect(await exists(join(home, "trash", STAMP, "claude", "alice--drop", "SKILL.md"))).toBe(true);
  });

  it("is idempotent — a second restore is a no-op", async () => {
    const from = join(adapters, "alice--drop");
    await stageTrashRun(STAMP, "2026-06-20T10:00:00.000Z", [
      { slug: "@alice/drop", owner: "alice", adapter: "claude", from },
    ]);
    await restoreTrash();
    const second = await restoreTrash();
    // run still listed (ledger remains), but nothing to move
    expect(second?.restored).toEqual([]);
  });

  it("returns null when there is nothing to restore", async () => {
    expect(await restoreTrash()).toBeNull();
    expect(await restoreTrash("nope")).toBeNull();
  });

  it("SECURITY: refuses a planted ledger pointing outside the allowed roots (no write-what-where)", async () => {
    // Attacker-planted ledger: `from` is a sensitive path NOT under any skill root.
    const runDir = join(home, "trash", STAMP);
    const payload = join(runDir, "claude", "evil");
    await writeBundle(payload, "evil");
    const evilTarget = join(home, "ATTACKER_PLANTED"); // outside SKILLET_SKILL_ROOTS (=adapters)
    await mkdir(runDir, { recursive: true });
    await writeFile(
      join(runDir, "manifest.json"),
      JSON.stringify({
        trashedAt: "2026-06-20T10:00:00.000Z",
        items: [{ slug: "x", owner: null, hash: "", adapter: "claude", from: evilTarget, to: payload }],
      }),
    );

    const res = await restoreTrash();
    expect(res?.restored).toEqual([]);
    expect(res?.skipped).toEqual([{ slug: "x", reason: "unsafe_destination" }]);
    expect(await exists(evilTarget)).toBe(false); // nothing was written outside the allowed root
  });

  it("SECURITY: refuses a ledger whose source escapes the trash run", async () => {
    const runDir = join(home, "trash", STAMP);
    const from = join(adapters, "alice--ok"); // valid destination
    await mkdir(runDir, { recursive: true });
    await writeFile(
      join(runDir, "manifest.json"),
      JSON.stringify({
        trashedAt: "2026-06-20T10:00:00.000Z",
        // `to` is outside the run dir → must be refused.
        items: [{ slug: "x", owner: "alice", hash: "", adapter: "claude", from, to: join(home, "etc-passwd") }],
      }),
    );
    const res = await restoreTrash();
    expect(res?.skipped).toEqual([{ slug: "x", reason: "unsafe_source" }]);
    expect(await exists(from)).toBe(false);
  });

  it("clears old trash, keeps recent, never touches foreign dirs", async () => {
    const oldStamp = "2026-01-01T00-00-00-000Z-old001";
    const newStamp = "2026-06-20T10-00-00-000Z-new001";
    await stageTrashRun(oldStamp, "2026-01-01T00:00:00.000Z", [
      { slug: "@alice/old", owner: "alice", adapter: "claude", from: join(adapters, "alice--old") },
    ]);
    await stageTrashRun(newStamp, "2026-06-20T10:00:00.000Z", [
      { slug: "@alice/new", owner: "alice", adapter: "claude", from: join(adapters, "alice--new") },
    ]);
    // a foreign dir under trash/ that doesn't match the stamp format
    await mkdir(join(home, "trash", "not-a-stamp"), { recursive: true });
    // a near-miss the loose `[\d-]+` grammar would have matched (extra time
    // group) — the tightened HH-MM-SS-mmm grammar must reject it as foreign.
    const looseStamp = "2026-01-01T00-00-00-000-000Z-bad001";
    await mkdir(join(home, "trash", looseStamp), { recursive: true });

    const now = Date.parse("2026-06-20T10:00:00.000Z");
    const cleared = await clearOldTrash(30, now);

    expect(cleared).toBe(1);
    expect(await exists(join(home, "trash", oldStamp))).toBe(false); // old → gone
    expect(await exists(join(home, "trash", newStamp))).toBe(true); // recent → kept
    expect(await exists(join(home, "trash", "not-a-stamp"))).toBe(true); // foreign → untouched
    expect(await exists(join(home, "trash", looseStamp))).toBe(true); // near-miss → untouched
  });
});
