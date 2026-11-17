/**
 * Save making the fixes on this computer (plan U11, KTD7 KTD8 KTD9 KTD10 KTD16;
 * R6 R7 R12 R18 R19; AE3).
 *
 * HOME and SKILLET_DIR point into a throwaway folder before core loads, the
 * scan runs with stub adapters aimed at that home, and the account is an
 * in-memory stand-in for the registry, so nothing here reads a real skills
 * folder or reaches the network.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { lstat, mkdir, readdir, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { canonicalContentHash } from "@skillet/protocol";
import type { KitMapDocument, KitMapDraft, KitMapEntry, KitMapPendingChange } from "@skillet/protocol/kit-map";

const HOME = vi.hoisted(() => {
  const { redirectHome } = require("./helpers/redirect-home.cjs");
  return redirectHome("skillet-map-apply") as string;
});

// The claim test below reads this machine's id; a fixed one keeps the real one out.
vi.mock("../src/machine-identity.js", () => ({ stableMachineId: () => "m-test" }));

import { authConnectFreshPair } from "../src/commands/auth-connect-pair.js";
import {
  readMapSkillBundle,
  runMapApply,
  type MapApplyClient,
  type MapBackupBody,
  type MapBackupPut,
  type MapChangeInput,
  type MapFillResult,
} from "../src/map/apply.js";
import { acquireMapSaveLock, mapSaveLockPath, readMapSaveLock } from "../src/map/save-lock.js";
import { scanMap, type MapScanResult } from "../src/map/scan.js";
import { mapTrashRoot } from "../src/map/remove-trash.js";
import { readState, writeState } from "../src/kit/store.js";
import { restoreTrash } from "../src/commands/restore.js";
import type { Adapter } from "../src/adapter.js";

const SKILLET = join(HOME, ".skillet");
const CLAUDE = join(HOME, ".claude", "skills");
const AGENTS = join(HOME, ".agents", "skills");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function stub(name: string, targetDir: string): Adapter {
  return {
    name,
    targetDir,
    async detect() {
      return existsSync(dirname(targetDir));
    },
    targetPath: (slug: string) => join(targetDir, slug, "SKILL.md"),
    targetSkillDir: (slug: string) => join(targetDir, slug),
    async materialize() {
      return [];
    },
  };
}

const ADAPTERS = (): Adapter[] => [stub("claude-code", CLAUDE), stub("codex", AGENTS)];

function skillMd(name: string, body = `Body for ${name}.`): string {
  return `---\nname: ${name}\ndescription: ${name} helper\n---\n\n# ${name}\n\n${body}\n`;
}

async function writeSkill(dir: string, name: string, extra: Record<string, string> = {}, body?: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), skillMd(name, body));
  for (const [rel, content] of Object.entries(extra)) {
    await mkdir(dirname(join(dir, rel)), { recursive: true });
    await writeFile(join(dir, rel), content);
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2));
}

/** An enabled Claude Code plugin, `alpha@market`, carrying one skill. */
async function writePlugin(skill: string): Promise<string> {
  const install = join(HOME, ".claude", "plugins", "cache", "market", "alpha", "1.0.0");
  await writeSkill(join(install, "skills", skill), skill);
  await writeJson(join(HOME, ".claude", "plugins", "installed_plugins.json"), {
    version: 2,
    plugins: { "alpha@market": [{ scope: "user", installPath: install, version: "1.0.0" }] },
  });
  await writeJson(join(HOME, ".claude", "settings.json"), { enabledPlugins: { "alpha@market": true } });
  return install;
}

const scan = (): Promise<MapScanResult> => scanMap({ adapters: ADAPTERS(), home: HOME, handle: "test-user" });

/** The scan as the map shows it: what the CLI sends the frame, minus usage. */
function wireOf(result: MapScanResult): KitMapEntry[] {
  return result.entries.map((e) => {
    const entry: KitMapEntry = {
      key: e.key,
      name: e.name,
      description: e.description.slice(0, 1024),
      source: e.source,
      tools: e.tools.map((tool) => ({ tool, copies: e.copies[tool] ?? 1 })),
      job: e.jobId,
      usage: { state: "unknown", reason: "no-history" },
    };
    if (e.owner?.kind === "plugin") entry.from = { kind: "plugin", name: e.owner.name, on: e.owner.enabled };
    if (e.owner?.kind === "organization") entry.from = { kind: "organization", name: e.owner.name, on: null };
    if (e.owner?.kind === "app") entry.from = { kind: "app", name: e.owner.name, on: null };
    const skillet = e.locations.find((l) => l.skillet !== null)?.skillet;
    if (skillet && e.source !== "local") {
      entry.skillet = { ref: skillet.maker ? `@${skillet.maker}/${skillet.slug}` : null, name: e.name };
    }
    return entry;
  });
}

/** Every path under `dir` with its bytes' hash, to prove nothing changed. */
async function snapshot(dir: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const walk = async (path: string): Promise<void> => {
    const info = await lstat(path);
    if (info.isSymbolicLink()) out.set(path, `link ${await readlink(path)}`);
    else if (info.isDirectory()) {
      out.set(path, "dir");
      for (const name of (await readdir(path)).sort()) await walk(join(path, name));
    } else out.set(path, createHash("sha256").update(await readFile(path)).digest("hex"));
  };
  await walk(dir);
  return out;
}

// ---------------------------------------------------------------------------
// The account, in memory
// ---------------------------------------------------------------------------

interface FakeAccount {
  client: MapApplyClient;
  calls: string[];
  changes: Map<string, KitMapPendingChange & { outcome?: string }>;
  backups: Map<string, MapBackupBody>;
  doc: () => KitMapDocument | null;
  fills: string[];
  kitRemovals: string[];
  /** Waiting changes with no computer yet, as a dropped-folder Save leaves them. */
  deviceless: KitMapPendingChange[];
  claimedWith: string[][];
  fail: {
    ack?: boolean;
    putBackup?: (hash: string, n: number) => MapBackupPut | "throw" | null;
    writeMap?: boolean;
    record?: boolean;
  };
  fillResults: Map<string, MapFillResult>;
}

function account(device = "dev-test"): FakeAccount {
  const calls: string[] = [];
  const changes = new Map<string, KitMapPendingChange & { outcome?: string }>();
  const backups = new Map<string, MapBackupBody>();
  let doc: KitMapDocument | null = null;
  let next = 0;
  let puts = 0;
  const fake: FakeAccount = {
    calls,
    changes,
    backups,
    doc: () => doc,
    fills: [],
    kitRemovals: [],
    deviceless: [],
    claimedWith: [],
    fail: {},
    fillResults: new Map(),
    client: {
      async listChanges() {
        calls.push("listChanges");
        return [...changes.values()].filter((c) => c.outcome === undefined).map(({ outcome: _o, ...c }) => c);
      },
      async claimChanges(keys) {
        calls.push("claimChanges");
        fake.claimedWith.push([...keys]);
        const held = new Set(keys);
        const won: KitMapPendingChange[] = [];
        for (const change of [...fake.deviceless]) {
          const needs = change.kind === "remove" ? [change.key] : change.kind === "unknown" ? [] : change.keys;
          if (needs.length === 0 || !needs.every((k) => held.has(k))) continue;
          const mine = { ...change, device } as KitMapPendingChange;
          changes.set(mine.id, mine);
          fake.deviceless.splice(fake.deviceless.indexOf(change), 1);
          won.push(mine);
        }
        return won;
      },
      async recordChanges(input: MapChangeInput[]) {
        calls.push(`recordChanges ${input.map((c) => c.kind).join(",")}`);
        if (fake.fail.record) throw new Error("registry unreachable");
        return input.map((c) => {
          const change = { ...c, id: `change-${++next}`, device, version: 1 } as KitMapPendingChange;
          changes.set(change.id, change);
          return change;
        });
      },
      async ackChange(id, outcome) {
        calls.push(`ack ${id} ${outcome}`);
        if (fake.fail.ack) throw new Error("registry unreachable");
        const change = changes.get(id);
        if (change) change.outcome = outcome;
      },
      async listBackups() {
        calls.push("listBackups");
        return new Set(backups.keys());
      },
      async putBackup(hash, body) {
        calls.push(`putBackup ${hash}`);
        puts++;
        const forced = fake.fail.putBackup?.(hash, puts);
        if (forced === "throw") throw new Error("registry unreachable");
        if (forced) return forced;
        backups.set(hash, body);
        return { ok: true };
      },
      async removeFromKit(ref) {
        calls.push(`removeFromKit @${ref.owner}/${ref.slug}`);
        fake.kitRemovals.push(`@${ref.owner}/${ref.slug}`);
        return { ok: true };
      },
      async fill(ref) {
        calls.push(`fill ${ref}`);
        fake.fills.push(ref);
        return fake.fillResults.get(ref) ?? { ok: true };
      },
      async readMap() {
        calls.push("readMap");
        return doc ? structuredClone(doc) : null;
      },
      async writeMap(next) {
        calls.push("writeMap");
        if (fake.fail.writeMap) throw new Error("registry unreachable");
        if ((doc?.version ?? 0) !== next.version) return "conflict";
        doc = { ...structuredClone(next), version: next.version + 1 };
        return "ok";
      },
    },
  };
  return fake;
}

async function saveWith(fake: FakeAccount, drafts: KitMapDraft[], over: Partial<Parameters<typeof runMapApply>[0]> = {}) {
  const fresh = await scan();
  return runMapApply({
    mode: "save",
    scan: fresh,
    wire: wireOf,
    drafts,
    draftedOn: wireOf(fresh),
    client: fake.client,
    rescan: scan,
    ...over,
  });
}

const byName = (result: MapScanResult, name: string) => {
  const entry = result.entries.find((e) => e.name === name);
  if (!entry) throw new Error(`no ${name} in the scan`);
  return entry;
};

beforeEach(async () => {
  await rm(HOME, { recursive: true, force: true });
  await mkdir(HOME, { recursive: true });
  await mkdir(join(HOME, ".claude"), { recursive: true });
  await mkdir(join(HOME, ".agents"), { recursive: true });
});

// ---------------------------------------------------------------------------
// Reading a skill the way the scan keys it
// ---------------------------------------------------------------------------

describe("readMapSkillBundle", () => {
  it("reads exactly the files the scan keys: no dot-files, no Skillet backups", async () => {
    await writeSkill(join(CLAUDE, "pdf"), "pdf", {
      ".DS_Store": "finder",
      "references/guide.md": "a guide",
      "SKILL.md.skillet-backup": "older",
    });
    const result = await scan();
    const bundle = await readMapSkillBundle(join(CLAUDE, "pdf"));
    expect([...bundle.keys()].sort()).toEqual(["SKILL.md", "references/guide.md"]);
    expect(canonicalContentHash(bundle)).toBe(byName(result, "pdf").key);
  });
});

// ---------------------------------------------------------------------------
// What Save records first
// ---------------------------------------------------------------------------

describe("recording before applying (KTD10)", () => {
  it("records every drafted remove and merge as this computer's change before any backup or move", async () => {
    await writeSkill(join(CLAUDE, "old-notes"), "old-notes");
    await writeSkill(join(CLAUDE, "plain-prose"), "plain-prose", {}, "Edit prose so it reads plainly.");
    await writeSkill(join(CLAUDE, "copy-editor"), "copy-editor", {}, "Copy edit prose before it ships.");
    const before = await scan();
    const old = byName(before, "old-notes");
    const prose = byName(before, "plain-prose");
    const copy = byName(before, "copy-editor");
    const fake = account();

    const res = await saveWith(fake, [
      { kind: "remove", key: old.key },
      { kind: "merge", job: "writing.editing", keys: [prose.key, copy.key] },
      { kind: "move", key: prose.key, job: "writing.editing" },
      { kind: "move", key: copy.key, job: "writing.editing" },
    ]);

    const record = fake.calls.findIndex((c) => c.startsWith("recordChanges"));
    const firstBackup = fake.calls.findIndex((c) => c.startsWith("putBackup"));
    const firstAck = fake.calls.findIndex((c) => c.startsWith("ack"));
    expect(fake.calls[record]).toBe("recordChanges remove,merge");
    expect(record).toBeGreaterThan(-1);
    expect(record).toBeLessThan(firstBackup);
    expect(record).toBeLessThan(firstAck);
    expect(res.result).toBe("applied");
    expect(res.counts).toEqual({ backups: 3, removals: 1, fills: 0, merges: 1 });
    expect(res.left).toEqual({ backups: 0, removals: 0, fills: 0, merges: 0 });
    // The remove is done and acknowledged; the merge waits for the merge step.
    const stored = [...fake.changes.values()];
    expect(stored.find((c) => c.kind === "remove")?.outcome).toBe("applied");
    expect(stored.find((c) => c.kind === "merge")?.outcome).toBeUndefined();
    expect(existsSync(join(CLAUDE, "old-notes"))).toBe(false);
  });

  it("a change already waiting for this computer is not recorded twice", async () => {
    await writeSkill(join(CLAUDE, "old-notes"), "old-notes");
    const before = await scan();
    const key = byName(before, "old-notes").key;
    const fake = account();
    fake.changes.set("waiting-1", { id: "waiting-1", device: "dev-test", version: 1, kind: "remove", key });

    const res = await saveWith(fake, [{ kind: "remove", key }]);

    expect(fake.calls.some((c) => c.startsWith("recordChanges"))).toBe(false);
    expect(fake.changes.get("waiting-1")?.outcome).toBe("applied");
    expect(res.counts.removals).toBe(1);
  });

  it("when recording fails, nothing is backed up or moved", async () => {
    await writeSkill(join(CLAUDE, "old-notes"), "old-notes");
    const before = await scan();
    const fake = account();
    fake.fail.record = true;

    const res = await saveWith(fake, [{ kind: "remove", key: byName(before, "old-notes").key }]);

    expect(res.result).toBe("failed");
    expect(res.changed).toBe(false);
    expect(fake.calls.some((c) => c.startsWith("putBackup"))).toBe(false);
    expect(existsSync(join(CLAUDE, "old-notes", "SKILL.md"))).toBe(true);
    expect(res.left.removals).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Backups (KTD7)
// ---------------------------------------------------------------------------

describe("backups", () => {
  it("two different local skills slugged code-review both back up, keyed by their hashes", async () => {
    await writeSkill(join(CLAUDE, "code-review"), "code-review", {}, "Review for bugs.");
    await writeSkill(join(AGENTS, "code-review"), "code-review", {}, "Review for style.");
    const before = await scan();
    const keys = before.entries.filter((e) => e.name === "code-review").map((e) => e.key);
    expect(new Set(keys).size).toBe(2);
    const fake = account();

    const res = await saveWith(fake, []);

    expect([...fake.backups.keys()].sort()).toEqual([...keys].sort());
    for (const key of keys) {
      const body = fake.backups.get(key)!;
      expect(body.name).toBe("code-review");
      expect(body.origin).toBe("scan");
      expect(Object.keys(body.files)).toEqual(["SKILL.md"]);
    }
    expect(res.counts.backups).toBe(2);
  });

  it("a local writing-style beside the person's published one backs up as a private backup by hash", async () => {
    await writeSkill(join(CLAUDE, "writing-style"), "writing-style");
    await writeSkill(join(CLAUDE, "test-user--writing-style"), "writing-style", {}, "The published one.");
    const before = await scan();
    const local = before.entries.find((e) => e.name === "writing-style" && e.source === "local")!;
    const own = before.entries.find((e) => e.source === "skillet-own")!;
    const fake = account();

    await saveWith(fake, []);

    expect([...fake.backups.keys()]).toEqual([local.key]);
    expect(fake.backups.has(own.key), "the published skill is never backed up").toBe(false);
    expect(fake.backups.get(local.key)!.origin).toBe("scan");
  });

  it("a skill flagged as unable to back up is skipped and listed in the result", async () => {
    await writeSkill(join(CLAUDE, "tracked"), "tracked", { ".git/HEAD": "ref: refs/heads/main\n" });
    await writeSkill(join(CLAUDE, "plain"), "plain");
    const fake = account();

    const res = await saveWith(fake, []);

    expect(res.notBackedUp).toEqual([{ name: "tracked", reason: "git-folder" }]);
    expect(fake.calls.filter((c) => c.startsWith("putBackup"))).toHaveLength(1);
    expect(res.counts.backups).toBe(1);
    expect(res.result).toBe("applied");
  });

  it("a skill refused for a secret is listed with the file to clean, and the other backups go on", async () => {
    await writeSkill(join(CLAUDE, "leaky"), "leaky", { "references/config.md": "token" });
    await writeSkill(join(CLAUDE, "alpha"), "alpha");
    await writeSkill(join(CLAUDE, "zulu"), "zulu");
    const before = await scan();
    const leaky = byName(before, "leaky").key;
    const fake = account();
    fake.fail.putBackup = (hash) => (hash === leaky ? { ok: false, reason: "secret", file: "config.md", final: true } : null);

    const res = await saveWith(fake, []);

    expect(res.notBackedUp).toEqual([{ name: "leaky", reason: "secret", file: "config.md" }]);
    expect(fake.backups.size).toBe(2);
    expect(res.counts.backups).toBe(2);
    expect(res.left.backups).toBe(0);
  });

  it("skips hashes the account already holds", async () => {
    await writeSkill(join(CLAUDE, "kept"), "kept");
    const before = await scan();
    const fake = account();
    fake.backups.set(byName(before, "kept").key, { files: {}, name: "kept", description: "", tools: [], origin: "scan" });

    const res = await saveWith(fake, []);

    expect(fake.calls.some((c) => c.startsWith("putBackup"))).toBe(false);
    expect(res.counts.backups).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Remove follows the folder rules (KTD8)
// ---------------------------------------------------------------------------

describe("Remove", () => {
  it("AE3: a plugin skill's Remove changes no file, and the result names the plugin", async () => {
    const install = await writePlugin("code-review");
    await writeSkill(join(CLAUDE, "notes"), "notes");
    const before = await scan();
    const plugin = byName(before, "code-review");
    expect(plugin.source).toBe("plugin");
    const fake = account();
    // A change waiting for this computer, such as one a dropped-folder Save left, names the plugin's skill.
    fake.changes.set("waiting-1", { id: "waiting-1", device: "dev-test", version: 1, kind: "remove", key: plugin.key });
    const home = await snapshot(join(HOME, ".claude"));

    const res = await saveWith(fake, []);

    expect(await snapshot(join(HOME, ".claude"))).toEqual(home);
    expect(existsSync(join(install, "skills", "code-review", "SKILL.md"))).toBe(true);
    expect(res.kept).toEqual([{ name: "code-review", kind: "plugin", owner: "alpha" }]);
    expect(res.counts.removals).toBe(0);
    expect(fake.changes.get("waiting-1")?.outcome).toBe("kept-plugin");
    expect(existsSync(mapTrashRoot())).toBe(false);
  });

  it("a Skillet import leaves the kit store: its folders go to the map trash and its kit entry goes", async () => {
    await writeSkill(join(CLAUDE, "_local--agent-browser"), "agent-browser");
    await writeSkill(join(AGENTS, "_local--agent-browser"), "agent-browser");
    await writeState({
      version: 1,
      skills: {
        "agent-browser": {
          slug: "agent-browser",
          name: "agent-browser",
          description: "",
          version: 1,
          hash: "sha256:0",
          source: "local",
          importedAt: "2026-11-01T00:00:00.000Z",
          updatedAt: "2026-11-01T00:00:00.000Z",
        },
      },
    });
    const before = await scan();
    const imported = byName(before, "agent-browser");
    expect(imported.source).toBe("skillet-imported");
    const fake = account();

    const res = await saveWith(fake, [{ kind: "remove", key: imported.key }]);

    expect(res.counts.removals).toBe(1);
    expect(existsSync(join(CLAUDE, "_local--agent-browser"))).toBe(false);
    expect(existsSync(join(AGENTS, "_local--agent-browser"))).toBe(false);
    expect((await readState()).skills["agent-browser"]).toBeUndefined();
    expect(fake.backups.size, "an import is already in the kit store, so it isn't backed up").toBe(0);

    const restored = await restoreTrash(res.trashRun!);
    expect(restored?.restored).toEqual(["agent-browser"]);
    expect(existsSync(join(CLAUDE, "_local--agent-browser", "SKILL.md"))).toBe(true);
    expect((await readState()).skills["agent-browser"], "restore never re-imports").toBeUndefined();
  });

  it("another maker's skill leaves through kit removal, and its folders are left for sync to take", async () => {
    await writeSkill(join(CLAUDE, "alice--show-notes"), "show-notes");
    const before = await scan();
    const added = byName(before, "show-notes");
    expect(added.source).toBe("skillet-added");
    const fake = account();

    const res = await saveWith(fake, [{ kind: "remove", key: added.key }]);

    expect(fake.kitRemovals).toEqual(["@alice/show-notes"]);
    expect(existsSync(join(CLAUDE, "alice--show-notes", "SKILL.md"))).toBe(true);
    expect(res.counts.removals).toBe(1);
    expect([...fake.changes.values()][0]?.outcome).toBe("applied");
  });
});

// ---------------------------------------------------------------------------
// Fill, Move, Merge
// ---------------------------------------------------------------------------

describe("Fill, Move and Merge", () => {
  it("Fill adds each pick through kit add; a pick the registry refuses is reported and the rest go on", async () => {
    const fake = account();
    fake.fillResults.set("@test-maker/private-pick", { ok: false, reason: "not-public", final: true });

    const res = await saveWith(fake, [
      { kind: "fill", job: "writing.editing", ref: "@test-maker/private-pick" },
      { kind: "fill", job: "development.code-review", ref: "@test-maker/public-pick" },
    ]);

    expect(fake.fills).toEqual(["@test-maker/private-pick", "@test-maker/public-pick"]);
    expect(res.refused).toEqual([{ ref: "@test-maker/private-pick", reason: "not-public" }]);
    expect(res.counts.fills).toBe(1);
    expect(res.left.fills).toBe(0);
  });

  it("Move changes only the saved map's assignment", async () => {
    await writeSkill(join(CLAUDE, "notes"), "notes");
    const before = await scan();
    const key = byName(before, "notes").key;
    const fake = account();
    const files = await snapshot(CLAUDE);

    const res = await saveWith(fake, [{ kind: "move", key, job: "writing.editing" }]);

    expect(await snapshot(CLAUDE)).toEqual(files);
    expect(fake.doc()?.assignments[key]).toBe("writing.editing");
    expect(fake.doc()?.entries.map((e) => e.name)).toEqual(["notes"]);
    expect(JSON.stringify(fake.doc())).not.toContain(HOME);
    expect(res.result).toBe("applied");
  });

  it("the saved map keeps entries and jobs from the account's other computers, and re-reads on a conflict", async () => {
    await writeSkill(join(CLAUDE, "notes"), "notes");
    const fake = account();
    const other = `sha256:${"b".repeat(64)}`;
    // Another computer saved first.
    expect(
      await fake.client.writeMap({
        version: 0,
        entries: [{ key: other, name: "elsewhere", description: "", source: "local" }],
        assignments: { [other]: "writing.editing" },
      }),
    ).toBe("ok");
    let raced = false;
    const writeMap = fake.client.writeMap;
    fake.client.writeMap = async (doc) => {
      if (!raced) {
        raced = true;
        return "conflict";
      }
      return writeMap(doc);
    };

    const res = await saveWith(fake, []);

    expect(res.result).toBe("applied");
    expect(fake.calls.filter((c) => c === "readMap").length).toBeGreaterThanOrEqual(2);
    expect(fake.doc()?.entries.map((e) => e.name).sort()).toEqual(["elsewhere", "notes"]);
    expect(fake.doc()?.assignments[other]).toBe("writing.editing");
  });
});

// ---------------------------------------------------------------------------
// Resuming (KTD10)
// ---------------------------------------------------------------------------

describe("resuming", () => {
  it("the registry failing midway leaves a partial result; a rerun finishes without trashing twice or uploading again", async () => {
    await writeSkill(join(CLAUDE, "old-notes"), "old-notes");
    await writeSkill(join(CLAUDE, "alpha"), "alpha");
    await writeSkill(join(CLAUDE, "zulu"), "zulu");
    const before = await scan();
    const old = byName(before, "old-notes").key;
    const zulu = byName(before, "zulu").key;
    const fake = account();
    // The registry goes away after the changes are recorded.
    fake.fail.ack = true;
    fake.fail.writeMap = true;
    fake.fail.putBackup = (hash) => (hash === zulu ? "throw" : null);

    const first = await saveWith(fake, [{ kind: "remove", key: old }]);

    expect(first.result).toBe("partial");
    expect(first.changed).toBe(true);
    expect(first.counts.removals).toBe(1);
    expect(first.left).toEqual({ backups: 1, removals: 0, fills: 0, merges: 0 });
    expect(existsSync(join(CLAUDE, "old-notes"))).toBe(false);
    expect([...fake.changes.values()][0]?.outcome, "the change is still open").toBeUndefined();
    const putsAfterFirst = fake.calls.filter((c) => c.startsWith("putBackup")).length;

    // The next run (another Save, or the app's `skillet map --apply`) finishes it.
    fake.fail = {};
    const second = await runMapApply({ mode: "apply", scan: await scan(), wire: wireOf, client: fake.client });

    expect(second.result).toBe("applied");
    expect([...fake.changes.values()][0]?.outcome).toBe("gone");
    expect(await readdir(mapTrashRoot()), "one trash run: nothing was trashed twice").toHaveLength(1);
    const puts = fake.calls.filter((c) => c.startsWith("putBackup"));
    expect(puts.length - putsAfterFirst, "apply alone backs up nothing new").toBe(0);

    // A Save after that uploads only the backup that failed.
    const third = await saveWith(fake, []);
    expect(third.result).toBe("applied");
    expect(fake.calls.filter((c) => c.startsWith("putBackup")).slice(putsAfterFirst)).toEqual([`putBackup ${zulu}`]);
  });

  it("a waiting change from a dropped-folder Save is claimed with the scan's hashes and applied as this computer's own", async () => {
    await writeSkill(join(CLAUDE, "dropped"), "dropped");
    await writeSkill(join(CLAUDE, "kept"), "kept");
    const before = await scan();
    const dropped = byName(before, "dropped").key;
    const fake = account();
    fake.deviceless.push({ id: "dropped-1", device: null, version: 1, kind: "remove", key: dropped });
    // The dropped-folder Save saved the map with the hashes it saw.
    await fake.client.writeMap({
      version: 0,
      entries: [{ key: dropped, name: "dropped", description: "", source: "local" }],
      assignments: {},
    });

    const res = await runMapApply({ mode: "apply", scan: before, wire: wireOf, client: fake.client });

    expect(fake.claimedWith).toEqual([[dropped]]);
    expect(fake.changes.get("dropped-1")?.outcome).toBe("applied");
    expect(existsSync(join(CLAUDE, "dropped"))).toBe(false);
    expect(existsSync(join(CLAUDE, "kept", "SKILL.md"))).toBe(true);
    expect(res.counts.removals).toBe(1);
    expect(fake.doc()?.entries.map((e) => e.key)).not.toContain(dropped);
  });

  it("two waiting removes of one skill move it once and acknowledge both", async () => {
    await writeSkill(join(CLAUDE, "dropped"), "dropped");
    const before = await scan();
    const dropped = byName(before, "dropped").key;
    const fake = account();
    fake.changes.set("own-1", { id: "own-1", device: "dev-test", version: 1, kind: "remove", key: dropped });
    fake.deviceless.push({ id: "dropped-1", device: null, version: 1, kind: "remove", key: dropped });

    const res = await saveWith(fake, []);

    expect(res.counts.removals).toBe(1);
    expect(fake.changes.get("own-1")?.outcome).toBe("applied");
    expect(fake.changes.get("dropped-1")?.outcome).toBe("applied");
    expect(await readdir(mapTrashRoot())).toHaveLength(1);
  });

  it("with nothing waiting, apply changes nothing and writes nothing", async () => {
    await writeSkill(join(CLAUDE, "kept"), "kept");
    const fake = account();
    const files = await snapshot(CLAUDE);

    const res = await runMapApply({ mode: "apply", scan: await scan(), wire: wireOf, client: fake.client });

    expect(res.result).toBe("applied");
    expect(res.changed).toBe(false);
    expect(await snapshot(CLAUDE)).toEqual(files);
    expect(fake.calls.filter((c) => /^(putBackup|recordChanges|writeMap|ack)/.test(c))).toEqual([]);
    expect(fake.claimedWith, "no saved map: no hash leaves the computer").toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The save lock (KTD10)
// ---------------------------------------------------------------------------

describe("the save lock", () => {
  it("a second Save waits while the first holds the lock, says why, and goes once it's released", async () => {
    const first = await acquireMapSaveLock();
    expect(mapSaveLockPath()).toBe(join(SKILLET, "map-save.lock"));
    expect(await readMapSaveLock()).toMatchObject({ pid: process.pid });

    const waits: number[] = [];
    const second = acquireMapSaveLock({ waitMs: 5_000, pollMs: 20, onWait: (holder) => waits.push(holder.pid) });
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(waits).toEqual([process.pid]);
    await first.release();

    const lock = await second;
    expect(await readMapSaveLock()).toMatchObject({ pid: process.pid });
    await lock.release();
    expect(existsSync(mapSaveLockPath())).toBe(false);
  });

  it("a stale lock whose process is gone is cleared", async () => {
    const gone = spawnSync(process.execPath, ["-e", "process.exit(0)"]).pid;
    await mkdir(SKILLET, { recursive: true });
    await writeFile(mapSaveLockPath(), JSON.stringify({ pid: gone, startedAt: new Date().toISOString(), token: "x" }));
    expect(await readMapSaveLock()).toBeNull();

    const waits: number[] = [];
    const lock = await acquireMapSaveLock({ waitMs: 1_000, pollMs: 20, onWait: (holder) => waits.push(holder.pid) });
    expect(waits).toEqual([]);
    expect(JSON.parse(readFileSync(mapSaveLockPath(), "utf8")).pid).toBe(process.pid);
    await lock.release();
  });

  it("gives up after the wait while a live holder keeps it", async () => {
    const first = await acquireMapSaveLock();
    await expect(acquireMapSaveLock({ waitMs: 60, pollMs: 20 })).rejects.toThrow(/Another Save/);
    await first.release();
  });
});

// ---------------------------------------------------------------------------
// The claim a map session ends in (KTD6)
// ---------------------------------------------------------------------------

describe("authConnectFreshPair", () => {
  it("never presents the device token stored here, and writes the new one", async () => {
    await mkdir(SKILLET, { recursive: true });
    await writeFile(
      join(SKILLET, "device.json"),
      JSON.stringify({
        device_token: "skillet_d_other",
        device_id: "dev-other",
        label: "test-machine",
        machine_id: "m-test",
        saved_at: "2026-11-01T00:00:00.000Z",
      }),
    );
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImpl = (async (_url: string | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(
        JSON.stringify({
          session_token: "skillet_s_new",
          device_token: "skillet_d_new",
          device_id: "dev-new",
          user_id: "user-b",
          handle: "test-user",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const result = await authConnectFreshPair({ code: "MAPS2345", registryUrl: "https://registry.test", label: "test-machine", fetchImpl });

    expect(bodies).toHaveLength(1);
    expect("device_token" in bodies[0]!).toBe(false);
    expect(bodies[0]).toMatchObject({ code: "MAPS2345", label: "test-machine", client_kind: "cli", machine_id: "m-test" });
    expect(JSON.parse(readFileSync(join(SKILLET, "device.json"), "utf8"))).toMatchObject({
      device_token: "skillet_d_new",
      device_id: "dev-new",
      machine_id: "m-test",
    });
    expect(JSON.parse(readFileSync(join(SKILLET, "session.json"), "utf8")).session_token).toBe("skillet_s_new");
    expect(result.handle).toBe("test-user");
  });
});
