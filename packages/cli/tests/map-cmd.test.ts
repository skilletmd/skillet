/**
 * `skillet map` (plan U6, KTD1 KTD5; R2 R5 R15, AE4).
 *
 * The end-to-end runs spawn the CLI from source with HOME, SKILLET_DIR and the
 * XDG folders inside a throwaway fixture, Claude Code's and Hermes's own
 * overrides scrubbed, and the registry and web pointed at local trap servers
 * that record every request. The rest drive the command in process against a
 * made-up scan, so nothing reads the real home.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readdir, readFile, readlink, rm, stat, writeFile } from "node:fs/promises";
import { createServer, request as httpRequest, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Command } from "commander";
import type { MapScanEntry, MapScanResult, MapUsageResult } from "@skillet/core";
import { parseKitMapScan, type KitMapEntry, type KitMapScan } from "@skillet/protocol/kit-map";
import { registerAllCommands } from "../src/commands/register-all.js";
import {
  countLine,
  hasLocalConnection,
  startMap,
  textSummary,
  toKitMapScan,
  type MapReading,
  type MapRun,
  type StartMapOptions,
} from "../src/commands/map-cmd.js";
import { MAP_TOKEN_HEADER } from "../src/map/shell-page.js";

const CLI_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI_SRC = join(CLI_ROOT, "src", "index.ts");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface Fixture {
  root: string;
  home: string;
  skilletDir: string;
}

function skillMd(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nBody for ${name}.\n`;
}

async function writeSkill(dir: string, name: string, description: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), skillMd(name, description));
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2));
}

/**
 * A home with Claude Code and Codex: a skill both load, a Claude-only skill
 * Claude Code's record says hasn't run, and an enabled plugin's skill. The
 * Skillet folder sits outside it and is empty: this computer isn't connected.
 */
async function makeFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "skillet-map-cmd-"));
  const home = join(root, "home");
  const skilletDir = join(root, "skillet");
  await mkdir(skilletDir, { recursive: true });

  const claude = join(home, ".claude", "skills");
  await writeSkill(join(claude, "plain-prose"), "plain-prose", "Edit prose so it reads plainly");
  await writeSkill(join(home, ".agents", "skills", "plain-prose"), "plain-prose", "Edit prose so it reads plainly");
  await writeSkill(join(claude, "copy-editor"), "copy-editor", "Copy edit a draft before it ships");
  await mkdir(join(home, ".codex"), { recursive: true });

  const plugin = join(home, ".claude", "plugins", "cache", "market", "alpha", "1.0.0");
  await writeSkill(join(plugin, "skills", "code-review"), "code-review", "Review a pull request for bugs");
  await writeJson(join(home, ".claude", "plugins", "installed_plugins.json"), {
    version: 2,
    plugins: { "alpha@market": [{ scope: "user", installPath: plugin, version: "1.0.0" }] },
  });
  await writeJson(join(home, ".claude", "settings.json"), { enabledPlugins: { "alpha@market": true } });

  const day = 86_400_000;
  await writeJson(join(home, ".claude.json"), {
    firstStartTime: new Date(Date.now() - 90 * day).toISOString(),
    skillUsage: { "plain-prose": { usageCount: 3, lastUsedAt: Date.now() - day } },
  });
  return { root, home, skilletDir };
}

/** Every path under `dir` with its kind, size, mtime and content hash; directories carry their mtime, so a file made and deleted still shows. */
async function snapshot(dir: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const walk = async (path: string): Promise<void> => {
    const info = await lstat(path);
    if (info.isSymbolicLink()) {
      out.set(path, `link ${await readlink(path)} ${info.mtimeMs}`);
    } else if (info.isDirectory()) {
      out.set(path, `dir ${info.mtimeMs}`);
      for (const name of (await readdir(path)).sort()) await walk(join(path, name));
    } else {
      const hash = createHash("sha256").update(await readFile(path)).digest("hex");
      out.set(path, `file ${info.size} ${info.mtimeMs} ${hash}`);
    }
  };
  await walk(dir);
  return out;
}

interface Trap {
  url: string;
  hits: string[];
  close: () => Promise<void>;
}

/** A server that records every request it gets and answers none of them usefully. */
async function trap(): Promise<Trap> {
  const hits: string[] = [];
  const server: Server = createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    res.writeHead(500);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}`,
    hits,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

const SCRUBBED = [
  "CLAUDE_CONFIG_DIR",
  "HERMES_HOME",
  "CODEX_HOME",
  "SKILLET_TOKEN",
  "SKILLET_TOKEN_FORCE",
  "SKILLET_SKILL_ROOTS",
  "SKILLET_ACTIVITY",
  "SKILLET_TCC_POLICY",
  "SKILLET_TCC_CONTEXT",
  "SKILLET_FORCE_COLOR",
  "SKILLET_DEBUG",
  "SKILLET_DAEMON",
];

function childEnv(fx: Fixture, registry: string, web: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of SCRUBBED) delete env[key];
  return {
    ...env,
    HOME: fx.home,
    USERPROFILE: fx.home,
    SKILLET_DIR: fx.skilletDir,
    XDG_CONFIG_HOME: join(fx.home, ".config"),
    XDG_DATA_HOME: join(fx.home, ".local", "share"),
    SKILLET_REGISTRY_URL: registry,
    SKILLET_REGISTRY: registry,
    SKILLET_WEB_URL: web,
  };
}

/** Node with tsx, from this package (so `tsx/esm` resolves), running the CLI's source. */
function cliArgs(args: string[]): string[] {
  return ["--import", "tsx/esm", CLI_SRC, ...args];
}

function waitForLine(child: ChildProcessWithoutNullStreams, pattern: RegExp, timeoutMs: number): Promise<RegExpExecArray> {
  return new Promise((resolve, reject) => {
    let out = "";
    let err = "";
    const timer = setTimeout(() => reject(new Error(`no line matching ${pattern} in ${timeoutMs} ms\nstdout: ${out}\nstderr: ${err}`)), timeoutMs);
    child.stderr.on("data", (chunk: Buffer) => {
      err += chunk.toString("utf8");
    });
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
      const match = pattern.exec(out);
      if (match) {
        clearTimeout(timer);
        resolve(match);
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`exited ${code} before ${pattern}\nstdout: ${out}\nstderr: ${err}`));
    });
  });
}

function collect(child: ChildProcessWithoutNullStreams): { stdout: () => string; exit: Promise<number | null> } {
  let out = "";
  child.stdout.on("data", (chunk: Buffer) => {
    out += chunk.toString("utf8");
  });
  const exit = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
  return { stdout: () => out, exit };
}

interface Reply {
  status: number;
  body: string;
}

function send(url: string, opts: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method: opts.method ?? "GET", headers: opts.headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

function postTo(origin: string, token: string, message: unknown): Promise<Reply> {
  return send(`${origin}/${token}/message`, {
    method: "POST",
    headers: { "content-type": "application/json", [MAP_TOKEN_HEADER]: token, origin },
    body: JSON.stringify(message),
  });
}

// ---------------------------------------------------------------------------
// AE4 and --json, end to end
// ---------------------------------------------------------------------------

test("AE4: `skillet map --no-open` on an unconnected computer writes nothing and calls no one, even after drafting fixes", { timeout: 60_000 }, async () => {
  const fx = await makeFixture();
  const registry = await trap();
  const web = await trap();
  try {
    const before = { home: await snapshot(fx.home), skillet: await snapshot(fx.skilletDir) };
    const child = spawn(process.execPath, cliArgs(["map", "--no-open"]), {
      cwd: CLI_ROOT,
      env: childEnv(fx, registry.url, web.url),
    });
    const output = collect(child);
    const [, url, origin, token] = await waitForLine(
      child,
      /Open ((http:\/\/127\.0\.0\.1:\d+)\/([A-Za-z0-9_-]+)\/) to see your map\./,
      30_000,
    );
    assert.ok(url && origin && token);

    const page = await send(url);
    assert.equal(page.status, 200);
    assert.ok(page.body.includes(`src="${web.url}/map/embed"`), "the page frames the web's embed");

    const scanReply = await send(`${origin}/${token}/scan`);
    assert.equal(scanReply.status, 200);
    const { scan } = JSON.parse(scanReply.body) as { scan: KitMapScan };
    assert.ok(parseKitMapScan(scan), "the payload is one the frame accepts");
    assert.ok(!scanReply.body.includes(fx.root), "the payload holds no path");
    assert.equal(scan.connected, undefined, "an unpaired SKILLET_DIR is not connected");
    // Cursor, when this computer has it, loads ~/.agents/skills too, so the tool count follows the scan.
    assert.match(countLine(scan), /^Found 3 skills in [23] AI tools\.$/);
    assert.ok(output.stdout().split("\n").includes(countLine(scan)), output.stdout());

    // The person drafts a fix: remove the skill Claude Code says hasn't run.
    const unused = scan.entries.find((entry) => entry.name === "copy-editor");
    assert.ok(unused);
    assert.equal(unused.usage.state, "unused");
    const drafted = await postTo(origin, token, { type: "drafts", v: 1, drafts: [{ kind: "remove", key: unused.key }] });
    assert.equal(drafted.status, 200);

    // Closing without saving: Ctrl+C.
    child.kill("SIGINT");
    const code = await output.exit;
    assert.equal(code, 0, output.stdout());
    assert.match(output.stdout(), /Map closed\. Nothing changed\./);

    assert.deepEqual(await snapshot(fx.home), before.home, "no file under HOME changed");
    assert.deepEqual(await snapshot(fx.skilletDir), before.skillet, "no file under SKILLET_DIR changed");
    assert.deepEqual(registry.hits, [], "no registry call before Save");
    assert.deepEqual(web.hits, [], "the CLI itself never calls the web");
  } finally {
    await registry.close();
    await web.close();
    await rm(fx.root, { recursive: true, force: true });
  }
});

test("`skillet map --json` prints the scan, entries with no paths, and writes nothing", { timeout: 60_000 }, async () => {
  const fx = await makeFixture();
  const registry = await trap();
  const web = await trap();
  try {
    const before = { home: await snapshot(fx.home), skillet: await snapshot(fx.skilletDir) };
    const res = spawnSync(process.execPath, cliArgs(["map", "--json"]), {
      cwd: CLI_ROOT,
      env: childEnv(fx, registry.url, web.url),
      encoding: "utf8",
      timeout: 45_000,
    });
    assert.equal(res.status, 0, res.stderr);
    const parsed = JSON.parse(res.stdout) as { ok: boolean; scan: KitMapScan };
    assert.equal(parsed.ok, true);
    assert.ok(parseKitMapScan(parsed.scan), "a payload the frame accepts: no field it doesn't know, such as paths");
    assert.ok(!res.stdout.includes(fx.root), "no path anywhere in the output");
    assert.doesNotMatch(res.stdout, /SKILL\.md|"paths"|"locations"/);

    const byName = new Map(parsed.scan.entries.map((entry) => [entry.name, entry]));
    assert.deepEqual([...byName.keys()].sort(), ["code-review", "copy-editor", "plain-prose"]);
    const prose = byName.get("plain-prose")!;
    const proseTools = prose.tools.map((t) => t.tool);
    assert.ok(
      proseTools.includes("claude-code") && proseTools.includes("codex"),
      `a skill two tools load is one entry: ${proseTools.join(", ")}`,
    );
    assert.deepEqual(prose.usage, { state: "used", reason: null });
    assert.deepEqual(byName.get("copy-editor")!.usage, { state: "unused", reason: "no-recent-run" });
    assert.deepEqual(byName.get("code-review")!.from, { kind: "plugin", name: "alpha", on: true });
    assert.equal(byName.get("code-review")!.source, "plugin");
    assert.ok(parsed.scan.looked.some((l) => l.tool === "claude-code" && l.history === "read"));
    assert.equal(parsed.scan.connected, undefined);

    assert.deepEqual(await snapshot(fx.home), before.home);
    assert.deepEqual(await snapshot(fx.skilletDir), before.skillet);
    assert.deepEqual(registry.hits, []);
    assert.deepEqual(web.hits, []);
  } finally {
    await registry.close();
    await web.close();
    await rm(fx.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Connected, read from local files only
// ---------------------------------------------------------------------------

test("connected comes from this computer's own files, with no write", async () => {
  const dir = await mkdtemp(join(tmpdir(), "skillet-map-connected-"));
  const prior = process.env["SKILLET_DIR"];
  const priorToken = process.env["SKILLET_TOKEN"];
  process.env["SKILLET_DIR"] = dir;
  delete process.env["SKILLET_TOKEN"];
  try {
    assert.equal(await hasLocalConnection(), false, "nothing on disk");

    // A retired anonymous device file is not a connection, and reading it must not clean it up.
    const device = join(dir, "device.json");
    await writeFile(device, JSON.stringify({ device_token: "dev_test", label: "anonymous", saved_at: "2026-01-01T00:00:00.000Z" }));
    const anonymous = await stat(device);
    assert.equal(await hasLocalConnection(), false);
    const after = await stat(device);
    assert.equal(after.mtimeMs, anonymous.mtimeMs, "the anonymous file is left as it was");

    await writeFile(device, JSON.stringify({ device_token: "dev_test", label: "test-machine", saved_at: "2026-01-01T00:00:00.000Z" }));
    assert.equal(await hasLocalConnection(), true, "a paired device token");

    await rm(device);
    await writeFile(join(dir, "session.json"), JSON.stringify({ session_token: "ses_test" }));
    assert.equal(await hasLocalConnection(), true, "a signed-in session");

    await rm(join(dir, "session.json"));
    await writeFile(device, JSON.stringify({ machine_id: "m-test", saved_at: "2026-01-01T00:00:00.000Z" }));
    assert.equal(await hasLocalConnection(), false, "the sign-out stub holds no credential");
  } finally {
    if (prior === undefined) delete process.env["SKILLET_DIR"];
    else process.env["SKILLET_DIR"] = prior;
    if (priorToken !== undefined) process.env["SKILLET_TOKEN"] = priorToken;
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// The scan payload
// ---------------------------------------------------------------------------

const FAKE_HOME = "/fixture/home";

function scanEntry(over: Partial<MapScanEntry> & { key: string }): MapScanEntry {
  const path = `${FAKE_HOME}/.claude/skills/${over.name ?? "pdf"}`;
  return {
    name: "pdf",
    description: "PDF helper",
    source: "local",
    owner: null,
    tools: ["claude-code"],
    paths: { "claude-code": [path] },
    copies: { "claude-code": 1 },
    locations: [{ path, tools: ["claude-code"], source: "local", owner: null, linkTarget: null, skillet: null }],
    jobId: "business.docs-and-pdfs",
    flags: { cantBackUp: [], cantMerge: [] },
    backsUp: true,
    ...over,
  };
}

const hex = (n: number) => `sha256:${n.toString(16).padStart(64, "0")}`;

function scanResult(entries: MapScanEntry[]): MapScanResult {
  return {
    entries,
    tools: ["claude-code", "codex"],
    folders: [{ path: `${FAKE_HOME}/.claude/skills`, tools: ["claude-code"] }],
    unreadable: [
      { path: `${FAKE_HOME}/work/app`, reason: "project-plugin", tools: ["claude-code"], plugin: "gamma@market", detail: "project" },
      { path: `${FAKE_HOME}/.agents/skills/gone`, reason: "broken-link", tools: ["codex", "codex"] },
    ],
    scannedAt: "2026-11-16T00:00:00.000Z",
    durationMs: 1,
  };
}

function usageResult(marks: MapUsageResult["marks"]): MapUsageResult {
  return {
    marks,
    tools: [
      { tool: "claude-code", history: "read", reasons: [], text: "Read 30 days of Claude Code records." },
      { tool: "codex", history: "none", reasons: ["no-history"], text: "Codex keeps no history Skillet can read." },
    ],
    since: 0,
    until: 1,
  };
}

test("the scan payload holds no path, passes the frame's validator, and keeps only what the map draws", () => {
  const longName = `${"Very long name ".repeat(30)}end`;
  const entries = [
    scanEntry({
      key: hex(1),
      name: `Tab\tand\nnewline ${longName}`,
      description: "x".repeat(2000),
      tools: ["claude-code", "codex"],
      copies: { "claude-code": 2, codex: 1 },
      flags: { cantBackUp: ["links-outside", "git-folder"], cantMerge: ["extra-files"] },
      backsUp: false,
    }),
    scanEntry({
      key: hex(2),
      name: "code-review",
      source: "plugin",
      owner: { kind: "plugin", name: "alpha", marketplace: "market", enabled: false },
      flags: { cantBackUp: ["git-folder"], cantMerge: ["extra-files"] },
      backsUp: false,
      jobId: "development.code-review",
    }),
    scanEntry({ key: hex(3), name: "brand-voice", source: "synced", owner: null, backsUp: false, jobId: null }),
    scanEntry({
      key: hex(4),
      name: "helper",
      source: "app",
      owner: { kind: "app", name: "someapp", folder: `${FAKE_HOME}/.claude/skills/someapp` },
      backsUp: false,
    }),
    scanEntry({
      key: hex(5),
      name: "write-landing",
      source: "skillet-added",
      backsUp: false,
      locations: [
        {
          path: `${FAKE_HOME}/.claude/skills/openclaudia--write-landing`,
          tools: ["claude-code"],
          source: "skillet-added",
          owner: null,
          linkTarget: null,
          skillet: { maker: "openclaudia", slug: "write-landing" },
        },
      ],
    }),
    scanEntry({
      key: hex(6),
      name: "agent-browser",
      source: "skillet-imported",
      backsUp: false,
      flags: { cantBackUp: [], cantMerge: ["links-outside"] },
      locations: [
        {
          path: `${FAKE_HOME}/.claude/skills/_local--agent-browser`,
          tools: ["claude-code"],
          source: "skillet-imported",
          owner: null,
          linkTarget: null,
          skillet: { maker: null, slug: "agent-browser" },
        },
      ],
    }),
  ];
  const marks: MapUsageResult["marks"] = {
    [hex(1)]: { state: "used", reason: null, ranIn: ["claude-code"], lastRunAt: 1, gaps: [], text: "Ran today." },
    [hex(2)]: { state: "unused", reason: "no-recent-run", ranIn: [], lastRunAt: null, gaps: [], text: "No run in 30 days." },
  };

  const payload = toKitMapScan(scanResult(entries), usageResult(marks), false);
  const text = JSON.stringify(payload);
  assert.ok(!text.includes(FAKE_HOME), "no path reaches the frame");
  assert.deepEqual(parseKitMapScan(payload), payload, "the frame's validator takes it as is");
  assert.equal("connected" in payload, false, "absent means not connected");

  const [first, plugin, synced, app, added, imported] = payload.entries as KitMapEntry[];
  assert.ok(first && plugin && synced && app && added && imported);
  assert.ok(first.name.length <= 200);
  assert.doesNotMatch(first.name, /[\t\n]/);
  assert.match(first.name, /^Tab and newline Very long name/);
  assert.equal(first.description.length, 1024);
  assert.deepEqual(first.tools, [
    { tool: "claude-code", copies: 2 },
    { tool: "codex", copies: 1 },
  ]);
  assert.deepEqual(first.usage, { state: "used", reason: null });
  assert.deepEqual(first.noBackup, { reason: "links-outside" });
  assert.deepEqual(first.noMerge, { reason: "extra-files" });

  assert.deepEqual(plugin.from, { kind: "plugin", name: "alpha", on: false });
  assert.deepEqual(plugin.usage, { state: "unused", reason: "no-recent-run" });
  assert.equal(plugin.noBackup, undefined, "a plugin never backs up, so it carries no backup flag");
  assert.equal(plugin.noMerge, undefined, "a plugin is never merged, so it carries no merge flag");

  assert.deepEqual(synced.from, { kind: "organization", name: "an organization", on: null });
  assert.equal(synced.job, null);
  assert.deepEqual(synced.usage, { state: "unknown", reason: "no-history" }, "no mark reads as unknown");
  assert.deepEqual(app.from, { kind: "app", name: "someapp", on: null });
  assert.deepEqual(added.skillet, { ref: "@openclaudia/write-landing", name: "write-landing" });
  assert.deepEqual(imported.skillet, { ref: null, name: "agent-browser" });
  assert.deepEqual(imported.noMerge, { reason: "links-outside" });

  assert.deepEqual(payload.looked, [
    { tool: "claude-code", history: "read" },
    { tool: "codex", history: "none" },
  ]);
  assert.deepEqual(payload.unchecked, [
    { reason: "project-plugin", tools: ["claude-code"], plugin: "gamma@market" },
    { reason: "broken-link", tools: ["codex"] },
  ]);

  const connected = toKitMapScan(scanResult([]), usageResult({}), true);
  assert.equal(connected.connected, true);
  assert.deepEqual(connected.entries, []);
});

test("the count line names skills and the AI tools they sit in", () => {
  const base: KitMapScan = { entries: [], looked: [], unchecked: [] };
  const entry = (n: number, tools: string[]): KitMapEntry => ({
    key: hex(n),
    name: `s${n}`,
    description: "",
    source: "local",
    tools: tools.map((tool) => ({ tool, copies: 1 })),
    job: null,
    usage: { state: "unknown", reason: "no-history" },
  });
  assert.equal(countLine(base), "Found no skills.");
  assert.equal(countLine({ ...base, entries: [entry(1, ["claude-code"])] }), "Found 1 skill in 1 AI tool.");
  assert.equal(
    countLine({ ...base, entries: [entry(1, ["claude-code", "codex"]), entry(2, ["codex"]), entry(3, ["cursor"])] }),
    "Found 3 skills in 3 AI tools.",
  );
});

// ---------------------------------------------------------------------------
// The run, in process
// ---------------------------------------------------------------------------

const WEB = "https://web.test";

function entry(n: number, name: string, job: KitMapEntry["job"], usage: KitMapEntry["usage"]["state"] = "used"): KitMapEntry {
  return {
    key: hex(n),
    name,
    description: "",
    source: "local",
    tools: [{ tool: "claude-code", copies: 1 }],
    job,
    usage: { state: usage, reason: usage === "unused" ? "no-recent-run" : usage === "unknown" ? "no-history" : null },
  };
}

const READING: MapReading = {
  payload: {
    entries: [
      entry(1, "Plain Prose", "writing.editing"),
      entry(2, "Copy Editor", "writing.editing", "unused"),
      entry(3, "Style Guide", "writing.editing"),
      entry(4, "Workers", "development.platforms"),
      entry(5, "Wrangler", "development.platforms"),
      entry(6, "Morning Brief", null, "unused"),
    ],
    looked: [
      { tool: "claude-code", history: "read" },
      { tool: "codex", history: "short" },
    ],
    unchecked: [{ reason: "protected-folder", tools: ["claude-code"] }],
  },
  usageNotes: ["Codex has 12 days of records."],
  unreadable: [{ path: "/fixture/home/Documents/skills", reason: "protected-folder", tools: ["claude-code"] }],
  home: "/fixture/home",
};

async function withRun(
  over: Partial<StartMapOptions>,
  fn: (run: MapRun, printed: string[]) => Promise<void>,
): Promise<void> {
  const printed: string[] = [];
  const run = await startMap({
    open: false,
    reading: READING,
    webUrl: WEB,
    handleSignals: false,
    print: (line) => printed.push(line),
    ...over,
  });
  try {
    await fn(run, printed);
  } finally {
    await run.stop("interrupted");
  }
}

test("the run prints the count line and the address, and opens the browser unless told not to", async () => {
  const opened: string[] = [];
  await withRun({ open: true, openBrowser: async (url) => (opened.push(url), true) }, async (run, printed) => {
    assert.deepEqual(opened, [run.url]);
    assert.equal(printed[0], "Found 6 skills in 1 AI tool.");
    assert.ok(printed.some((line) => line === `Opened ${run.url}`), printed.join("\n"));
  });
  await withRun({ open: true, openBrowser: async () => false }, async (run, printed) => {
    assert.ok(printed.includes(`Open ${run.url} to see your map.`), "a browser that won't open still gets the address");
  });
  const never: string[] = [];
  await withRun({ open: false, openBrowser: async (url) => (never.push(url), true) }, async (run, printed) => {
    assert.deepEqual(never, []);
    assert.ok(printed.includes(`Open ${run.url} to see your map.`));
  });
});

test("with no ready from the frame, the terminal prints the marks as text", async () => {
  await withRun({ readyWaitMs: 30 }, async (run, printed) => {
    const page = await send(run.url);
    assert.equal(page.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 120));
    const text = printed.join("\n");
    assert.match(text, /The map didn't load/);
    assert.match(text, /Editing has 3 skills: Plain Prose, Copy Editor, Style Guide/);
    assert.doesNotMatch(text, /Platforms has/, "a job that holds many skills is never doubled");
    assert.match(text, /No run in 30 days: Copy Editor, Morning Brief/);
    assert.match(text, /Not sorted: Morning Brief/);
    assert.match(text, /44 of 46 jobs have no skill\./);
    assert.match(text, /Codex has 12 days of records\./);
    assert.match(text, /Couldn't check ~\/Documents\/skills: macOS asks before Skillet reads it\./);
  });
});

test("the text summary lists the marks", () => {
  const lines = textSummary(READING);
  assert.equal(lines[0], "The map didn't load in the browser. What it found:");
  assert.ok(lines.includes("  Editing has 3 skills: Plain Prose, Copy Editor, Style Guide"));
  assert.ok(lines.includes("  44 of 46 jobs have no skill."));
  const empty = textSummary({ payload: { entries: [], looked: [], unchecked: [] }, usageNotes: [], unreadable: [], home: "/fixture/home" });
  assert.deepEqual(empty, ["The map didn't load in the browser. What it found:", "  No skills. All 46 jobs are empty."]);
});

test("Ctrl+C sends status ended to the frame, closes the server and prints that nothing changed", async () => {
  const printed: string[] = [];
  const run = await startMap({ open: false, reading: READING, webUrl: WEB, handleSignals: false, print: (line) => printed.push(line) });
  const waiting = send(`${run.origin}/${run.token}/messages?after=0`);
  await new Promise((resolve) => setTimeout(resolve, 20));
  await run.stop("interrupted");
  assert.equal(await run.done, "interrupted");
  const { messages } = JSON.parse((await waiting).body) as { messages: unknown[] };
  assert.deepEqual(messages, [{ type: "status", v: 1, state: "ended" }]);
  assert.equal(printed.at(-1), "Map closed. Nothing changed.");
  await assert.rejects(send(run.url));
});

test("30 minutes with no Save sends status ended, closes the server and prints that nothing changed", async () => {
  const printed: string[] = [];
  const run = await startMap({
    open: false,
    reading: READING,
    webUrl: WEB,
    handleSignals: false,
    idleMs: 60,
    print: (line) => printed.push(line),
  });
  const waiting = send(`${run.origin}/${run.token}/messages?after=0`);
  assert.equal(await run.done, "idle");
  const { messages } = JSON.parse((await waiting).body) as { messages: unknown[] };
  assert.deepEqual(messages, [{ type: "status", v: 1, state: "ended" }]);
  assert.match(printed.at(-1) ?? "", /^Map closed after .+ with no Save\. Nothing changed\.$/);
  await assert.rejects(send(run.url));
});

test("drafting keeps the map open past the idle wait", async () => {
  await withRun({ idleMs: 500 }, async (run) => {
    const key = READING.payload.entries[1]!.key;
    for (let i = 0; i < 8; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const reply = await postTo(run.origin, run.token, { type: "drafts", v: 1, drafts: [{ kind: "remove", key }] });
      assert.equal(reply.status, 200);
    }
    const page = await send(run.url);
    assert.equal(page.status, 200, "still serving after 800 ms of drafting against a 500 ms wait");
  });
});

test("until Save is built, Save says it isn't ready and changes nothing", async () => {
  await withRun({}, async (run, printed) => {
    const key = READING.payload.entries[1]!.key;
    const reply = await postTo(run.origin, run.token, { type: "save", v: 1, drafts: [{ kind: "remove", key }] });
    assert.equal(reply.status, 202);
    const polled = await send(`${run.origin}/${run.token}/messages?after=0`);
    const { messages } = JSON.parse(polled.body) as { messages: unknown[] };
    assert.deepEqual(messages, [{ type: "status", v: 1, state: "failed", reason: "not-ready" }]);
    assert.ok(printed.includes("Save isn't ready yet. Nothing changed."), printed.join("\n"));
    // The map stays open for another try.
    assert.equal((await send(run.url)).status, 200);
  });
});

test("an injected save handler gets the drafts, and finishing ends the run without the nothing-changed line", async () => {
  const printed: string[] = [];
  const run = await startMap({
    open: false,
    reading: READING,
    webUrl: WEB,
    handleSignals: false,
    print: (line) => printed.push(line),
    onSave: (drafts, link) => {
      assert.equal(drafts.length, 1);
      link.status("done");
      link.finish();
    },
  });
  const key = READING.payload.entries[1]!.key;
  await postTo(run.origin, run.token, { type: "save", v: 1, drafts: [{ kind: "remove", key }] });
  assert.equal(await run.done, "finished");
  assert.ok(!printed.some((line) => /Nothing changed/.test(line)));
  await assert.rejects(send(run.url));
});

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

test("map is a visible device-tier command with --no-open and --json", () => {
  const program = new Command("skillet").version("test");
  registerAllCommands(program, { legacyManagement: false });
  const map = program.commands.find((c) => c.name() === "map");
  assert.ok(map, "`skillet map` runs on a default install, with no pairing");
  assert.equal((map as Command & { _hidden?: boolean })._hidden ?? false, false);
  const flags = map.options.map((o) => o.long);
  assert.ok(flags.includes("--no-open"));
  assert.ok(flags.includes("--json"));
  assert.ok(!flags.includes("--apply"), "--apply arrives with Save (U11, U13)");
});
