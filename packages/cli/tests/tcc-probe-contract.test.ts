// U4 — TCC launch-read regression guard (R5) + detection parity sanity (R3).
//
// macOS gates ~/Documents, ~/Desktop, and ~/Downloads behind a consent prompt
// (TCC). Any sidecar (Node) launch-path CONTENT read — readdir/open/readFile —
// that lands inside one of those folders makes the desktop app throw the
// "would like to access your Documents folder" dialog at launch. U2/U3 parked
// every protected-resolving root behind isTccProtectedPath/isTccParkedPath;
// this test makes CI fail the moment any launch-path code path GAINS a new
// ungated content read.
//
// How it works:
//  1. Build a hermetic HOME containing decoy Documents/Desktop/Downloads (with
//     real content), and symlink several adapter dot-dirs INTO the decoy
//     Documents — the exact aliasing that caused the original launch prompt.
//  2. Instrument the content-read surfaces of node:fs and node:fs/promises
//     BEFORE importing any command/adapter module (module-load side effects
//     must be observed too), recording every path touched. Metadata calls
//     (stat/lstat/access/realpath) are TCC-exempt and deliberately unrecorded.
//  3. Execute the launch command surface the tray hits: every adapter's
//     detect(), the `runtimes --json` command, the pending walk, the live-edits
//     walk (store drift + adapter drift), and route-hook stamping.
//  4. Assert no recorded content read canonicalizes into a decoy protected
//     folder — and (anti-vacuity) that the walks really ran: safe roots were
//     content-read, parked roots still DETECT (metadata-only parity, R3).
//
// Dynamic import is required here (patch first, import second); the static-
// import-only rule applies to shipped core/cli sources, not tests.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { symlinksAvailable } from "./symlink-support.js";

// ── 1. Hermetic HOME + decoy protected folders (BEFORE any skillet import) ──
//
// HARD RULE: never touch the real HOME or ~/.skillet. HOME and SKILLET_DIR are
// redirected before anything under packages/ loads (all skillet imports below
// are dynamic), and restored in the test's finally block. SKILLET_DIR takes
// precedence over HOME in core, so both are isolated.

const ORIGINAL_ENV: Record<string, string | undefined> = {
  HOME: process.env["HOME"],
  USERPROFILE: process.env["USERPROFILE"],
  SKILLET_DIR: process.env["SKILLET_DIR"],
  SKILLET_TCC_CONTEXT: process.env["SKILLET_TCC_CONTEXT"],
  SKILLET_TCC_POLICY: process.env["SKILLET_TCC_POLICY"],
  CLAUDE_CONFIG_DIR: process.env["CLAUDE_CONFIG_DIR"],
  HERMES_HOME: process.env["HERMES_HOME"],
};

// realpath the temp root up front: macOS spells tmp through /var -> /private/var
// and every containment comparison below must run on canonical paths.
const HERMETIC_HOME = realpathSync(
  mkdtempSync(join(tmpdir(), "skillet-tcc-probe-")),
);
const SKILLET_STATE_DIR = join(HERMETIC_HOME, "skillet-dir");

process.env["HOME"] = HERMETIC_HOME;
process.env["USERPROFILE"] = HERMETIC_HOME;
process.env["SKILLET_DIR"] = SKILLET_STATE_DIR;
delete process.env["SKILLET_TCC_CONTEXT"];
delete process.env["CLAUDE_CONFIG_DIR"];
delete process.env["HERMES_HOME"];
// The TCC path policy is macOS-only; force it on so the decoy protected
// folders park on any CI platform.
process.env["SKILLET_TCC_POLICY"] = "force";

// Unowned local skills materialize into a `_local--<slug>` adapter directory
// (materializeSlugDir). Seeded copies must use that name or the drift walk
// finds nothing and the anti-vacuity assertions below fail loudly.
const WALK_DIR = "_local--walkskill";

function writeTree(base: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(base, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
}

// Decoy protected folders with REAL content inside, so an ungated walk would
// perform actual reads there (the guard must catch reads, not just intents).
writeTree(HERMETIC_HOME, {
  "Documents/decoy.txt": "user document\n",
  "Desktop/decoy.txt": "user desktop file\n",
  "Downloads/decoy.txt": "user download\n",
  // Adapter/config dot-dirs that RESOLVE into Documents via symlinks below —
  // the aliasing that produced the original launch-time TCC prompt.
  "Documents/dotfiles/claude/settings.json": "{}\n",
  [`Documents/dotfiles/claude/skills/${WALK_DIR}/SKILL.md`]: "# decoy claude copy\n",
  "Documents/dotfiles/hermes/active_profile": "work\n",
  [`Documents/dotfiles/hermes/skills/${WALK_DIR}/SKILL.md`]: "# decoy hermes copy\n",
  [`Documents/dotfiles/hermes/profiles/work/skills/${WALK_DIR}/SKILL.md`]:
    "# decoy hermes profile copy\n",
  [`Documents/dotfiles/codeium/windsurf/skills/${WALK_DIR}/SKILL.md`]:
    "# decoy windsurf copy\n",
  "Documents/dotfiles/cursor/hooks.json": '{"version":1,"hooks":{}}\n',
});
// The dotfile-into-Documents fixture is symlinks all the way down, and these
// run at module scope — so guard them or importing this file throws where
// symlinks need a privilege the shell does not have. See symlink-support.
if (symlinksAvailable) {
  symlinkSync(join(HERMETIC_HOME, "Documents/dotfiles/claude"), join(HERMETIC_HOME, ".claude"));
  symlinkSync(join(HERMETIC_HOME, "Documents/dotfiles/hermes"), join(HERMETIC_HOME, ".hermes"));
  symlinkSync(join(HERMETIC_HOME, "Documents/dotfiles/codeium"), join(HERMETIC_HOME, ".codeium"));
  symlinkSync(join(HERMETIC_HOME, "Documents/dotfiles/cursor"), join(HERMETIC_HOME, ".cursor"));
}

// Safe (non-protected) roots INSIDE the hermetic HOME: these must still be
// detected and content-read — proof the run exercised the surface (R3) and the
// guard cannot pass by parking everything.
writeTree(HERMETIC_HOME, {
  ".codex/config.toml": "",
  [`.agents/skills/${WALK_DIR}/SKILL.md`]: "# safe adapter copy, drifted\n",
});

// Skillet state: two synced skills so the tray-launch edits walk is real work.
//  - storeskill: store copy present and drifted -> exercises the STORE walk.
//  - walkskill: no store copy, stable baseline -> exercises the ADAPTER drift
//    walk across every global adapter root (decoy-resolving roots must park).
writeTree(SKILLET_STATE_DIR, {
  "skills/storeskill/SKILL.md": "# store copy, edited\n",
  "state.json":
    JSON.stringify(
      {
        version: 1,
        skills: {
          storeskill: {
            slug: "storeskill",
            name: "Store Skill",
            description: "store-walk probe",
            version: 1,
            hash: "sha256:aaa",
            materialized_hash: "sha256:aaa",
            source: "local",
          },
          walkskill: {
            slug: "walkskill",
            name: "Walk Skill",
            description: "adapter-walk probe",
            version: 1,
            hash: "sha256:bbb",
            materialized_hash: "sha256:bbb",
            source: "local",
          },
        },
      },
      null,
      2,
    ) + "\n",
});

// ── 2. fs instrumentation (BEFORE any command/adapter import) ───────────────
//
// Wrap the content-read surfaces of node:fs and node:fs/promises, then
// syncBuiltinESMExports() so ESM named-import bindings (what core/cli/adapters
// use) resolve to the wrappers. Only CONTENT reads are recorded — metadata
// probes (stat/lstat/access/realpath/exists) are TCC-exempt and out of scope.

interface RecordedRead {
  fn: string;
  path: string;
}
const recorded: RecordedRead[] = [];

function toPathString(p: unknown): string | null {
  if (typeof p === "string") return p;
  if (Buffer.isBuffer(p)) return p.toString("utf8");
  if (p instanceof URL) {
    try {
      return fileURLToPath(p);
    } catch {
      return null;
    }
  }
  return null;
}

function record(fn: string, p: unknown): void {
  const path = toPathString(p);
  if (path !== null) recorded.push({ fn, path });
}

const SYNC_CONTENT_READS = [
  "readdirSync",
  "readFileSync",
  "openSync",
  "opendirSync",
  "createReadStream",
  // callback forms
  "readdir",
  "readFile",
  "open",
  "opendir",
] as const;
const PROMISE_CONTENT_READS = ["readdir", "readFile", "open", "opendir"] as const;

type AnyFn = (...args: unknown[]) => unknown;
const fsAny = fs as unknown as Record<string, AnyFn>;
const fsPromisesAny = fsPromises as unknown as Record<string, AnyFn>;

for (const name of SYNC_CONTENT_READS) {
  const orig = fsAny[name] as AnyFn;
  fsAny[name] = function (this: unknown, p: unknown, ...rest: unknown[]) {
    record(name, p);
    return orig.call(this, p, ...rest);
  };
}
for (const name of PROMISE_CONTENT_READS) {
  const orig = fsPromisesAny[name] as AnyFn;
  fsPromisesAny[name] = function (this: unknown, p: unknown, ...rest: unknown[]) {
    record(`promises.${name}`, p);
    return orig.call(this, p, ...rest);
  };
}
syncBuiltinESMExports();

// ── containment helpers (original, unpatched metadata calls only) ───────────

/** realpath through the deepest existing ancestor: ENOENT under a decoy is
 *  still under the decoy, and /var -> /private/var aliasing must not hide a
 *  hit. Mirrors core's realpathDeepestExisting without importing it (this file
 *  must not import core before the patch, and needs no core behavior). */
function canonicalize(p: string): string {
  let current = resolve(p);
  let suffix: string[] = [];
  for (;;) {
    try {
      const real = realpathSync(current);
      return suffix.length === 0 ? real : join(real, ...suffix);
    } catch {
      const parent = dirname(current);
      if (parent === current) return resolve(p);
      suffix = [current.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)), ...suffix];
      current = parent;
    }
  }
}

const DECOY_ROOTS = ["Documents", "Desktop", "Downloads"].map((name) =>
  realpathSync(join(HERMETIC_HOME, name)),
);

function isInsideDecoy(path: string): boolean {
  const canonical = canonicalize(path);
  return DECOY_ROOTS.some(
    (root) => canonical === root || canonical.startsWith(root + sep),
  );
}

function readsUnder(prefix: string): RecordedRead[] {
  const canonicalPrefix = canonicalize(prefix);
  return recorded.filter((r) => {
    const c = canonicalize(r.path);
    return c === canonicalPrefix || c.startsWith(canonicalPrefix + sep);
  });
}

// ── 3 + 4. Exercise the launch surface, then assert ─────────────────────────

test("launch-path content reads never land inside a TCC-protected folder", { skip: !symlinksAvailable }, async (t) => {
  try {
    // Everything under packages/ loads AFTER the env swap and the fs patch, so
    // module-load side effects (e.g. hermes profile resolution, CLI_VERSION
    // read) are observed by the recorder too.
    const cliContext = await import("../src/cli-context.js");
    const core = await import("@skillet/core");
    const { registerAllCommands } = await import("../src/commands/register-all.js");
    const { Command } = await import("commander");

    // Classify as a tray automatic sync: 'background' with no unlock markers
    // is parked for every protected-resolving root. (The test process is
    // already non-TTY under node:test, which classifies fail-closed as
    // 'unattended'; the explicit signal makes the run deterministic either
    // way and matches the invocation the tray actually sends at launch.)
    core.setTccInvocation({ initiation: "background", context: "cli" });

    const { ALL_ADAPTERS, BASELINE_READER_ADAPTERS } = cliContext;
    const allDetectable = [...ALL_ADAPTERS, ...BASELINE_READER_ADAPTERS];

    // (a) Adapter detection — the tray facepile surface.
    const detected: Record<string, boolean> = {};
    for (const adapter of allDetectable) {
      try {
        detected[adapter.name] = await adapter.detect();
      } catch {
        detected[adapter.name] = false;
      }
    }

    // (b) The real `runtimes --json` command the tray shells out to.
    const program = new Command("skillet").version("test");
    program.exitOverride();
    registerAllCommands(program, { legacyManagement: false });
    const chunks: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      chunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      await program.parseAsync(["runtimes", "--json"], { from: "user" });
    } finally {
      process.stdout.write = origWrite;
    }
    const runtimesJson = JSON.parse(chunks.join("")) as {
      ok: boolean;
      runtimes: Array<{ name: string }>;
    };

    // (c) The pending walk (tray badge) under the hermetic state.
    const pendingResult = await core.listPending(ALL_ADAPTERS);

    // (d) The live-edits walk (tray-open `edits check`): store drift for
    // storeskill, adapter drift across every global root for walkskill.
    const liveEdits = await core.listLiveEdits(ALL_ADAPTERS);

    // (e) Route-hook stamping (sync's launch tail) for each hook runtime.
    const hookResults: Record<string, boolean> = {};
    for (const runtime of ["claude-code", "codex", "cursor"]) {
      const result = await core.installRouteHook(runtime, {
        recorderCommand: "/usr/local/bin/skillet",
      });
      hookResults[runtime] = result.installed;
    }

    // ── R3: detection parity — parked roots still DETECT (metadata-only),
    // and safe roots outside the decoys are detected AND content-readable.
    await t.test("detection still reports adapters while protected roots stay parked", () => {
      assert.equal(detected["codex"], true, "codex must detect via the real ~/.codex + ~/.agents");
      assert.equal(
        detected["claude-code"],
        true,
        "claude-code must still detect its Documents-resolving root via metadata alone",
      );
      assert.equal(
        detected["hermes"],
        true,
        "hermes must still detect its Documents-resolving home via metadata alone",
      );
      assert.equal(runtimesJson.ok, true);
      const names = runtimesJson.runtimes.map((r) => r.name);
      assert.ok(names.includes("codex"), `runtimes --json must include codex, got: ${names.join(", ")}`);
      assert.ok(
        names.includes("claude-code"),
        `runtimes --json must include claude-code, got: ${names.join(", ")}`,
      );
    });

    // ── Anti-vacuity: the guard is only meaningful if the run truly performed
    // content reads and truly walked the adapter roots. A refactor that makes
    // these surfaces read nothing must fail here, not silently pass above.
    await t.test("the probe run actually exercised the content-read surface", () => {
      assert.ok(recorded.length > 0, "the fs recorder saw no content reads at all — instrumentation is broken");
      const storeReads = readsUnder(join(SKILLET_STATE_DIR, "skills", "storeskill"));
      assert.ok(
        storeReads.length > 0,
        "expected the live-edits walk to content-read the (safe) skill store copy",
      );
      const adapterReads = readsUnder(join(HERMETIC_HOME, ".agents", "skills", WALK_DIR));
      assert.ok(
        adapterReads.length > 0,
        "expected the adapter drift walk to content-read the safe ~/.agents copy",
      );
      const flagged = new Map(liveEdits.map((e) => [e.slug, e.where]));
      assert.equal(flagged.get("storeskill"), "store", "store drift walk did not run");
      assert.equal(flagged.get("walkskill"), "adapter", "adapter drift walk did not run");
      assert.deepEqual(pendingResult.pending, [], "hermetic local skills must not be pending-gated");
      assert.equal(hookResults["codex"], true, "codex route hook must install into the safe ~/.codex");
      assert.equal(
        hookResults["claude-code"],
        false,
        "claude-code route hook must PARK its Documents-resolving config dir",
      );
      assert.equal(
        hookResults["cursor"],
        false,
        "cursor route hook must PARK its Documents-resolving config dir",
      );
    });

    // ── R5: the regression guard itself.
    await t.test("no launch-path content read landed inside a protected folder", () => {
      const violations = recorded.filter((r) => isInsideDecoy(r.path));
      assert.deepEqual(
        violations,
        [],
        `Launch-path content read(s) resolved into a macOS TCC-protected folder ` +
          `(~/Documents, ~/Desktop, ~/Downloads). On a real machine this throws the ` +
          `"access your Documents folder" consent prompt at app launch. Gate the read ` +
          `behind isTccParkedPath()/assessTccRoot() (packages/core/src/util/tcc-access.ts) ` +
          `before touching the path:\n` +
          violations.map((v) => `  fs.${v.fn}(${v.path})`).join("\n"),
      );
    });
  } finally {
    for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(HERMETIC_HOME, { recursive: true, force: true });
  }
});
