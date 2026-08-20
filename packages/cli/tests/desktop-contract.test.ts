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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import test from "node:test";
import { registerAllCommands } from "../src/commands/register-all.js";

const LIB_RS = fileURLToPath(
  new URL("../../desktop/src-tauri/src/lib.rs", import.meta.url),
);

/**
 * Extract the argv arrays handed to run_skillet()/run_skillet_capture().
 * Covers both direct literals (`run_skillet(&["list", "--json"])`) and the
 * build-then-call pattern (`let mut args: Vec<&str> = vec!["upload", "--json"]`
 * … `run_skillet_capture(&args)`), by collecting every `&[…]` / `vec![…]`
 * array literal whose first element is a string literal.
 *
 * Returns one verb path per call site: the leading string literals up to the
 * first flag or non-literal expression (`["device", "rename", &cleaned,
 * "--json"]` → `["device", "rename"]`).
 */
function desktopInvokedVerbPaths(source: string): string[][] {
  const arrays = [
    // direct: run_skillet(&["list", "--json"]) / run_skillet_capture(&[…])
    ...source.matchAll(/run_skillet(?:_capture)?\(\s*&\[([^\]]*)\]/gs),
    // build-then-call: let mut args: Vec<&str> = vec!["upload", "--json"];
    ...source.matchAll(/:\s*Vec<&str>\s*=\s*vec!\[([^\]]*)\]/gs),
  ];
  const paths: string[][] = [];
  for (const match of arrays) {
    const tokens = match[1]
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const path: string[] = [];
    for (const token of tokens) {
      const literal = /^"([^"]*)"$/.exec(token);
      if (!literal || literal[1].startsWith("-")) break;
      path.push(literal[1]);
    }
    if (path.length > 0) paths.push(path);
  }
  return paths;
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
