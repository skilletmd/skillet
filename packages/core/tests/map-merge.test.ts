/**
 * The merge writer (plan U14, KTD9 KTD10 KTD12 KTD13 KTD14; R21 R22 R23 R24,
 * AE1 AE5).
 *
 * HOME and SKILLET_DIR point into a throwaway folder before core loads, the
 * scan runs with stub adapters aimed at that home, and the account is an
 * in-memory stand-in for the registry. Every AI tool here is a fake: an
 * in-process writer, or a fake `claude` or `codex` executable inside the
 * fixture home that prints a canned event stream. Tool searches get the
 * fixture home, a PATH of fixture folders (or the bare `/usr/bin:/bin` an app
 * opened from Finder hands its sidecar) and no system folders, so nothing here
 * can find, let alone run, a real AI tool.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { chmod, lstat, mkdir, readdir, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { canonicalContentHash, decodeBundle } from "@skillet/protocol";
import type { JobId } from "@skillet/protocol/jobs";
import {
  kitMapMergeCredits,
  parseKitMapMergeReport,
  type KitMapMerge,
  type KitMapMergeReport,
  type KitMapPendingChange,
  type KitMapPendingMerge,
} from "@skillet/protocol/kit-map";

const HOME = vi.hoisted(() => {
  const { redirectHome } = require("./helpers/redirect-home.cjs");
  return redirectHome("skillet-map-merge") as string;
});

import type { Adapter } from "../src/adapter.js";
import type { MapBackupBody, MapBackupPut } from "../src/map/skill-fs.js";
import { scanMap, type MapScanEntry, type MapScanResult } from "../src/map/scan.js";
import { writeState } from "../src/kit/store.js";
import {
  MergeWriterError,
  findMergeTool,
  findMergeWriter,
  mergeToolSearchDirs,
  readMergedSkill,
  runMergeTool,
  type MergeTool,
  type MergeWriter,
} from "../src/map/merge-writer.js";
import {
  isMergeableEntry,
  readMapMergeRecord,
  readMapMergeRecords,
  runMapMerges,
  type MapMergeClient,
} from "../src/map/merge-run.js";

const CLAUDE = join(HOME, ".claude", "skills");
const AGENTS = join(HOME, ".agents", "skills");
/** A PATH folder that holds nothing. */
const EMPTY_BIN = join(HOME, "empty-bin");
/** Where most fake tools go: a PATH folder of the fixture's own. */
const FAKE_BIN = join(HOME, "fake-bin");
/** The bare PATH an app opened from Finder hands its sidecar. */
const SIDECAR_PATH = "/usr/bin:/bin";

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
async function writePlugin(skill: string): Promise<void> {
  const install = join(HOME, ".claude", "plugins", "cache", "market", "alpha", "1.0.0");
  await writeSkill(join(install, "skills", skill), skill);
  await writeJson(join(HOME, ".claude", "plugins", "installed_plugins.json"), {
    version: 2,
    plugins: { "alpha@market": [{ scope: "user", installPath: install, version: "1.0.0" }] },
  });
  await writeJson(join(HOME, ".claude", "settings.json"), { enabledPlugins: { "alpha@market": true } });
}

const scan = (): Promise<MapScanResult> => scanMap({ adapters: ADAPTERS(), home: HOME, handle: "test-user" });

const byName = (result: MapScanResult, name: string): MapScanEntry => {
  const entry = result.entries.find((e) => e.name === name);
  if (!entry) throw new Error(`no ${name} in the scan`);
  return entry;
};

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

const hashOf = (seed: string): string => `sha256:${createHash("sha256").update(seed).digest("hex")}`;

/** The `name:` a SKILL.md's front matter gives, so a fake can say whose sample it wrote. */
function nameIn(skill: string): string {
  return /^name:\s*(.+)$/m.exec(skill)?.[1]?.trim() ?? "unnamed";
}

// ---------------------------------------------------------------------------
// A writer in process
// ---------------------------------------------------------------------------

type FakeWriter = MergeWriter & { calls: string[] };

function fakeWriter(over: Partial<MergeWriter> = {}): FakeWriter {
  const calls: string[] = [];
  let n = 0;
  return {
    name: "Test Writer",
    calls,
    async merge({ job, sources }) {
      calls.push(`merge ${job.id} ${sources.map((s) => s.name).join(",")}`);
      const list = sources.map((s) => `- ${s.name}: ${s.text.split("\n").at(-2) ?? ""}`).join("\n");
      return `---\nname: ${job.id.split(".")[1]}-merged\ndescription: One ${job.name} skill made from ${sources.length}.\n---\n\n# ${job.name}\n\n${list}\n`;
    },
    async brief({ job }) {
      calls.push(`brief ${job.id}`);
      return `Edit this note for a stranger: "Meeting moved to Friday, bring the numbers."`;
    },
    async sample({ skill, brief }) {
      const who = nameIn(skill);
      calls.push(`sample ${who.endsWith("-merged") ? "merged" : "original"}`);
      return `Sample ${++n} by ${who} for: ${brief}`;
    },
    ...over,
  };
}

// ---------------------------------------------------------------------------
// The account, in memory
// ---------------------------------------------------------------------------

interface FakeAccount {
  client: MapMergeClient;
  changes: Map<string, KitMapPendingChange & { outcome?: string }>;
  reports: Array<{ id: string; report: KitMapMergeReport }>;
  records: Map<string, KitMapMerge>;
  backups: Map<string, MapBackupBody>;
  /** Public skill versions by content hash, as the source-maker lookup finds them. */
  published: Map<string, { ref: string; name: string }>;
  lookups: string[][];
  fail: {
    report?: (id: string, report: KitMapMergeReport) => boolean;
    lookup?: boolean;
    putBackup?: MapBackupPut;
  };
}

function account(device = "dev-test"): FakeAccount {
  const fake: FakeAccount = {
    changes: new Map(),
    reports: [],
    records: new Map(),
    backups: new Map(),
    published: new Map(),
    lookups: [],
    fail: {},
    client: {
      async listChanges() {
        return [...fake.changes.values()].filter((c) => c.outcome === undefined).map(({ outcome: _o, ...c }) => c);
      },
      async ackChange(id, outcome) {
        const change = fake.changes.get(id);
        if (change) change.outcome = outcome;
      },
      async listMerges() {
        return [...fake.records.values()];
      },
      async reportMerge(id, report) {
        if (fake.fail.report?.(id, report)) throw new Error("registry unreachable");
        const change = fake.changes.get(id) as KitMapPendingMerge | undefined;
        if (!change) throw new Error(`no change ${id}`);
        // The registry takes exactly what the protocol reads back.
        expect(parseKitMapMergeReport(JSON.parse(JSON.stringify(report)), change.keys)).toEqual(report);
        fake.reports.push({ id, report });
        const record: KitMapMerge = { id, device, job: change.job, keys: change.keys, status: report.status, updatedAt: 1 };
        if (report.status === "failed") record.reason = report.reason;
        if (report.status === "out-of-date" && report.reason) record.reason = report.reason;
        if (report.status === "ready") record.merged = report.merged;
        fake.records.set(id, record);
      },
      async lookupSources(keys) {
        fake.lookups.push([...keys]);
        if (fake.fail.lookup) throw new Error("registry unreachable");
        const found = new Map<string, { ref: string; name: string }>();
        for (const key of keys) {
          const hit = fake.published.get(key);
          if (hit) found.set(key, hit);
        }
        return found;
      },
      async putBackup(hash, body) {
        if (fake.fail.putBackup) return fake.fail.putBackup;
        fake.backups.set(hash, structuredClone(body));
        return { ok: true };
      },
    },
  };
  return fake;
}

function addMerge(fake: FakeAccount, job: JobId, keys: string[], id = `merge-${fake.changes.size + 1}`): KitMapPendingMerge {
  const change: KitMapPendingMerge = { id, kind: "merge", device: "dev-test", version: 1, job, keys };
  fake.changes.set(id, change);
  return change;
}

const readyOf = (fake: FakeAccount, id: string): Extract<KitMapMergeReport, { status: "ready" }> | undefined =>
  fake.reports.find((r) => r.id === id && r.report.status === "ready")?.report as
    | Extract<KitMapMergeReport, { status: "ready" }>
    | undefined;

// ---------------------------------------------------------------------------
// Fake AI tools on disk
// ---------------------------------------------------------------------------

type ToolMode = "answer" | "tool-call" | "init-tools" | "hang" | "huge" | "old" | "crash" | "wrapper-tool-call";

/**
 * A fake `claude` or `codex`: a Node script run straight by its absolute
 * shebang, so it needs nothing on PATH. It logs what it was given, then
 * prints the event stream of the real tool for `mode`. Asked to merge, it
 * answers with a SKILL.md; asked for a brief, one request; otherwise a sample
 * naming the skill it was given.
 */
async function fakeTool(stem: "claude" | "codex", dir: string, mode: ToolMode, log = join(HOME, `${stem}.log`)): Promise<string> {
  if (/\s/.test(process.execPath)) throw new Error("the fake tools need a node path without spaces");
  await mkdir(dir, { recursive: true });
  const path = join(dir, stem);
  const script = `#!${process.execPath}
const fs = require("node:fs");
const stem = ${JSON.stringify(stem)};
const mode = ${JSON.stringify(mode)};
const log = ${JSON.stringify(log)};
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  fs.appendFileSync(log, JSON.stringify({ argv: process.argv.slice(2), stdin: input, cwd: process.cwd(), cwdEntries: fs.readdirSync(process.cwd()), pid: process.pid, path: process.env.PATH }) + "\\n");
  const say = (event) => process.stdout.write(JSON.stringify(event) + "\\n");
  const named = (/^name:\\s*(.+)$/m.exec(input) || [])[1] || "unnamed";
  let text;
  if (input.includes('<skill index="1"')) text = "Here is the merged skill.\\n\\n---\\nname: editing-merged\\ndescription: One editing skill.\\n---\\n\\n# Editing\\n\\nEdit plainly.\\n";
  else if (input.includes("realistic request")) text = "Tighten this note for a stranger: the meeting moved to Friday.";
  else text = "Sample by " + named.trim() + " " + Math.random().toString(36).slice(2);
  const hang = () => setInterval(() => {}, 1000);
  if (mode === "old") {
    process.stderr.write("error: unknown option '--tools'\\n");
    process.exit(1);
  }
  if (mode === "crash") {
    process.stderr.write("Something went wrong.\\n");
    process.exit(1);
  }
  if (mode === "wrapper-tool-call") {
    // Like Codex's npm wrapper: the real tool runs as a child that holds the same output.
    const inner = [
      'const fs = require("node:fs");',
      "const nl = String.fromCharCode(10);",
      "fs.appendFileSync(" + JSON.stringify(log) + ', JSON.stringify({ argv: [], stdin: "", cwd: process.cwd(), cwdEntries: [], pid: process.pid, path: "" }) + nl);',
      'process.stdout.write(JSON.stringify({ type: "item.started", item: { id: "item_0", type: "command_execution", command: "cat /etc/hosts", status: "in_progress" } }) + nl);',
      "setInterval(() => {}, 1000);",
    ].join(" ");
    require("node:child_process").spawn(process.execPath, ["-e", inner], { stdio: ["ignore", "inherit", "inherit"] });
    return hang();
  }
  if (stem === "claude") {
    say({ type: "system", subtype: "init", cwd: process.cwd(), tools: mode === "init-tools" ? ["Bash", "Read"] : [], mcp_servers: [] });
    if (mode === "tool-call") {
      say({ type: "assistant", message: { content: [{ type: "tool_use", id: "toolu_1", name: "Read", input: { file_path: "/etc/hosts" } }] } });
      return hang();
    }
    if (mode === "hang") return hang();
    if (mode === "huge") {
      say({ type: "assistant", message: { content: [{ type: "text", text: "x".repeat(3 * 1024 * 1024) }] } });
      return hang();
    }
    say({ type: "assistant", message: { content: [{ type: "thinking", thinking: "..." }, { type: "text", text }] } });
    say({ type: "result", subtype: "success", is_error: false, result: text });
    return;
  }
  say({ type: "thread.started", thread_id: "thread-1" });
  say({ type: "turn.started" });
  if (mode === "tool-call") {
    say({ type: "item.started", item: { id: "item_0", type: "command_execution", command: "bash -lc 'cat /etc/hosts'", status: "in_progress" } });
    return hang();
  }
  if (mode === "hang") return hang();
  say({ type: "item.completed", item: { id: "item_0", type: "reasoning", text: "thinking" } });
  say({ type: "item.completed", item: { id: "item_1", type: "agent_message", text } });
  say({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } });
});
`;
  await writeFile(path, script);
  await chmod(path, 0o755);
  return path;
}

interface ToolCall {
  argv: string[];
  stdin: string;
  cwd: string;
  cwdEntries: string[];
  pid: number;
  path: string;
}

function toolCalls(log: string): ToolCall[] {
  if (!existsSync(log)) return [];
  return readFileSync(log, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as ToolCall);
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The bare PATH of the sidecar, the fixture home, and no system folders: only fixture tools can be found. */
const sidecarSearch = { path: SIDECAR_PATH, home: HOME, systemDirs: [] as string[] };
const fixtureSearch = (dir: string) => ({ path: dir, home: HOME, systemDirs: [] as string[] });

beforeEach(async () => {
  await rm(HOME, { recursive: true, force: true });
  await mkdir(HOME, { recursive: true });
  await mkdir(join(HOME, ".claude"), { recursive: true });
  await mkdir(join(HOME, ".agents"), { recursive: true });
  await mkdir(EMPTY_BIN, { recursive: true });
});

// ---------------------------------------------------------------------------
// Which skills a merge is written from (KTD12)
// ---------------------------------------------------------------------------

describe("which skills a merge is written from (KTD12)", () => {
  it("a job whose doubles are a plugin skill and one local skill offers no merge, because only one can be merged", async () => {
    await writePlugin("tidy-prose");
    await writeSkill(join(CLAUDE, "plain-prose"), "plain-prose");
    const result = await scan();
    const plugin = byName(result, "tidy-prose");
    const local = byName(result, "plain-prose");
    expect(plugin.source).toBe("plugin");
    expect(isMergeableEntry(plugin)).toBe(false);
    expect(isMergeableEntry(local)).toBe(true);
  });

  it("a job holding one SKILL.md-only skill and one with a script beside it offers no merge", async () => {
    await writeSkill(join(CLAUDE, "plain-prose"), "plain-prose");
    await writeSkill(join(CLAUDE, "copy-editor"), "copy-editor", { "scripts/check.sh": "#!/bin/sh\necho ok\n" });
    const result = await scan();
    const scripted = byName(result, "copy-editor");
    expect(scripted.flags.cantMerge).toContain("extra-files");
    expect(isMergeableEntry(scripted)).toBe(false);
    expect(isMergeableEntry(byName(result, "plain-prose"))).toBe(true);
  });

  it("two of the person's own SKILL.md-only skills merge, except in a job that holds as many as you like", async () => {
    await writeSkill(join(CLAUDE, "plain-prose"), "plain-prose");
    await writeSkill(join(CLAUDE, "alice--copy-editor"), "copy-editor");
    const result = await scan();
    const held = [byName(result, "plain-prose"), byName(result, "copy-editor")];
    expect(held[1]!.source).toBe("skillet-added");
    expect(held.every(isMergeableEntry)).toBe(true);
    // Recorded for Platforms anyway, the merge is dropped before anything is written.
    const fake = account();
    const change = addMerge(fake, "development.platforms", held.map((e) => e.key));
    const writer = fakeWriter();
    const res = await runMapMerges({ scan: result, client: fake.client, writer: async () => writer });
    expect(writer.calls).toEqual([]);
    expect(res.outcomes).toEqual([{ id: change.id, job: "development.platforms", result: "dropped", reason: "not-mergeable" }]);
  });
});

// ---------------------------------------------------------------------------
// Writing and storing a merge
// ---------------------------------------------------------------------------

describe("runMapMerges", () => {
  it("AE1: a fake writer turns four Editing skills into one merged backup and eight samples, and the four stay as they were", async () => {
    const names = ["plain-prose", "copy-editor", "line-editor", "tighten-up"];
    for (const name of names) await writeSkill(join(CLAUDE, name), name, {}, `Edit prose the ${name} way.`);
    const before = await scan();
    const keys = names.map((name) => byName(before, name).key);
    const fake = account();
    const change = addMerge(fake, "writing.editing", keys);
    const writer = fakeWriter();
    const untouched = await snapshot(CLAUDE);
    const started: Array<{ merges: number; writer: string }> = [];
    const heard: Array<[string, string | null]> = [];

    const res = await runMapMerges({
      scan: before,
      client: fake.client,
      writer: async () => writer,
      onStart: (info) => started.push(info),
      onOutcome: (outcome, by) => heard.push([outcome.result, by]),
    });

    expect(started).toEqual([{ merges: 1, writer: "Test Writer" }]);
    expect(heard, "each outcome is heard as it lands").toEqual([["written", "Test Writer"]]);
    expect(res.writer).toBe("Test Writer");
    expect(res.written).toBe(1);
    expect(res.waiting).toBe(0);
    expect(res.outcomes).toEqual([{ id: change.id, job: "writing.editing", result: "written", linked: 0, private: 4 }]);

    // One merged skill, backed up privately as a merge, a lone SKILL.md under its own hash.
    expect(fake.backups.size).toBe(1);
    const [merged, body] = [...fake.backups.entries()][0]!;
    expect(body.origin).toBe("merge");
    expect(Object.keys(body.files)).toEqual(["SKILL.md"]);
    expect(canonicalContentHash(decodeBundle(body.files))).toBe(merged);
    expect(keys).not.toContain(merged);
    expect(body.name).toBe("editing-merged");
    expect(body.description).toBe("One Editing skill made from 4.");
    expect(body.tools).toEqual(["claude-code"]);

    // Eight samples: one round per original, each a fresh merged sample beside that original's.
    const ready = readyOf(fake, change.id);
    expect(ready?.merged).toBe(merged);
    expect(ready?.brief).toMatch(/^Edit this note for a stranger/);
    expect([...ready!.rounds.map((r) => r.key)].sort()).toEqual([...keys].sort());
    expect(ready!.rounds.flatMap((r) => [r.merged, r.original])).toHaveLength(8);
    expect(new Set(ready!.rounds.map((r) => r.merged)).size, "no merged sample repeats across rounds").toBe(4);
    for (const round of ready!.rounds) {
      expect(round.merged).toMatch(/^Sample \d+ by editing-merged for: /);
      expect(round.original).toContain(`by ${byName(before, names[keys.indexOf(round.key)]!).name} for: `);
    }
    expect(writer.calls.filter((c) => c === "sample merged")).toHaveLength(4);
    expect(writer.calls.filter((c) => c === "sample original")).toHaveLength(4);
    expect(writer.calls.filter((c) => c.startsWith("merge ") || c.startsWith("brief "))).toHaveLength(2);

    // The account heard it was writing, then ready; the change is done.
    expect(fake.reports.map((r) => r.report.status)).toEqual(["writing", "ready"]);
    expect(fake.changes.get(change.id)?.outcome).toBe("written");

    // The four originals are exactly as they were (R22: nothing is replaced until a blind pick).
    expect(await snapshot(CLAUDE)).toEqual(untouched);

    // This computer records the bundle it wrote, so a later replace can check it (KTD9).
    const record = await readMapMergeRecord(change.id);
    expect(record?.merged).toBe(merged);
    expect(record?.keys).toEqual(keys);
    expect(canonicalContentHash(new Map([["SKILL.md", Buffer.from(record!.skill, "utf8")]]))).toBe(merged);
    expect(record?.storedAt).toBeTruthy();
    expect((await readMapMergeRecords()).map((r) => r.id)).toEqual([change.id]);
  });

  it("AE5: a Skillet-managed source and a local one the lookup matches are named, and an unmatched local one is counted", async () => {
    await writeSkill(join(CLAUDE, "every--house-style"), "house-style", {}, "Write in the house style.");
    await writeSkill(join(CLAUDE, "tidy-notes"), "tidy-notes", {}, "Tidy notes.");
    await writeSkill(join(CLAUDE, "my-notes"), "my-notes", {}, "My own notes.");
    const before = await scan();
    const house = byName(before, "house-style");
    const tidy = byName(before, "tidy-notes");
    const mine = byName(before, "my-notes");
    expect(house.source).toBe("skillet-added");
    expect(tidy.source).toBe("local");
    await writeState({
      version: 1,
      skills: {
        "@every/house-style": {
          slug: "house-style",
          owner: "every",
          name: "House Style",
          description: "",
          version: 3,
          hash: house.key,
          source: "registry",
          importedAt: "2026-11-01T00:00:00.000Z",
          updatedAt: "2026-11-01T00:00:00.000Z",
        },
      },
    });
    const fake = account();
    // The seeded public versions the registry's lookup finds.
    fake.published.set(house.key, { ref: "@every/house-style", name: "house-style" });
    fake.published.set(tidy.key, { ref: "@maker-one/tidy-notes", name: "tidy-notes" });
    const change = addMerge(fake, "writing.editing", [house.key, tidy.key, mine.key]);

    const res = await runMapMerges({ scan: before, client: fake.client, writer: async () => fakeWriter() });

    expect(res.outcomes).toEqual([{ id: change.id, job: "writing.editing", result: "written", linked: 2, private: 1 }]);
    const body = [...fake.backups.values()][0]!;
    expect(body.sources).toEqual([
      { key: house.key, ref: "@every/house-style", name: "House Style" },
      { key: tidy.key, ref: "@maker-one/tidy-notes", name: "tidy-notes" },
      { key: mine.key, private: true },
    ]);
    const credits = kitMapMergeCredits(body.sources!);
    expect(credits.linked.map((s) => s.ref)).toEqual(["@every/house-style", "@maker-one/tidy-notes"]);
    expect(credits.privateLabel).toBe("1 private skill");
    // R24: the merge is a private backup; nothing about it is published.
    expect(body.origin).toBe("merge");
  });

  it("a Skillet-managed source no public version matches is counted, never named", async () => {
    await writeSkill(join(CLAUDE, "acme--team-voice"), "team-voice", {}, "The team's voice.");
    await writeSkill(join(CLAUDE, "my-voice"), "my-voice", {}, "My voice.");
    const before = await scan();
    const team = byName(before, "team-voice");
    const mine = byName(before, "my-voice");
    const fake = account();
    addMerge(fake, "writing.editing", [team.key, mine.key]);

    await runMapMerges({ scan: before, client: fake.client, writer: async () => fakeWriter() });

    const body = [...fake.backups.values()][0]!;
    expect(body.sources).toEqual([
      { key: team.key, private: true },
      { key: mine.key, private: true },
    ]);
    expect(JSON.stringify(body.sources)).not.toContain("acme");
  });

  it("a writer that reports a tool call fails the merge: no backup or sample is stored, and it waits with the reason", async () => {
    await writeSkill(join(CLAUDE, "plain-prose"), "plain-prose");
    await writeSkill(join(CLAUDE, "copy-editor"), "copy-editor");
    const before = await scan();
    const fake = account();
    const change = addMerge(fake, "writing.editing", [byName(before, "plain-prose").key, byName(before, "copy-editor").key]);
    const writer = fakeWriter({
      async merge() {
        throw new MergeWriterError("tool-call");
      },
    });

    const res = await runMapMerges({ scan: before, client: fake.client, writer: async () => writer });

    expect(res.outcomes).toEqual([{ id: change.id, job: "writing.editing", result: "waiting", reason: "tool-call" }]);
    expect(res.written).toBe(0);
    expect(res.waiting).toBe(1);
    expect(fake.backups.size).toBe(0);
    expect(readyOf(fake, change.id)).toBeUndefined();
    expect(fake.reports.at(-1)?.report).toEqual({ status: "failed", reason: "tool-call" });
    expect(fake.changes.get(change.id)?.outcome, "it stays waiting").toBeUndefined();
    expect(await readMapMergeRecord(change.id)).toBeNull();
  });

  it("a run nobody started leaves a merge that failed in the last day alone, so a failing merge doesn't spend the person's AI tool on every sync", async () => {
    await writeSkill(join(CLAUDE, "plain-prose"), "plain-prose");
    await writeSkill(join(CLAUDE, "copy-editor"), "copy-editor");
    const before = await scan();
    const fake = account();
    const change = addMerge(fake, "writing.editing", [byName(before, "plain-prose").key, byName(before, "copy-editor").key]);
    const failedAt = 1_800_000_000;
    fake.records.set(change.id, { id: change.id, device: "dev-test", job: "writing.editing", keys: change.keys, status: "failed", reason: "tool-call", updatedAt: failedAt });
    const writer = fakeWriter();

    const soon = await runMapMerges({ scan: before, client: fake.client, writer: async () => writer, unattended: true, now: () => failedAt + 23 * 3600 });
    expect(soon.outcomes).toEqual([{ id: change.id, job: "writing.editing", result: "waiting", reason: "tool-call" }]);
    expect(writer.calls, "the AI tool isn't run").toEqual([]);
    expect(fake.reports, "nothing is reported").toEqual([]);

    const nextDay = await runMapMerges({ scan: before, client: fake.client, writer: async () => writer, unattended: true, now: () => failedAt + 25 * 3600 });
    expect(nextDay.written, "a day later it tries again").toBe(1);
  });

  it("a Save tries a merge that just failed again right away", async () => {
    await writeSkill(join(CLAUDE, "plain-prose"), "plain-prose");
    await writeSkill(join(CLAUDE, "copy-editor"), "copy-editor");
    const before = await scan();
    const fake = account();
    const change = addMerge(fake, "writing.editing", [byName(before, "plain-prose").key, byName(before, "copy-editor").key]);
    const failedAt = 1_800_000_000;
    fake.records.set(change.id, { id: change.id, device: "dev-test", job: "writing.editing", keys: change.keys, status: "failed", reason: "writer-failed", updatedAt: failedAt });

    const res = await runMapMerges({ scan: before, client: fake.client, writer: async () => fakeWriter(), now: () => failedAt + 60 });

    expect(res.written).toBe(1);
  });

  it("with no supported AI tool, the merge stays waiting and says why", async () => {
    await writeSkill(join(CLAUDE, "plain-prose"), "plain-prose");
    await writeSkill(join(CLAUDE, "copy-editor"), "copy-editor");
    const before = await scan();
    const fake = account();
    const change = addMerge(fake, "writing.editing", [byName(before, "plain-prose").key, byName(before, "copy-editor").key]);
    const started: unknown[] = [];

    const res = await runMapMerges({
      scan: before,
      client: fake.client,
      writer: () => findMergeWriter(fixtureSearch(EMPTY_BIN)),
      onStart: (info) => started.push(info),
    });

    expect(res.writer).toBeNull();
    expect(started, "nothing is written, so nothing starts").toEqual([]);
    expect(res.outcomes).toEqual([{ id: change.id, job: "writing.editing", result: "waiting", reason: "no-ai-tool" }]);
    expect(fake.reports).toEqual([{ id: change.id, report: { status: "failed", reason: "no-ai-tool" } }]);
    expect(fake.changes.get(change.id)?.outcome).toBeUndefined();
    expect(fake.backups.size).toBe(0);
  });

  it("a writer that takes too long leaves the merge waiting with the reason", async () => {
    await writeSkill(join(CLAUDE, "plain-prose"), "plain-prose");
    await writeSkill(join(CLAUDE, "copy-editor"), "copy-editor");
    const before = await scan();
    const fake = account();
    const change = addMerge(fake, "writing.editing", [byName(before, "plain-prose").key, byName(before, "copy-editor").key]);
    const writer = fakeWriter({ merge: () => new Promise<string>(() => undefined) });

    const startedAt = Date.now();
    const res = await runMapMerges({ scan: before, client: fake.client, writer: async () => writer, limits: { callMs: 100 } });

    expect(Date.now() - startedAt).toBeLessThan(5_000);
    expect(res.outcomes).toEqual([{ id: change.id, job: "writing.editing", result: "waiting", reason: "timeout" }]);
    expect(fake.reports.at(-1)?.report).toEqual({ status: "failed", reason: "timeout" });
    expect(fake.changes.get(change.id)?.outcome).toBeUndefined();
    expect(fake.backups.size).toBe(0);
  });

  it("a merge written while the account was out of reach is stored on the next run without writing it again", async () => {
    await writeSkill(join(CLAUDE, "plain-prose"), "plain-prose");
    await writeSkill(join(CLAUDE, "copy-editor"), "copy-editor");
    const before = await scan();
    const fake = account();
    const change = addMerge(fake, "writing.editing", [byName(before, "plain-prose").key, byName(before, "copy-editor").key]);
    fake.fail.report = (_id, report) => report.status === "ready";

    const first = await runMapMerges({ scan: before, client: fake.client, writer: async () => fakeWriter() });
    expect(first.outcomes).toEqual([{ id: change.id, job: "writing.editing", result: "waiting", reason: "registry-unreachable" }]);
    const written = await readMapMergeRecord(change.id);
    expect(written?.storedAt).toBeUndefined();
    expect(fake.changes.get(change.id)?.outcome).toBeUndefined();

    fake.fail.report = undefined;
    const again = fakeWriter();
    const second = await runMapMerges({ scan: before, client: fake.client, writer: async () => again });

    expect(second.written).toBe(1);
    expect(again.calls, "no model call the second time").toEqual([]);
    expect(readyOf(fake, change.id)?.merged).toBe(written?.merged);
    expect(readyOf(fake, change.id)?.rounds).toEqual(written?.rounds);
    expect(fake.changes.get(change.id)?.outcome).toBe("written");
  });

  it("a merge the account already holds as ready is acknowledged and never written again", async () => {
    await writeSkill(join(CLAUDE, "plain-prose"), "plain-prose");
    await writeSkill(join(CLAUDE, "copy-editor"), "copy-editor");
    const before = await scan();
    const fake = account();
    const keys = [byName(before, "plain-prose").key, byName(before, "copy-editor").key];
    const change = addMerge(fake, "writing.editing", keys);
    fake.records.set(change.id, { id: change.id, device: "dev-test", job: "writing.editing", keys, status: "ready", merged: hashOf("m"), updatedAt: 1 });
    const writer = fakeWriter();

    const res = await runMapMerges({ scan: before, client: fake.client, writer: async () => writer });

    expect(writer.calls).toEqual([]);
    expect(res.outcomes).toEqual([]);
    expect(fake.changes.get(change.id)?.outcome).toBe("written");
  });

  it("a merge whose original changed since it was drafted is out of date: acknowledged, never written", async () => {
    await writeSkill(join(CLAUDE, "plain-prose"), "plain-prose");
    const before = await scan();
    const fake = account();
    const change = addMerge(fake, "writing.editing", [byName(before, "plain-prose").key, hashOf("an edited copy-editor")]);
    const writer = fakeWriter();

    const res = await runMapMerges({ scan: before, client: fake.client, writer: async () => writer });

    expect(writer.calls).toEqual([]);
    expect(res.outcomes).toEqual([{ id: change.id, job: "writing.editing", result: "dropped", reason: "sources-changed" }]);
    expect(fake.reports).toEqual([{ id: change.id, report: { status: "out-of-date", reason: "sources-changed" } }]);
    expect(fake.changes.get(change.id)?.outcome).toBe("out-of-date");
  });

  it("a recorded merge naming a plugin's skill or a skill with files beside its SKILL.md is refused before any writing", async () => {
    await writePlugin("tidy-prose");
    await writeSkill(join(CLAUDE, "plain-prose"), "plain-prose");
    await writeSkill(join(CLAUDE, "copy-editor"), "copy-editor", { "references/style.md": "Short sentences.\n" });
    await writeSkill(join(CLAUDE, "line-editor"), "line-editor");
    const before = await scan();
    const fake = account();
    const plugin = addMerge(fake, "writing.editing", [byName(before, "tidy-prose").key, byName(before, "plain-prose").key]);
    const extra = addMerge(fake, "writing.editing", [byName(before, "copy-editor").key, byName(before, "line-editor").key]);
    const writer = fakeWriter();
    const plugins = await snapshot(join(HOME, ".claude"));

    const res = await runMapMerges({ scan: before, client: fake.client, writer: async () => writer });

    expect(writer.calls).toEqual([]);
    expect(res.outcomes).toEqual([
      { id: plugin.id, job: "writing.editing", result: "dropped", reason: "not-mergeable" },
      { id: extra.id, job: "writing.editing", result: "dropped", reason: "not-mergeable" },
    ]);
    expect(fake.changes.get(plugin.id)?.outcome).toBe("not-mergeable");
    expect(fake.changes.get(extra.id)?.outcome).toBe("not-mergeable");
    expect(fake.backups.size).toBe(0);
    expect(await snapshot(join(HOME, ".claude"))).toEqual(plugins);
  });

  it("refuses merged text that isn't a skill, and stores nothing", async () => {
    await writeSkill(join(CLAUDE, "plain-prose"), "plain-prose");
    await writeSkill(join(CLAUDE, "copy-editor"), "copy-editor");
    const before = await scan();
    const fake = account();
    const change = addMerge(fake, "writing.editing", [byName(before, "plain-prose").key, byName(before, "copy-editor").key]);
    const writer = fakeWriter({ merge: async () => "Sure! I merged them, here are my thoughts." });

    const res = await runMapMerges({ scan: before, client: fake.client, writer: async () => writer });

    expect(res.outcomes).toEqual([{ id: change.id, job: "writing.editing", result: "waiting", reason: "bad-output" }]);
    expect(fake.backups.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The AI tool: found the way the desktop finds tools, run tool-less
// ---------------------------------------------------------------------------

describe("finding the AI tool", () => {
  it("with a sidecar-style PATH of /usr/bin:/bin, a fake claude in ~/.local/bin is still found", async () => {
    const path = await fakeTool("claude", join(HOME, ".local", "bin"), "answer");
    const tool = await findMergeTool(sidecarSearch);
    expect(tool).toEqual({ id: "claude-code", name: "Claude Code", command: path });
  });

  it("looks in the usual install folders, then PATH, and never in a PATH folder macOS protects", () => {
    const dirs = mergeToolSearchDirs({
      path: `${join(HOME, "Documents", "bin")}:/usr/bin:relative/bin:${join(HOME, "Desktop")}:/bin`,
      home: HOME,
      platform: "darwin",
    });
    expect(dirs).toEqual([
      join(HOME, ".local", "bin"),
      join(HOME, ".claude", "local"),
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
    ]);
  });

  it("prefers Claude Code, falls back to Codex, and finds nothing where neither is", async () => {
    const codex = await fakeTool("codex", FAKE_BIN, "answer");
    expect(await findMergeTool(fixtureSearch(FAKE_BIN))).toEqual({ id: "codex", name: "Codex", command: codex });
    const claude = await fakeTool("claude", join(HOME, ".claude", "local"), "answer");
    expect(await findMergeTool(fixtureSearch(FAKE_BIN))).toEqual({ id: "claude-code", name: "Claude Code", command: claude });
    expect(await findMergeTool({ path: EMPTY_BIN, home: join(HOME, "nobody"), systemDirs: [] })).toBeNull();
    expect(await findMergeWriter({ path: EMPTY_BIN, home: join(HOME, "nobody"), systemDirs: [] })).toBeNull();
  });

  it("skips a file that can't run", async () => {
    await mkdir(FAKE_BIN, { recursive: true });
    await writeFile(join(FAKE_BIN, "claude"), "not a program");
    await chmod(join(FAKE_BIN, "claude"), 0o644);
    expect(await findMergeTool(fixtureSearch(FAKE_BIN))).toBeNull();
  });
});

describe("running the AI tool with no tools (KTD12)", () => {
  const claudeTool = async (mode: ToolMode): Promise<MergeTool> => {
    await fakeTool("claude", FAKE_BIN, mode);
    const tool = await findMergeTool(fixtureSearch(FAKE_BIN));
    if (!tool) throw new Error("no fake claude");
    return tool;
  };

  it("runs claude -p from an empty folder, its tools off, its MCP servers off, the prompt on stdin", async () => {
    const tool = await claudeTool("answer");
    const text = await runMergeTool(tool, "Write a request.\nrealistic request please", { timeoutMs: 10_000 });

    expect(text).toBe("Tighten this note for a stranger: the meeting moved to Friday.");
    const [call] = toolCalls(join(HOME, "claude.log"));
    expect(call?.argv).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--tools",
      "",
      "--strict-mcp-config",
      "--mcp-config",
      '{"mcpServers":{}}',
      "--no-session-persistence",
    ]);
    expect(call?.stdin).toBe("Write a request.\nrealistic request please");
    expect(call?.cwdEntries, "it runs in an empty folder").toEqual([]);
    expect(call!.cwd.startsWith(realpathSync(tmpdir())), "a temporary folder").toBe(true);
    expect(existsSync(call!.cwd), "removed after the run").toBe(false);
    expect(call?.path.split(":")[0], "the tool's own folder leads its PATH").toBe(FAKE_BIN);
  });

  it("stops the tool at its first tool call and refuses the answer", async () => {
    const tool = await claudeTool("tool-call");
    const startedAt = Date.now();
    const err = await runMergeTool(tool, "Merge.", { timeoutMs: 15_000 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MergeWriterError);
    expect((err as MergeWriterError).reason).toBe("tool-call");
    expect(Date.now() - startedAt, "at the call, not at the timeout").toBeLessThan(10_000);
    expect(alive(toolCalls(join(HOME, "claude.log"))[0]!.pid), "and the tool is stopped").toBe(false);
  });

  it("refuses a run whose tool offers tools anyway", async () => {
    const tool = await claudeTool("init-tools");
    const err = await runMergeTool(tool, "Merge.", { timeoutMs: 15_000 }).catch((e: unknown) => e);
    expect((err as MergeWriterError).reason).toBe("tool-call");
  });

  it("stops a run that takes too long, and the tool with it", async () => {
    const tool = await claudeTool("hang");
    // Long enough for the fake tool to start and log its pid under a loaded
    // full-repo test run: at 300 ms it was sometimes killed before it logged.
    const err = await runMergeTool(tool, "Merge.", { timeoutMs: 3_000 }).catch((e: unknown) => e);
    expect((err as MergeWriterError).reason).toBe("timeout");
    const calls = toolCalls(join(HOME, "claude.log"));
    expect(calls, "the tool started before the timeout").toHaveLength(1);
    expect(alive(calls[0]!.pid)).toBe(false);
  });

  it("stops an answer past its size cap", async () => {
    const tool = await claudeTool("huge");
    const err = await runMergeTool(tool, "Merge.", { timeoutMs: 15_000 }, { maxOutputBytes: 1024 * 1024 }).catch((e: unknown) => e);
    expect((err as MergeWriterError).reason).toBe("too-large");
  });

  it("says the tool needs an update when it doesn't know a flag, and fails plainly on any other error", async () => {
    const old = await claudeTool("old");
    expect(((await runMergeTool(old, "Merge.", { timeoutMs: 10_000 }).catch((e: unknown) => e)) as MergeWriterError).reason).toBe("too-old");
    await rm(join(HOME, "claude.log"));
    const crash = await claudeTool("crash");
    expect(((await runMergeTool(crash, "Merge.", { timeoutMs: 10_000 }).catch((e: unknown) => e)) as MergeWriterError).reason).toBe(
      "writer-failed",
    );
  });

  it("stops a tool's own child too, as Codex's npm wrapper runs the real tool", async () => {
    await fakeTool("codex", FAKE_BIN, "wrapper-tool-call");
    const codex = (await findMergeTool(fixtureSearch(FAKE_BIN)))!;
    const startedAt = Date.now();
    const err = await runMergeTool(codex, "Merge.", { timeoutMs: 15_000 }).catch((e: unknown) => e);
    expect((err as MergeWriterError).reason).toBe("tool-call");
    expect(Date.now() - startedAt).toBeLessThan(10_000);
    const pids = toolCalls(join(HOME, "codex.log")).map((call) => call.pid);
    expect(pids, "the wrapper and the tool it ran").toHaveLength(2);
    for (const pid of pids) expect(alive(pid), `process ${pid}`).toBe(false);
  });

  it("stops when the run is stopped", async () => {
    const tool = await claudeTool("hang");
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);
    const err = await runMergeTool(tool, "Merge.", { timeoutMs: 15_000, signal: controller.signal }).catch((e: unknown) => e);
    expect((err as MergeWriterError).reason).toBe("stopped");
  });

  it("runs codex exec read-only, with no MCP servers, outside a git repo, and stops at its first command", async () => {
    await fakeTool("codex", FAKE_BIN, "answer");
    const codex = (await findMergeTool(fixtureSearch(FAKE_BIN)))!;
    expect(codex.id).toBe("codex");
    const text = await runMergeTool(codex, "a realistic request", { timeoutMs: 10_000 });
    expect(text).toBe("Tighten this note for a stranger: the meeting moved to Friday.");
    const [call] = toolCalls(join(HOME, "codex.log"));
    expect(call?.argv.slice(0, 5)).toEqual(["exec", "--json", "--sandbox", "read-only", "--skip-git-repo-check"]);
    expect(call?.argv.slice(5, 9)).toEqual(["--cd", call!.cwd, "-c", "mcp_servers={}"]);
    expect(call?.argv.at(-1), "the prompt comes on stdin").toBe("-");
    expect(call?.cwdEntries).toEqual([]);

    await rm(join(HOME, "codex.log"));
    await fakeTool("codex", FAKE_BIN, "tool-call");
    const err = await runMergeTool(codex, "Merge.", { timeoutMs: 15_000 }).catch((e: unknown) => e);
    expect((err as MergeWriterError).reason).toBe("tool-call");
    expect(alive(toolCalls(join(HOME, "codex.log"))[0]!.pid)).toBe(false);
  });

  it("takes the SKILL.md out of an answer that says something first, and refuses one with no front matter", () => {
    const merged = readMergedSkill("Here you go:\n\n```markdown\n---\nname: editing\ndescription: Edit prose.\n---\n\n# Editing\n```\n");
    expect(merged).toEqual({ text: "---\nname: editing\ndescription: Edit prose.\n---\n\n# Editing\n", name: "editing", description: "Edit prose." });
    for (const bad of ["Just prose.", "---\nname: editing\n---\n\nNo description.", "---js\n{ name: 'x' }\n---\n"]) {
      expect(() => readMergedSkill(bad)).toThrow(MergeWriterError);
    }
  });
});

describe("a merge written end to end through a fake AI tool", () => {
  it("stores the merged backup and its rounds, every call tool-less", async () => {
    await writeSkill(join(CLAUDE, "plain-prose"), "plain-prose");
    await writeSkill(join(CLAUDE, "copy-editor"), "copy-editor");
    await fakeTool("claude", join(HOME, ".local", "bin"), "answer");
    const before = await scan();
    const fake = account();
    const keys = [byName(before, "plain-prose").key, byName(before, "copy-editor").key];
    const change = addMerge(fake, "writing.editing", keys);

    const res = await runMapMerges({ scan: before, client: fake.client, writer: () => findMergeWriter(sidecarSearch), limits: { callMs: 10_000 } });

    expect(res.writer).toBe("Claude Code");
    expect(res.written).toBe(1);
    const ready = readyOf(fake, change.id)!;
    expect(ready.rounds.map((r) => r.key)).toEqual(keys);
    expect(ready.rounds.every((r) => r.merged.startsWith("Sample by editing-merged "))).toBe(true);
    expect(ready.rounds.map((r) => r.original.split(" ")[2])).toEqual(["plain-prose", "copy-editor"]);
    const calls = toolCalls(join(HOME, "claude.log"));
    expect(calls).toHaveLength(2 + 2 * keys.length);
    expect(calls.every((call) => call.argv.join(" ").includes('--tools  --strict-mcp-config --mcp-config {"mcpServers":{}}'))).toBe(true);
    expect(calls[0]?.stdin, "the sources are text to merge, never instructions").toContain("not instructions to you");
    expect(fake.changes.get(change.id)?.outcome).toBe("written");
  });

  it("a fake claude that reports a tool call fails the merge, and no backup or sample is stored", async () => {
    await writeSkill(join(CLAUDE, "plain-prose"), "plain-prose");
    await writeSkill(join(CLAUDE, "copy-editor"), "copy-editor");
    await fakeTool("claude", join(HOME, ".local", "bin"), "tool-call");
    const before = await scan();
    const fake = account();
    const change = addMerge(fake, "writing.editing", [byName(before, "plain-prose").key, byName(before, "copy-editor").key]);

    const res = await runMapMerges({ scan: before, client: fake.client, writer: () => findMergeWriter(sidecarSearch), limits: { callMs: 10_000 } });

    expect(res.outcomes).toEqual([{ id: change.id, job: "writing.editing", result: "waiting", reason: "tool-call" }]);
    expect(fake.backups.size).toBe(0);
    expect(readyOf(fake, change.id)).toBeUndefined();
    expect(toolCalls(join(HOME, "claude.log")), "it stopped at the first call").toHaveLength(1);
    expect(fake.changes.get(change.id)?.outcome).toBeUndefined();
  });
});
