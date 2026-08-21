// Surface straightening (U8): bare nouns act, status splits by surface,
// agents/runtimes stay byte-identical for the tray, and dead hints are gone.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "dist", "cli.cjs");
const srcDir = join(__dirname, "..", "src");

function isolatedEnv(): Record<string, string> {
  const home = mkdtempSync(join(tmpdir(), "skillet-surface-"));
  const env: Record<string, string> = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    SKILLET_DIR: join(home, ".skillet"),
    XDG_CONFIG_HOME: join(home, ".config"),
  } as Record<string, string>;
  delete env["SKILLET_TOKEN"];
  delete env["SKILLET_REGISTRY_URL"];
  delete env["SKILLET_WEB_URL"];
  return env;
}

function run(args: string[]): ReturnType<typeof spawnSync<string>> {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env: isolatedEnv() });
}

test("agents and runtimes --json are byte-identical (tray contract)", () => {
  // One env for both: targetDir paths embed HOME, so the comparison needs a
  // shared sandbox, not two.
  const env = isolatedEnv();
  const agents = spawnSync(process.execPath, [CLI, "agents", "--json"], { encoding: "utf8", env });
  const runtimes = spawnSync(process.execPath, [CLI, "runtimes", "--json"], { encoding: "utf8", env });
  assert.equal(agents.status, 0);
  assert.equal(agents.stdout, runtimes.stdout);
  // The JSON key stays `runtimes` — compat contract, not vocabulary.
  assert.match(agents.stdout, /"runtimes"/);
});

test("status --json keeps the harm-scan report shape (tray contract)", () => {
  const status = run(["status", "--json"]);
  const scan = run(["scan", "--json"]);
  assert.equal(status.stdout, scan.stdout);
  const body = JSON.parse(status.stdout.trim()) as Record<string, unknown>;
  for (const key of ["total", "byBucket", "entries", "hasQuarantined"]) {
    assert.ok(key in body, `status --json must keep "${key}"`);
  }
});

test("human status is the overview, not the scan dump", () => {
  const res = run(["status"]);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /Not connected/);
  assert.match(res.stdout, /skills? in your kit/);
});

test("bare `skillet edits` lists instead of printing help", () => {
  const bare = run(["edits"]);
  const list = run(["edits", "list"]);
  assert.equal(bare.status, list.status);
  assert.equal(bare.stdout, list.stdout);
});

test("approve works without --version and refuses quarantined applies", () => {
  const src = readFileSync(join(srcDir, "commands", "pending.ts"), "utf8");
  assert.doesNotMatch(src, /requiredOption\(\s*"--version/);
  // The non-interactive verb never grants quarantine consent.
  assert.doesNotMatch(src, /allowQuarantined/);
  assert.match(src, /quarantined/);
  assert.match(src, /applyToAgents\(/);
  assert.doesNotMatch(src, /Run `skillet sync`/);
});

test("update-mode's sign-in hint points at a command that exists", () => {
  const src = readFileSync(join(srcDir, "commands", "update-mode.ts"), "utf8");
  assert.doesNotMatch(src, /skillet login/);
  assert.match(src, /skillet connect/);
});
