/**
 * Usage marks for the kit map (plan U4, KTD4; R8 R11 R15; AE2).
 *
 * Every record here is synthetic and lives in a temp home: a fake
 * ~/.claude.json with a skillUsage map, fake Codex session logs whose records
 * copy the shapes Codex writes (a session_meta, world_state, developer message
 * and environment_context that list skill paths as the preamble, an `exec`
 * call that runs `cat <path>/SKILL.md`, a user message naming `$skill`), and a
 * fake route history in SKILLET_DIR. HOME and SKILLET_DIR are redirected via
 * vi.hoisted before core loads, and every call names the fixture home, so
 * nothing here reads a real config, transcript or log.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdir, readFile, readdir, rename, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { symlinksAvailable } from "./symlink-support.js";

const HOME = vi.hoisted(() => {
  const { redirectHome } = require("./helpers/redirect-home.cjs");
  return redirectHome("skillet-map-usage") as string;
});

import { readMapUsage, type MapUsageOptions, type MapUsageResult } from "../src/map/usage.js";
import type { MapScanEntry, MapScanLocation } from "../src/map/scan.js";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 16, 17, 0, 0);
const ago = (days: number): number => NOW - days * DAY;
const iso = (ms: number): string => new Date(ms).toISOString();

const CLAUDE_SKILLS = join(HOME, ".claude", "skills");
const AGENTS_SKILLS = join(HOME, ".agents", "skills");
const CODEX_SKILLS = join(HOME, ".codex", "skills");
const SESSIONS = join(HOME, ".codex", "sessions");
const skillMd = (folder: string): string => join(folder, "SKILL.md");

// ---------------------------------------------------------------------------
// Scan entries
// ---------------------------------------------------------------------------

function loc(path: string, tools: string[], extra: Partial<MapScanLocation> = {}): MapScanLocation {
  return { path, tools, source: "local", owner: null, linkTarget: null, skillet: null, ...extra };
}

let keyCount = 0;
function entry(name: string, ...locations: MapScanLocation[]): MapScanEntry {
  const tools: string[] = [];
  const copies: Record<string, number> = {};
  for (const location of locations) {
    for (const tool of location.tools) {
      if (!tools.includes(tool)) tools.push(tool);
      copies[tool] = (copies[tool] ?? 0) + 1;
    }
  }
  return {
    key: `sha256:${createHash("sha256").update(`${name}#${++keyCount}`).digest("hex")}`,
    name,
    description: `${name} helper`,
    source: locations[0]!.source,
    owner: locations[0]!.owner,
    tools,
    copies,
    locations,
    jobId: null,
    flags: { cantBackUp: [], cantMerge: [] },
  };
}

const claudeSkill = (folder: string): MapScanEntry =>
  entry(folder, loc(join(CLAUDE_SKILLS, folder), ["claude-code"]));
const codexSkill = (folder: string): MapScanEntry =>
  entry(folder, loc(join(CODEX_SKILLS, folder), ["codex"]));

// ---------------------------------------------------------------------------
// Claude Code's config, Codex's sessions, Skillet's route history
// ---------------------------------------------------------------------------

async function writeText(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

async function claudeConfig(value: unknown, path = join(HOME, ".claude.json")): Promise<void> {
  await writeText(path, typeof value === "string" ? value : JSON.stringify(value, null, 2));
}

/** A config whose record started `sinceDays` ago, with these skills' last runs. */
function claudeRecord(sinceDays: number, lastRuns: Record<string, number>): unknown {
  return {
    numStartups: 12,
    firstStartTime: iso(ago(sinceDays)),
    skillUsage: Object.fromEntries(
      Object.entries(lastRuns).map(([key, daysAgo]) => [key, { lastUsedAt: ago(daysAgo) }]),
    ),
  };
}

const pad = (n: number): string => String(n).padStart(2, "0");
let sessionCount = 0;

/**
 * One rollout file in Codex's `sessions/YYYY/MM/DD/` layout, named for when
 * its session started and last written `daysAgo` days ago. `build` gets the
 * start time.
 */
async function session(
  daysAgo: number,
  build: (t: number) => object[],
  startedDaysAgo = daysAgo,
): Promise<string> {
  const touched = ago(daysAgo);
  const t = ago(startedDaysAgo) - 60_000;
  const start = new Date(t);
  const [y, m, d] = [String(start.getFullYear()), pad(start.getMonth() + 1), pad(start.getDate())];
  const stamp = `${y}-${m}-${d}T${pad(start.getHours())}-${pad(start.getMinutes())}-${pad(start.getSeconds())}`;
  const id = `00000000-0000-4000-8000-${String(++sessionCount).padStart(12, "0")}`;
  const file = join(SESSIONS, y, m, d, `rollout-${stamp}-${id}.jsonl`);
  await writeText(file, build(t).map((record) => JSON.stringify(record)).join("\n") + "\n");
  await utimes(file, touched / 1000, touched / 1000);
  return file;
}

/** What opens every session: each line names every skill's SKILL.md, and none is a run. */
function preamble(t: number, skillFiles: string[]): object[] {
  const listing = skillFiles
    .map((file) => `- ${basename(dirname(file))}: test helper (file: ${file})`)
    .join("\n");
  return [
    {
      timestamp: iso(t),
      type: "session_meta",
      payload: {
        id: "test-session",
        timestamp: iso(t),
        cwd: "/tmp/test-project",
        originator: "codex_cli_rs",
        cli_version: "0.0.0-test",
        source: "cli",
        base_instructions: { text: `## Skills\n${listing}` },
      },
    },
    { timestamp: iso(t), type: "world_state", payload: { skills: skillFiles } },
    {
      timestamp: iso(t),
      type: "response_item",
      payload: {
        type: "message",
        role: "developer",
        content: [{ type: "input_text", text: `<skills_instructions>\n## Skills\n${listing}\n</skills_instructions>` }],
      },
    },
    {
      timestamp: iso(t),
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: `<environment_context>\n  <cwd>/tmp/test-project</cwd>\n  <path>${skillFiles[0] ?? ""}</path>\n</environment_context>`,
          },
        ],
      },
    },
    {
      timestamp: iso(t),
      type: "turn_context",
      payload: { cwd: "/tmp/test-project", approval_policy: "never", model: "test-model" },
    },
  ];
}

/** The model reads a skill the way Codex does: an `exec` call that cats its SKILL.md. */
function execRead(t: number, file: string): object[] {
  return [
    {
      timestamp: iso(t),
      type: "response_item",
      payload: { type: "custom_tool_call", status: "completed", call_id: `call_${t}`, name: "exec", input: `cat ${file}` },
    },
    {
      timestamp: iso(t + 1_000),
      type: "response_item",
      payload: {
        type: "custom_tool_call_output",
        call_id: `call_${t}`,
        output: "---\nname: test\ndescription: test helper\n---\n\nBody.\n",
      },
    },
  ];
}

function userSays(t: number, text: string): object {
  return {
    timestamp: iso(t),
    type: "response_item",
    payload: { type: "message", role: "user", content: [{ type: "input_text", text }] },
  };
}

/** A tool this reader has never seen, reading a SKILL.md. */
function mysteryRead(t: number, file: string): object {
  return {
    timestamp: iso(t),
    type: "response_item",
    payload: { type: "function_call", name: "fetch_skill_text", arguments: JSON.stringify({ path: file }), call_id: `call_${t}` },
  };
}

async function routeHistory(skills: Record<string, number>): Promise<void> {
  const rows = Object.fromEntries(
    Object.entries(skills).map(([ref, daysAgo]) => [
      ref,
      { count: 2, firstUsed: iso(ago(daysAgo + 5)), lastUsed: iso(ago(daysAgo)), runtimes: { "claude-code": 2 } },
    ]),
  );
  await writeText(join(process.env["SKILLET_DIR"]!, "route-history.json"), JSON.stringify({ version: 1, skills: rows }));
}

// ---------------------------------------------------------------------------

function usage(entries: MapScanEntry[], opts: Partial<MapUsageOptions> = {}): Promise<MapUsageResult> {
  return readMapUsage({
    scan: { entries, tools: [...new Set(entries.flatMap((e) => e.tools))] },
    home: HOME,
    claudeConfigDir: null,
    codexDir: join(HOME, ".codex"),
    now: NOW,
    clock: () => NOW,
    ...opts,
  });
}

function toolLine(result: MapUsageResult, tool: string) {
  const line = result.tools.find((t) => t.tool === tool);
  expect(line, `a header line for ${tool}`).toBeDefined();
  return line!;
}

beforeEach(async () => {
  await rm(HOME, { recursive: true, force: true });
  await mkdir(HOME, { recursive: true });
});

describe("readMapUsage: Claude Code's skillUsage record", () => {
  it("a run 3 days ago marks the skill used", async () => {
    const pdf = claudeSkill("pdf");
    await claudeConfig(claudeRecord(200, { pdf: 3 }));

    const result = await usage([pdf]);

    expect(result.marks[pdf.key]).toMatchObject({
      state: "used",
      reason: null,
      ranIn: ["claude-code"],
      lastRunAt: ago(3),
      gaps: [],
      text: "Ran 3 days ago.",
    });
    expect(toolLine(result, "claude-code")).toMatchObject({ history: "read", reasons: [] });
  });

  it("a last run 45 days ago, with records since 200 days ago, marks it unused", async () => {
    const pdf = claudeSkill("pdf");
    await claudeConfig(claudeRecord(200, { pdf: 45 }));

    const result = await usage([pdf]);

    expect(result.marks[pdf.key]).toMatchObject({
      state: "unused",
      reason: "no-recent-run",
      ranIn: [],
      lastRunAt: ago(45),
      gaps: [],
      text: "No run in 30 days. Last ran 45 days ago.",
    });
  });

  it("no entry, with records since 10 days ago, leaves it unknown and says Claude Code has 10 days of records", async () => {
    const pdf = claudeSkill("pdf");
    await claudeConfig(claudeRecord(10, { other: 2 }));

    const result = await usage([pdf]);

    expect(result.marks[pdf.key]).toMatchObject({
      state: "unknown",
      reason: "short-history",
      gaps: [{ tool: "claude-code", reason: "short-history", days: 10 }],
      text: "Claude Code has 10 days of records.",
    });
    expect(toolLine(result, "claude-code")).toMatchObject({
      history: "short",
      days: 10,
      reasons: ["short-history"],
      text: "Claude Code has 10 days of records.",
    });
  });

  it("no entry while the record holds 100 entries leaves it unknown, and a listed skill run long ago is still unused", async () => {
    const missing = claudeSkill("missing");
    const legacy = claudeSkill("legacy");
    const lastRuns: Record<string, number> = { legacy: 60 };
    for (let i = 0; i < 99; i++) lastRuns[`filler-${i}`] = 1;
    await claudeConfig(claudeRecord(200, lastRuns));

    const result = await usage([missing, legacy]);

    expect(result.marks[missing.key]).toMatchObject({
      state: "unknown",
      reason: "capped",
      gaps: [{ tool: "claude-code", reason: "capped" }],
    });
    expect(result.marks[legacy.key]).toMatchObject({ state: "unused", reason: "no-recent-run" });
    expect(toolLine(result, "claude-code")).toMatchObject({ history: "read", reasons: ["capped"] });
  });

  it("a Skillet-managed copy matches through its _local--<slug> folder name", async () => {
    const brief = entry(
      "brief",
      loc(join(CLAUDE_SKILLS, "_local--brief"), ["claude-code"], {
        source: "skillet-imported",
        skillet: { maker: null, slug: "brief" },
      }),
    );
    await claudeConfig(claudeRecord(200, { "_local--brief": 4 }));

    const result = await usage([brief]);

    expect(result.marks[brief.key]).toMatchObject({ state: "used", ranIn: ["claude-code"], lastRunAt: ago(4) });
  });

  it("a plugin skill matches through <plugin>:<name>, and a synced one through <org>:<name>", async () => {
    const review = entry(
      "review",
      loc(join(HOME, ".claude", "plugins", "cache", "acme", "acme-tools", "1.0.0", "skills", "review"), ["claude-code"], {
        source: "plugin",
        owner: { kind: "plugin", name: "acme-tools", marketplace: "acme", enabled: true },
      }),
    );
    const handbook = entry(
      "handbook",
      loc(join(CLAUDE_SKILLS, "synced", "test-org", "handbook"), ["claude-code"], {
        source: "synced",
        owner: { kind: "organization", name: "test-org" },
      }),
    );
    await claudeConfig(claudeRecord(200, { "acme-tools:review": 1, "test-org:handbook": 6 }));

    const result = await usage([review, handbook]);

    expect(result.marks[review.key]).toMatchObject({ state: "used", lastRunAt: ago(1) });
    expect(result.marks[handbook.key]).toMatchObject({ state: "used", lastRunAt: ago(6) });
  });

  it("a malformed ~/.claude.json leaves Claude Code's skills unknown, and the pass doesn't fail", async () => {
    const pdf = claudeSkill("pdf");
    await claudeConfig("{ this is not json");

    const result = await usage([pdf]);

    expect(result.marks[pdf.key]).toMatchObject({
      state: "unknown",
      reason: "no-history",
      gaps: [{ tool: "claude-code", reason: "no-history" }],
      text: "Claude Code keeps no history Skillet can read.",
    });
    expect(toolLine(result, "claude-code")).toMatchObject({ history: "none", reasons: ["no-history"] });

    // A config with no skillUsage record at all is the same.
    await claudeConfig({ numStartups: 3, firstStartTime: iso(ago(200)) });
    expect((await usage([pdf])).marks[pdf.key]).toMatchObject({ state: "unknown", reason: "no-history" });
  });

  it("a copy in an app's folder has no usage key, so its skill stays unknown", async () => {
    const tour = entry(
      "tour",
      loc(join(CLAUDE_SKILLS, "acme-app", "skills", "tour"), ["claude-code"], {
        source: "app",
        owner: { kind: "app", name: "acme-app", folder: join(CLAUDE_SKILLS, "acme-app") },
      }),
    );
    await claudeConfig(claudeRecord(200, { other: 1 }));

    expect((await usage([tour])).marks[tour.key]).toMatchObject({
      state: "unknown",
      reason: "untracked",
      gaps: [{ tool: "claude-code", reason: "untracked" }],
    });
  });

  it("reads the config file CLAUDE_CONFIG_DIR implies instead of ~/.claude.json", async () => {
    const pdf = claudeSkill("pdf");
    const alt = join(HOME, "claude-alt");
    await claudeConfig(claudeRecord(200, { pdf: 1 }), join(alt, ".claude.json"));
    await claudeConfig(claudeRecord(200, { pdf: 90 }));

    expect((await usage([pdf], { claudeConfigDir: alt })).marks[pdf.key]).toMatchObject({ state: "used" });
    expect((await usage([pdf])).marks[pdf.key]).toMatchObject({ state: "unused" });
  });
});

describe("readMapUsage: tools with no history Skillet can read", () => {
  it("covers AE2: a skill only in Windsurf is unknown, and the reason names the tool", async () => {
    const notes = entry("notes", loc(join(HOME, ".codeium", "windsurf", "skills", "notes"), ["windsurf"]));

    const result = await usage([notes]);

    // The adapter id stays `windsurf`; its display label is Devin Desktop.
    expect(result.marks[notes.key]).toMatchObject({
      state: "unknown",
      reason: "no-history",
      gaps: [{ tool: "windsurf", reason: "no-history" }],
      text: "Devin Desktop keeps no history Skillet can read.",
    });
    expect(toolLine(result, "windsurf")).toMatchObject({ history: "none", reasons: ["no-history"] });
  });

  it("a ~/.agents/skills skill with full Codex coverage and no run stays unknown while opencode is detected", async () => {
    const notes = entry("notes", loc(join(AGENTS_SKILLS, "notes"), ["codex", "opencode"]));
    const solo = codexSkill("solo");
    const files = [skillMd(join(AGENTS_SKILLS, "notes")), skillMd(join(CODEX_SKILLS, "solo"))];
    await session(1, (t) => preamble(t, files));
    await session(40, (t) => preamble(t, files));

    const result = await usage([notes, solo]);

    expect(result.marks[notes.key]).toMatchObject({
      state: "unknown",
      reason: "no-history",
      gaps: [{ tool: "opencode", reason: "no-history" }],
      text: "opencode keeps no history Skillet can read.",
    });
    // Codex alone had the whole window, so its own skill does get the mark.
    expect(result.marks[solo.key]).toMatchObject({ state: "unused", reason: "no-recent-run" });
    expect(toolLine(result, "codex")).toMatchObject({ history: "read", reasons: [] });
    expect(toolLine(result, "opencode")).toMatchObject({ history: "none" });
  });
});

describe("readMapUsage: Codex session logs", () => {
  it("a preamble that lists a skill's path is not a run, and an exec read of its SKILL.md is", async () => {
    const tidy = codexSkill("tidy");
    const idle = codexSkill("idle");
    const files = [skillMd(join(CODEX_SKILLS, "tidy")), skillMd(join(CODEX_SKILLS, "idle"))];
    await session(2, (t) => [...preamble(t, files), ...execRead(t + 5_000, files[0]!)]);
    await session(40, (t) => preamble(t, files));

    const result = await usage([tidy, idle]);

    expect(result.marks[tidy.key]).toMatchObject({ state: "used", ranIn: ["codex"], text: "Ran 2 days ago." });
    expect(result.marks[idle.key]).toMatchObject({
      state: "unused",
      reason: "no-recent-run",
      lastRunAt: null,
      text: "No run in 30 days.",
    });
    expect(toolLine(result, "codex")).toMatchObject({ history: "read", reasons: [], text: "Read 30 days of Codex records." });
  });

  it("a user message naming a skill with $<name> counts as a run, matched as a whole name", async () => {
    const check = codexSkill("deploy-check");
    const deploy = codexSkill("deploy");
    const files = [skillMd(join(CODEX_SKILLS, "deploy-check")), skillMd(join(CODEX_SKILLS, "deploy"))];
    await session(1, (t) => [...preamble(t, files), userSays(t + 5_000, "Use $deploy-check before you push.")]);
    await session(40, (t) => preamble(t, files));

    const result = await usage([check, deploy]);

    expect(result.marks[check.key]).toMatchObject({ state: "used", ranIn: ["codex"], text: "Ran yesterday." });
    expect(result.marks[deploy.key]).toMatchObject({ state: "unused" });
  });

  it("an older Codex shell call counts too, even when it reads SKILL.md from the skill's own folder", async () => {
    const tidy = codexSkill("tidy");
    const idle = codexSkill("idle");
    const files = [skillMd(join(CODEX_SKILLS, "tidy")), skillMd(join(CODEX_SKILLS, "idle"))];
    const shell = (t: number): object => ({
      timestamp: iso(t),
      type: "response_item",
      payload: {
        type: "function_call",
        name: "shell",
        arguments: JSON.stringify({ command: ["bash", "-lc", "sed -n '1,200p' SKILL.md"], workdir: join(CODEX_SKILLS, "tidy") }),
        call_id: `call_${t}`,
      },
    });
    await session(3, (t) => [...preamble(t, files), shell(t + 5_000)]);
    await session(40, (t) => preamble(t, files));

    const result = await usage([tidy, idle]);

    expect(result.marks[tidy.key]).toMatchObject({ state: "used", ranIn: ["codex"] });
    expect(result.marks[idle.key]).toMatchObject({ state: "unused" });
  });

  it.skipIf(!symlinksAvailable)("follows a sessions folder that links to logs moved elsewhere", async () => {
    const tidy = codexSkill("tidy");
    const files = [skillMd(join(CODEX_SKILLS, "tidy"))];
    const read = await session(4, (t) => [...preamble(t, files), ...execRead(t + 5_000, files[0]!)]);
    await session(40, (t) => preamble(t, files));
    // Move the read's day folder to another disk and link it back.
    const day = dirname(read);
    const moved = join(HOME, "external", basename(day));
    await mkdir(dirname(moved), { recursive: true });
    await rename(day, moved);
    await symlink(moved, day, "dir");

    expect((await usage([tidy])).marks[tidy.key]).toMatchObject({ state: "used" });
  });

  it("a SKILL.md read through a tool the reader doesn't know leaves that skill unknown, and the header says so", async () => {
    const tidy = codexSkill("tidy");
    const idle = codexSkill("idle");
    const files = [skillMd(join(CODEX_SKILLS, "tidy")), skillMd(join(CODEX_SKILLS, "idle"))];
    await session(1, (t) => [...preamble(t, files), mysteryRead(t + 5_000, files[0]!)]);
    await session(40, (t) => preamble(t, files));

    const result = await usage([tidy, idle]);

    expect(result.marks[tidy.key]).toMatchObject({
      state: "unknown",
      reason: "unrecognized",
      gaps: [{ tool: "codex", reason: "unrecognized" }],
    });
    expect(result.marks[idle.key]).toMatchObject({ state: "unused" });
    const codex = toolLine(result, "codex");
    expect(codex).toMatchObject({ history: "read", reasons: ["unrecognized"] });
    expect(codex.text).toContain("Codex's records weren't recognized");
  });

  it("when the time budget runs out before the window ends, nothing is marked unused from Codex", async () => {
    const fresh = codexSkill("fresh");
    const older = codexSkill("older");
    const idle = codexSkill("idle");
    const files = ["fresh", "older", "idle"].map((name) => skillMd(join(CODEX_SKILLS, name)));
    await session(1, (t) => [...preamble(t, files), ...execRead(t + 5_000, files[0]!)]);
    await session(5, (t) => [...preamble(t, files), ...execRead(t + 5_000, files[1]!)]);
    await session(20, (t) => preamble(t, files));
    await session(45, (t) => preamble(t, files));

    // The clock is read when the pass starts and before each file. Each look
    // costs a second here, so a 1.5-second budget covers the newest file only.
    let looks = 0;
    const result = await usage([fresh, older, idle], { clock: () => NOW + 1_000 * looks++, codexBudgetMs: 1_500 });

    expect(result.marks[fresh.key]).toMatchObject({ state: "used", ranIn: ["codex"] });
    expect(result.marks[older.key]).toMatchObject({
      state: "unknown",
      reason: "not-all-read",
      gaps: [{ tool: "codex", reason: "not-all-read", days: 5 }],
    });
    expect(result.marks[idle.key]).toMatchObject({ state: "unknown", reason: "not-all-read" });
    expect(toolLine(result, "codex")).toMatchObject({ history: "short", days: 5, reasons: ["not-all-read"] });

    // With time to spare, the same logs read to the end of the window.
    const full = await usage([fresh, older, idle]);
    expect(full.marks[older.key]).toMatchObject({ state: "used" });
    expect(full.marks[idle.key]).toMatchObject({ state: "unused" });
  });

  it("a Codex that keeps fewer than 30 days of sessions leaves its skills unknown", async () => {
    const idle = codexSkill("idle");
    const files = [skillMd(join(CODEX_SKILLS, "idle"))];
    await session(1, (t) => preamble(t, files));
    await session(12, (t) => preamble(t, files));

    const result = await usage([idle]);

    expect(result.marks[idle.key]).toMatchObject({
      state: "unknown",
      reason: "short-history",
      gaps: [{ tool: "codex", reason: "short-history", days: 12 }],
      text: "Codex has 12 days of records.",
    });
    expect(toolLine(result, "codex")).toMatchObject({ history: "short", days: 12 });
  });

  it("with no Codex sessions on the computer, Codex's skills are unknown", async () => {
    const idle = codexSkill("idle");

    const result = await usage([idle]);

    expect(result.marks[idle.key]).toMatchObject({
      state: "unknown",
      reason: "no-history",
      gaps: [{ tool: "codex", reason: "no-history" }],
    });
    expect(toolLine(result, "codex")).toMatchObject({ history: "none" });
  });

  it("a read recorded before the window doesn't count, even in a file written since", async () => {
    const stale = codexSkill("stale");
    const files = [skillMd(join(CODEX_SKILLS, "stale"))];
    // One long session: it started 41 days ago and was last written yesterday.
    await session(
      1,
      (t) => [...preamble(t, files), ...execRead(t + DAY, files[0]!), userSays(ago(1) - 9_000, "Thanks.")],
      41,
    );

    const result = await usage([stale]);

    expect(result.marks[stale.key]).toMatchObject({ state: "unused", reason: "no-recent-run" });
  });
});

describe("readMapUsage: Skillet's route history", () => {
  it("a /skillet route 2 days ago marks the skill used even with no tool record", async () => {
    const brief = entry(
      "brief",
      loc(join(CLAUDE_SKILLS, "test-maker--brief"), ["claude-code"], {
        source: "skillet-added",
        skillet: { maker: "test-maker", slug: "brief" },
      }),
    );
    await claudeConfig(claudeRecord(200, { other: 1 }));
    await routeHistory({ "@test-maker/brief": 2 });

    const result = await usage([brief]);

    expect(result.marks[brief.key]).toMatchObject({ state: "used", ranIn: ["skillet"], lastRunAt: ago(2) });
  });
});

describe("readMapUsage: read on the computer only", () => {
  async function snapshot(dir: string): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const name of await readdir(dir, { recursive: true, withFileTypes: true })) {
      if (!name.isFile()) continue;
      const path = join(name.parentPath, name.name);
      out[path] = createHash("sha256").update(await readFile(path)).digest("hex");
    }
    return out;
  }

  it("the marks hold no paths or record text, and the pass writes nothing", async () => {
    const pdf = claudeSkill("pdf");
    const tidy = codexSkill("tidy");
    const files = [skillMd(join(CODEX_SKILLS, "tidy"))];
    await claudeConfig(claudeRecord(200, { pdf: 3 }));
    await session(1, (t) => [...preamble(t, files), userSays(t + 5_000, "Run $tidy on the quarterly-figures folder.")]);
    await session(40, (t) => preamble(t, files));
    await routeHistory({ "@test-maker/brief": 2 });
    const before = await snapshot(HOME);

    const result = await usage([pdf, tidy]);

    expect(result.marks[tidy.key]).toMatchObject({ state: "used" });
    const sent = JSON.stringify(result);
    for (const leak of [HOME, ".claude", "SKILL.md", "quarterly-figures", "test-session", "/tmp/test-project"]) {
      expect(sent).not.toContain(leak);
    }
    expect(await snapshot(HOME)).toEqual(before);
  });
});
