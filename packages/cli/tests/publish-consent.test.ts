// Headless `publish --public` must never publish publicly in silence: without
// a terminal, the explicit --yes flag is the only valid consent. U2 of the
// 2026-07-09 polish plan; guards the confirm-bypass class permanently.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import test from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "dist", "cli.cjs");
const USAGE_EXIT = 2;

function isolatedEnv(): Record<string, string> {
  const home = mkdtempSync(join(tmpdir(), "skillet-publish-consent-"));
  const skilletDir = join(home, ".skillet");
  const env: Record<string, string> = {
    ...process.env,
    HOME: home,
    SKILLET_DIR: skilletDir,
    XDG_CONFIG_HOME: join(home, ".config"),
    // publish is legacy-gated; the consent contract still must hold there.
    SKILLET_LEGACY_CLI: "1",
  } as Record<string, string>;
  delete env["SKILLET_TOKEN"];
  delete env["SKILLET_REGISTRY_URL"];
  delete env["SKILLET_WEB_URL"];
  return env;
}

test("headless publish --public without --yes refuses with USAGE and names the flag", () => {
  const res = spawnSync(process.execPath, [CLI, "publish", "some-skill", "--public"], {
    encoding: "utf8",
    env: isolatedEnv(),
  });
  if (process.platform !== "win32") assert.equal(res.status, USAGE_EXIT);
  assert.match(res.stderr, /--yes/);
  assert.doesNotMatch(res.stdout + res.stderr, /Published/i);
});

test("headless publish --public --json without --yes emits the confirmation_required envelope", () => {
  const res = spawnSync(
    process.execPath,
    [CLI, "publish", "some-skill", "--public", "--json"],
    { encoding: "utf8", env: isolatedEnv() },
  );
  if (process.platform !== "win32") assert.equal(res.status, USAGE_EXIT);
  const body = JSON.parse(res.stdout.trim()) as { ok: boolean; code?: string };
  assert.equal(body.ok, false);
  assert.equal(body.code, "confirmation_required");
});

test("headless publish --public --yes proceeds past the consent gate", () => {
  // Unpaired sandbox: the run must get PAST consent and fail later on
  // auth/identity instead — any outcome except the consent refusal proves
  // the gate honored --yes.
  const res = spawnSync(
    process.execPath,
    [CLI, "publish", "some-skill", "--public", "--yes"],
    { encoding: "utf8", env: isolatedEnv() },
  );
  assert.doesNotMatch(res.stdout + res.stderr, /needs --yes/);
  assert.doesNotMatch(res.stdout, /confirmation_required/);
});

test("source shape: publish.ts has no raw readline and handles clack cancel", () => {
  const src = readFileSync(join(__dirname, "..", "src", "commands", "publish.ts"), "utf8");
  assert.doesNotMatch(src, /createInterface|node:readline/);
  assert.match(src, /isCancel\(answer\)/);
  assert.match(src, /isCancel\(handleAnswer\)/);
  // --yes bypasses the confirm branch entirely.
  assert.match(src, /opts\.yes !== true/);
});
