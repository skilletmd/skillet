// Desktop↔CLI contract: every CLI command the desktop tray invokes through the
// bundled sidecar must exist at the device tier (legacyManagement: false — the
// desktop never sets SKILLET_LEGACY_CLI).
//
// Why this exists: when the July 2026 tier split moved pending/approve/reject
// behind SKILLET_LEGACY_CLI, commander answered the tray with "unknown command"
// help on stderr and an empty stdout; the tray's JSON.parse fell back to empty,
// the pending badge went to 0, and sync stayed approval-blocked with no visible
// error anywhere. This test turns that silent failure into a red CI run.
//
// The desktop side has no manifest of the commands it calls — they are argv
// literals at run_skillet()/run_skillet_capture() call sites in lib.rs — so we
// parse them out of the Rust source and resolve each verb path against the
// device-tier commander program.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Command } from "commander";
import test from "node:test";
import { registerAllCommands } from "../src/commands/register-all.js";
// The tray's own watch list, imported from the webview source: tsx runs it as
// it stands, so this test pins the very list the app stats.
import { MAP_WATCH_FIXED_PATHS, mapWatchPaths } from "../../desktop/src/map-watch.ts";

const LIB_RS = fileURLToPath(
  new URL("../../desktop/src-tauri/src/lib.rs", import.meta.url),
);
const CLI_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI_SRC = join(CLI_ROOT, "src", "index.ts");

/**
 * Extract the argv arrays handed to run_skillet()/run_skillet_capture() and
 * spawn_skillet_detached(). Covers both direct literals
 * (`run_skillet(&["list", "--json"])`) and the build-then-call pattern
 * (`let mut args: Vec<&str> = vec!["upload", "--json"]` …
 * `run_skillet_capture(&args)`), by collecting every `&[…]` / `vec![…]` array
 * literal whose first element is a string literal.
 *
 * Returns one argv per call site: its leading string literals, flags
 * included, up to the first non-literal expression (`["device", "rename",
 * &cleaned, "--json"]` → `["device", "rename"]`).
 */
function desktopInvocations(source: string): string[][] {
  const arrays = [
    // direct: run_skillet(&["list", "--json"]) / run_skillet_capture(&[…]) / spawn_skillet_detached(&[…])
    ...source.matchAll(/(?:run_skillet(?:_capture)?|spawn_skillet_detached)\(\s*&\[([^\]]*)\]/gs),
    // build-then-call: let mut args: Vec<&str> = vec!["upload", "--json"];
    ...source.matchAll(/:\s*Vec<&str>\s*=\s*vec!\[([^\]]*)\]/gs),
  ];
  const invocations: string[][] = [];
  for (const match of arrays) {
    const tokens = match[1]
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const argv: string[] = [];
    for (const token of tokens) {
      const literal = /^"([^"]*)"$/.exec(token);
      if (!literal) break;
      argv.push(literal[1]);
    }
    if (argv.length > 0) invocations.push(argv);
  }
  return invocations;
}

/** One verb path per call site: the leading literals up to the first flag. */
function desktopInvokedVerbPaths(source: string): string[][] {
  return desktopInvocations(source)
    .map((argv) => {
      const flag = argv.findIndex((token) => token.startsWith("-"));
      return flag === -1 ? argv : argv.slice(0, flag);
    })
    .filter((path) => path.length > 0);
}

function deviceTierProgram(): Command {
  const program = new Command("skillet").version("test");
  registerAllCommands(program, { legacyManagement: false });
  return program;
}

/** Walk `verbs` down the subcommand tree; report the first unresolvable verb. */
function resolves(program: Command, verbs: string[]): string | null {
  let cmd: Command = program;
  for (const verb of verbs) {
    const sub = cmd.commands.find(
      (c) => c.name() === verb || c.aliases().includes(verb),
    );
    if (!sub) {
      // A leaf command's remaining tokens are positional arguments, not
      // subcommands (`connect <pair_code>`); only fail when the parent has
      // subcommands and this verb is not one of them.
      return cmd.commands.length > 0 ? verb : null;
    }
    cmd = sub;
  }
  return null;
}

test("every desktop run_skillet invocation resolves at the device tier", () => {
  const paths = desktopInvokedVerbPaths(readFileSync(LIB_RS, "utf8"));

  // Extraction sanity: lib.rs has ~18 call sites today. If the Rust changes
  // shape enough that we find far fewer, the parser has rotted — fail loudly
  // instead of silently asserting nothing.
  assert.ok(
    paths.length >= 15,
    `expected >=15 desktop CLI call sites in lib.rs, parsed ${paths.length} — update desktopInvokedVerbPaths() to match the current run_skillet call shape`,
  );

  const program = deviceTierProgram();
  const failures = paths
    .map((verbs) => ({ verbs, missing: resolves(program, verbs) }))
    .filter((r) => r.missing !== null);

  assert.deepEqual(
    failures,
    [],
    `desktop invokes CLI commands missing from the device tier — the tray fails silently on these:\n${failures
      .map((f) => `  skillet ${f.verbs.join(" ")} (unknown: ${f.missing})`)
      .join("\n")}\nIf you re-tiered or renamed a command, update the desktop call sites in packages/desktop/src-tauri/src/lib.rs in the same PR.`,
  );
});

test("the shared sync path threads background vs user-initiated (U3)", () => {
  // The tray's manual button and its automatic syncs share ONE command path
  // (sync_skills → `skillet sync --json`), and the sidecar is never a TTY —
  // so without an explicit flag every tray sync classifies fail-closed as
  // unattended and a TCC-parked agent folder could never be granted. The
  // Rust side must therefore append an explicit initiation flag on the sync
  // argv, and the device-tier CLI must accept both flags. (U4 owns the full
  // contract test; this pins the flag plumbing.)
  const source = readFileSync(LIB_RS, "utf8");
  assert.match(
    source,
    /"--background"/,
    "lib.rs must pass --background on automatic sync invocations",
  );
  assert.match(
    source,
    /"--user-initiated"/,
    "lib.rs must pass --user-initiated on the manual sync invocation",
  );
  assert.match(
    source,
    /\["sync", "--check", "--json", "--background"\]/,
    "the tray-open check_sync call must classify as background",
  );

  const program = deviceTierProgram();
  const sync = program.commands.find((c) => c.name() === "sync");
  assert.ok(sync, "`skillet sync` must exist at the device tier");
  const longFlags = sync.options.map((o) => o.long);
  for (const flag of ["--background", "--user-initiated"]) {
    assert.ok(
      longFlags.includes(flag),
      `\`skillet sync ${flag}\` must be accepted at the device tier — the tray passes it on every sync`,
    );
  }
});

test("the tray's read-only polls classify as background (U3)", () => {
  // edits_check and pending_updates are tray-spawned (never a TTY), so
  // without an explicit flag they classify fail-closed as unattended and a
  // GRANTED protected agent folder still parks — the tray badge and the
  // edited-locally card silently go stale after the user granted access.
  // Both commands are read-only, so --background is the only initiation flag
  // they take (they never earn or record a grant); the fail-closed default
  // for flagless non-TTY runs stays unattended.
  const source = readFileSync(LIB_RS, "utf8");
  assert.match(
    source,
    /\["edits", "check", "--json", "--background"\]/,
    "the tray edits-check poll must classify as background",
  );
  assert.match(
    source,
    /\["pending", "--json", "--background"\]/,
    "the tray pending poll must classify as background",
  );

  const program = deviceTierProgram();
  const pending = program.commands.find((c) => c.name() === "pending");
  assert.ok(pending, "`skillet pending` must exist at the device tier");
  const edits = program.commands.find((c) => c.name() === "edits");
  assert.ok(edits, "`skillet edits` must exist at the device tier");
  const editsCheck = edits.commands.find((c) => c.name() === "check");
  assert.ok(editsCheck, "`skillet edits check` must exist at the device tier");
  for (const [label, cmd] of [
    ["pending", pending],
    ["edits check", editsCheck],
  ] as const) {
    const flags = cmd.options.map((o) => o.long);
    assert.ok(
      flags.includes("--background"),
      `\`skillet ${label} --background\` must be accepted at the device tier — the tray passes it on every poll`,
    );
    assert.ok(
      !flags.includes("--user-initiated"),
      `\`skillet ${label}\` is read-only and must NOT take --user-initiated — it never earns a TCC grant`,
    );
  }
});

// ── U4: Rust-side launch reads stay pinned to skillet-dir-derived paths ──────
//
// The tray's own (non-sidecar) filesystem READS run in the app bundle's TCC
// identity at launch, so a new read against a user folder (~/Documents,
// ~/Desktop, ~/Downloads) throws the macOS consent prompt with no code review
// gate. lib.rs has no manifest of its read sites either, so — in the spirit of
// the argv parse above — we statically extract every read call site and pin it
// to an allowlist of known-safe functions whose paths derive from
// skillet_home() or a confined skill-bundle root.

interface RustReadSite {
  /** Enclosing top-level function, or "<module scope>". */
  fn: string;
  /** The matched call text, e.g. "fs::read_to_string(". */
  call: string;
}

/** Every filesystem content-read call site in lib.rs, attributed to its
 *  enclosing top-level `fn`. Matches the read forms Rust code actually uses:
 *  fs::read_dir / fs::read_to_string / fs::read, File::open, OpenOptions. */
function rustReadSites(source: string): RustReadSite[] {
  const fnStarts: Array<{ name: string; start: number }> = [];
  for (const m of source.matchAll(/^(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z0-9_]+)/gm)) {
    fnStarts.push({ name: m[1], start: m.index });
  }
  const calls = [
    ...source.matchAll(/\b(?:std::)?fs::(?:read_dir|read_to_string|read)\b\s*\(/g),
    ...source.matchAll(/\bFile::open\s*\(|\bOpenOptions::new\s*\(/g),
  ];
  return calls.map((m) => {
    let fn = "<module scope>";
    for (const f of fnStarts) {
      if (f.start <= m.index) fn = f.name;
      else break;
    }
    return { fn, call: m[0].trim() };
  });
}

/** fn-name -> expected read call-site count. Every entry is justified by a
 *  path pinned OUTSIDE the TCC-protected folders:
 *   - read_identity_registry_url reads <skillet_home>/identity.json
 *   - read_active_device_token  reads <skillet_home>/device.json
 *   - load_shortcut             reads <skillet_home>/skillet-shortcut
 *   - skill_files / skill_file  read inside a skill_bundle_root()-confined
 *     bundle dir, and only on a user-driven viewer click, never at launch. */
const RUST_READ_ALLOWLIST: Record<string, number> = {
  read_identity_registry_url: 1,
  read_active_device_token: 1,
  skill_files: 1,
  skill_file: 1,
  load_shortcut: 1,
};

test("every Rust-side filesystem read in lib.rs is a known skillet-dir/bundle read", () => {
  const source = readFileSync(LIB_RS, "utf8");
  const sites = rustReadSites(source);

  // Extraction sanity: lib.rs has 5 read sites today. Zero parsed means the
  // parser rotted, not that the desktop stopped reading files.
  assert.ok(
    sites.length >= 5,
    `expected >=5 filesystem read sites in lib.rs, parsed ${sites.length} — update rustReadSites() to match the current read call shapes`,
  );

  const counts: Record<string, number> = {};
  for (const site of sites) counts[site.fn] = (counts[site.fn] ?? 0) + 1;

  assert.deepEqual(
    counts,
    RUST_READ_ALLOWLIST,
    `lib.rs gained (or moved) a filesystem read call site. Desktop-side reads run in the app bundle's TCC identity at launch: a read that lands in ~/Documents, ~/Desktop, or ~/Downloads throws the macOS consent prompt. Keep launch reads derived from skillet_home() (or confined by skill_bundle_root), then extend RUST_READ_ALLOWLIST deliberately with a justification comment.\nParsed sites:\n${sites
      .map((s) => `  ${s.fn}: ${s.call})`)
      .join("\n")}`,
  );
});

test("the allowlisted Rust read sites still derive from pinned roots", () => {
  const source = readFileSync(LIB_RS, "utf8");
  // The three launch-path reads stay anchored to skillet_home().
  assert.match(
    source,
    /Path::new\(&skillet_home\(\)\)\.join\("identity\.json"\)/,
    "identity.json must be read from skillet_home()",
  );
  assert.match(
    source,
    /Path::new\(&skillet_home\(\)\)\.join\("device\.json"\)/,
    "device.json must be read from skillet_home()",
  );
  assert.match(
    source,
    /fn shortcut_config_path\(\)[^}]*skillet_home\(\)/s,
    "the shortcut config path must derive from skillet_home()",
  );
  // The viewer reads stay confined by the canonicalized bundle root.
  for (const fnName of ["skill_files", "skill_file"]) {
    const body = new RegExp(`fn ${fnName}\\([^)]*\\)[\\s\\S]{0,400}?skill_bundle_root\\(`);
    assert.match(
      source,
      body,
      `${fnName} must resolve its reads through skill_bundle_root()`,
    );
  }
});

test("update-approval commands stay device-tier (tray/web reconcile contract)", () => {
  // pending gates the tray badge; approve/reject reconcile web decisions to the
  // device lock file. They are device-tier BY DESIGN — regression guard for the
  // July 2026 incident where re-tiering them wedged sync approval-blocked.
  const program = deviceTierProgram();
  for (const name of ["pending", "approve", "reject"]) {
    assert.ok(
      program.commands.find((c) => c.name() === name),
      `\`skillet ${name}\` must be registered without SKILLET_LEGACY_CLI`,
    );
  }
});

// ── U13: the app takes over the kit map ─────────────────────────────────────
//
// The tray opens the same map the pasted line does (`skillet map`, detached),
// starts every sync tick with `skillet map --apply --json`, writes the merges
// that step left waiting with a detached `skillet map --apply` once the sync is
// done, and rescans with `skillet map --json --no-usage` when a skill folder
// changed. Each argv must exist at the device tier with the flags the tray
// passes.

function deepEqualArgv(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((token, i) => token === b[i]);
}

test("the tray runs `map --json --no-usage`, `map --apply --json`, and a detached `map` and `map --apply` (U13)", () => {
  const source = readFileSync(LIB_RS, "utf8");
  const invoked = desktopInvocations(source);
  for (const want of [["map", "--json", "--no-usage"], ["map", "--apply", "--json"], ["map"], ["map", "--apply"]]) {
    assert.ok(
      invoked.some((argv) => deepEqualArgv(argv, want)),
      `lib.rs must invoke \`skillet ${want.join(" ")}\`; parsed:\n${invoked.map((a) => `  ${a.join(" ")}`).join("\n")}`,
    );
  }
  assert.match(
    source,
    /spawn_skillet_detached\(&\["map"\]\)/,
    "Open my map must start `skillet map` detached: it serves the map until its own idle close",
  );
  assert.match(
    source,
    /run_skillet_capture\(&\["map", "--apply", "--json"\]\)/,
    "the apply step must read stdout on every exit code: locked, partial and not-connected are JSON too",
  );
  assert.match(
    source,
    /spawn_skillet_detached\(&\["map", "--apply"\]\)/,
    "the merges the apply step left waiting are written by a detached run: the AI tool takes minutes, and the sync never waits on it",
  );

  const program = deviceTierProgram();
  const map = program.commands.find((c) => c.name() === "map");
  assert.ok(map, "`skillet map` must exist at the device tier");
  const flags = map.options.map((o) => o.long);
  for (const argv of invoked.filter((a) => a[0] === "map")) {
    for (const flag of argv.slice(1)) {
      assert.ok(flags.includes(flag), `\`skillet map ${flag}\` must be accepted at the device tier`);
    }
  }
  assert.equal(map.registeredArguments.length, 0, "`skillet map` takes no argument, so the detached argv is the whole command");
});

const SCRUBBED_ENV = [
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

/** A child's env with HOME and SKILLET_DIR inside a throwaway fixture, never the real ones. */
function fixtureEnv(home: string, skilletDir: string, registry: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of SCRUBBED_ENV) delete env[key];
  return {
    ...env,
    HOME: home,
    USERPROFILE: home,
    // Devin and Hermes keep skills under these on Windows: keep them in the fixture too.
    APPDATA: join(home, "AppData", "Roaming"),
    LOCALAPPDATA: join(home, "AppData", "Local"),
    SKILLET_DIR: skilletDir,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    SKILLET_REGISTRY_URL: registry,
    SKILLET_REGISTRY: registry,
    SKILLET_WEB_URL: registry,
  };
}

/** A registry that records every request and answers none of them usefully. */
async function trapRegistry(): Promise<{ url: string; hits: string[]; close: () => Promise<void> }> {
  const hits: string[] = [];
  const server: Server = createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    res.writeHead(500);
    res.end();
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}`,
    hits,
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}

test("`skillet map --apply --json` answers a live Save lock at once, so the app skips its tick (KTD10)", { timeout: 90_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "skillet-desktop-contract-"));
  const home = join(root, "home");
  const skilletDir = join(root, "skillet");
  const registry = await trapRegistry();
  try {
    await mkdir(home, { recursive: true });
    await mkdir(skilletDir, { recursive: true });
    await writeFile(join(skilletDir, "device.json"), JSON.stringify({ device_token: "sk_dev_contract", label: "test-machine" }));
    // A Save in progress: the lock names a live process (this test's own).
    await writeFile(
      join(skilletDir, "map-save.lock"),
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), token: "contract" }) + "\n",
    );
    const started = Date.now();
    const res = spawnSync(process.execPath, ["--import", "tsx/esm", CLI_SRC, "map", "--apply", "--json"], {
      cwd: CLI_ROOT,
      env: fixtureEnv(home, skilletDir, registry.url),
      encoding: "utf8",
      timeout: 25_000,
    });
    const elapsed = Date.now() - started;
    assert.equal(res.error, undefined, `still waiting on the Save after ${elapsed} ms; the app's tick must not wait it out`);
    const parsed = JSON.parse(res.stdout) as { ok: boolean; code?: string };
    assert.equal(parsed.ok, false);
    assert.equal(parsed.code, "locked", res.stdout);
    assert.equal(res.status, 1);
    assert.deepEqual(registry.hits, [], "a locked tick calls no one");
  } finally {
    await registry.close();
    await rm(root, { recursive: true, force: true });
  }
});

async function writeSkillAt(dir: string, name: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${name}, a test skill\n---\n\n# ${name}\n`);
}

async function writeJsonAt(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2));
}

/** A home where every tool Skillet supports is detected, with a skill in each skills folder and a plugin in Claude Code and Codex. */
async function everyToolHome(home: string): Promise<{ claudePluginSkills: string; codexPluginSkills: string }> {
  await writeSkillAt(join(home, ".claude", "skills", "claude-one"), "claude-one");
  await writeSkillAt(join(home, ".agents", "skills", "agents-one"), "agents-one");
  await writeSkillAt(join(home, ".codex", "skills", "codex-old"), "codex-old");
  await writeSkillAt(join(home, ".openclaw", "skills", "openclaw-one"), "openclaw-one");
  await writeSkillAt(join(home, ".codeium", "windsurf", "skills", "windsurf-one"), "windsurf-one");
  // Hermes and Devin keep their folders somewhere else on Windows (fixtureEnv's APPDATA and LOCALAPPDATA).
  const windows = process.platform === "win32";
  await writeSkillAt(
    windows ? join(home, "AppData", "Local", "hermes", "skills", "hermes-one") : join(home, ".hermes", "skills", "hermes-one"),
    "hermes-one",
  );
  await writeSkillAt(
    windows ? join(home, "AppData", "Roaming", "devin", "skills", "devin-one") : join(home, ".config", "devin", "skills", "devin-one"),
    "devin-one",
  );
  await mkdir(join(home, ".config", "opencode"), { recursive: true });
  await mkdir(join(home, ".cursor"), { recursive: true });

  const claudePlugin = join(home, ".claude", "plugins", "cache", "market", "alpha", "1.0.0");
  await writeSkillAt(join(claudePlugin, "skills", "alpha-skill"), "alpha-skill");
  await writeJsonAt(join(home, ".claude", "plugins", "installed_plugins.json"), {
    version: 2,
    plugins: { "alpha@market": [{ scope: "user", installPath: claudePlugin, version: "1.0.0" }] },
  });
  await writeJsonAt(join(home, ".claude", "settings.json"), { enabledPlugins: { "alpha@market": true } });

  const codexPlugin = join(home, ".codex", "plugins", "cache", "market", "beta", "1.0.0");
  await writeSkillAt(join(codexPlugin, "skills", "beta-skill"), "beta-skill");
  await writeFile(join(home, ".codex", "config.toml"), '[plugins."beta@market"]\nenabled = true\n');
  return { claudePluginSkills: join(claudePlugin, "skills"), codexPluginSkills: join(codexPlugin, "skills") };
}

test("the app's map watch stats every folder the map scan reads (KTD11)", { timeout: 120_000 }, async () => {
  // The light check compares modification times instead of scanning, so a
  // folder the scan reads but the watch doesn't stat is a skill that lands
  // there and never reaches the tray. This runs the real scan on a fixture
  // home with every tool and a plugin in each plugin tool, and holds the
  // app's list (packages/desktop/src/map-watch.ts) to what the scan read.
  const root = await mkdtemp(join(tmpdir(), "skillet-desktop-watch-"));
  const home = join(root, "home");
  const skilletDir = join(root, "skillet");
  const registry = await trapRegistry();
  try {
    await mkdir(skilletDir, { recursive: true });
    const plugins = await everyToolHome(home);
    const env = fixtureEnv(home, skilletDir, registry.url);

    const probe = `
      const { scanThisMachine } = await import(${JSON.stringify(pathToFileURL(join(CLI_ROOT, "src", "commands", "map-cmd.ts")).href)});
      const { ALL_ADAPTERS, BASELINE_READER_ADAPTERS } = await import(${JSON.stringify(pathToFileURL(join(CLI_ROOT, "src", "cli-context.ts")).href)});
      const scan = await scanThisMachine();
      const adapters = [...ALL_ADAPTERS, ...BASELINE_READER_ADAPTERS].map((a) => ({ name: a.name, kind: a.kind, targetDir: a.targetDir }));
      process.stdout.write(JSON.stringify({ folders: scan.folders.map((f) => f.path), adapters }));
    `;
    const scanRun = spawnSync(process.execPath, ["--import", "tsx/esm", "--input-type=module", "-e", probe], {
      cwd: CLI_ROOT,
      env,
      encoding: "utf8",
      timeout: 60_000,
    });
    assert.equal(scanRun.status, 0, scanRun.stderr);
    const scanned = JSON.parse(scanRun.stdout) as {
      folders: string[];
      adapters: Array<{ name: string; kind: string; targetDir: string }>;
    };

    const runtimesRun = spawnSync(process.execPath, ["--import", "tsx/esm", CLI_SRC, "runtimes", "--json"], {
      cwd: CLI_ROOT,
      env,
      encoding: "utf8",
      timeout: 60_000,
    });
    assert.equal(runtimesRun.status, 0, runtimesRun.stderr);
    const { runtimes } = JSON.parse(runtimesRun.stdout) as { runtimes: Array<{ name: string; targetDir: string }> };

    const expand = (path: string): string => resolve(path.startsWith("~/") ? join(home, path.slice(2)) : path);
    const watched = new Set(mapWatchPaths(runtimes).map(expand));
    const fixed = new Set(MAP_WATCH_FIXED_PATHS.map(expand));

    // Fixture sanity: the scan read the plugin folders, and more than them.
    for (const dir of [plugins.claudePluginSkills, plugins.codexPluginSkills]) {
      assert.ok(scanned.folders.map((f) => resolve(f)).includes(resolve(dir)), `the scan should read ${dir}: the fixture rotted`);
    }
    assert.ok(scanned.folders.length >= 8, `expected every tool's folder in the scan, got ${scanned.folders.join(", ")}`);

    // A plugin's skills sit in a folder named by the tool's plugin list, which
    // installing or removing a plugin rewrites; every other folder is stat'ed itself.
    const pluginList = new Map([
      [resolve(plugins.claudePluginSkills), join(home, ".claude", "plugins", "installed_plugins.json")],
      [resolve(plugins.codexPluginSkills), join(home, ".codex", "config.toml")],
    ]);
    const missing: string[] = [];
    for (const folder of scanned.folders.map((f) => resolve(f))) {
      const list = pluginList.get(folder);
      if (list !== undefined) {
        if (!watched.has(resolve(list))) missing.push(`${folder} (its plugin list ${list})`);
      } else if (!watched.has(folder)) {
        missing.push(folder);
      }
    }
    assert.deepEqual(missing, [], `the map scan reads folders the app's watch never stats:\n${missing.map((m) => `  ${m.split(home + sep).join("~/")}`).join("\n")}`);

    // A tool installed after the app started has no runtime row yet: its
    // skills folder must be on the fixed list, so its first skill still counts.
    const unfixed = scanned.adapters
      .filter((a) => a.kind !== "project" && !fixed.has(resolve(a.targetDir)))
      .map((a) => `${a.name}: ${a.targetDir}`);
    assert.deepEqual(unfixed, [], "every tool's skills folder belongs on MAP_WATCH_FIXED_PATHS");
    assert.deepEqual(registry.hits, [], "the scan only reads");
  } finally {
    await registry.close();
    await rm(root, { recursive: true, force: true });
  }
});
