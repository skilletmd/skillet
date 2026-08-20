import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "dist", "cli.cjs");

async function withSandbox(fn: (env: NodeJS.ProcessEnv, skilletDir: string) => void | Promise<void>): Promise<void> {
  const root = join(
    process.env["TMPDIR"] ?? "/tmp",
    `skillet-activity-choose-${process.pid}-${Date.now()}`,
  );
  const skilletDir = join(root, ".skillet");
  await mkdir(skilletDir, { recursive: true });
  const env = { ...process.env, HOME: root, SKILLET_DIR: skilletDir };
  // Anonymous sandbox: no token, so the best-effort server flag is a no-op.
  delete (env as Record<string, unknown>)["SKILLET_TOKEN"];
  delete (env as Record<string, unknown>)["SKILLET_ACTIVITY"];
  try {
    await fn(env, skilletDir);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function runCli(args: string[], env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env });
}

function readConfig(skilletDir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(skilletDir, "config.json"), "utf8")) as Record<string, unknown>;
}

test("choose sync marks consent chosen and turns recording on", async () => {
  await withSandbox(async (env, skilletDir) => {
    const res = runCli(["activity", "choose", "sync", "--json"], env);
    assert.equal(res.status, 0);
    const body = JSON.parse(res.stdout.trim()) as { ok: boolean; recording: boolean; routeConsentChosen: boolean };
    assert.equal(body.ok, true);
    assert.equal(body.recording, true);
    assert.equal(body.routeConsentChosen, true);
    const cfg = readConfig(skilletDir);
    assert.equal(cfg["activity"], true);
    assert.equal(cfg["routeConsentChosen"], true);
  });
});

test("choose local marks consent chosen with recording off", async () => {
  await withSandbox(async (env, skilletDir) => {
    const res = runCli(["activity", "choose", "local", "--json"], env);
    assert.equal(res.status, 0);
    const body = JSON.parse(res.stdout.trim()) as { ok: boolean; recording: boolean; routeConsentChosen: boolean };
    assert.equal(body.recording, false);
    assert.equal(body.routeConsentChosen, true);
    const cfg = readConfig(skilletDir);
    assert.equal(cfg["activity"], false);
    assert.equal(cfg["routeConsentChosen"], true);
  });
});

test("choose rejects anything but sync|local and leaves config untouched", async () => {
  await withSandbox(async (env, skilletDir) => {
    const res = runCli(["activity", "choose", "banana", "--json"], env);
    assert.notEqual(res.status, 0);
    const body = JSON.parse(res.stdout.trim()) as { ok: boolean; error?: string };
    assert.equal(body.ok, false);
    // No config file written by a rejected choice.
    assert.throws(() => readConfig(skilletDir));
  });
});

test("human choose local prints the shared local confirmation", async () => {
  await withSandbox(async (env) => {
    const res = runCli(["activity", "choose", "local"], env);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /Skill stats stay on this machine\./);
  });
});

test("status --json reflects the choice", async () => {
  await withSandbox(async (env) => {
    runCli(["activity", "choose", "sync", "--json"], env);
    const res = runCli(["activity", "status", "--json"], env);
    const body = JSON.parse(res.stdout.trim()) as { recording: boolean; routeConsentChosen: boolean };
    assert.equal(body.recording, true);
    assert.equal(body.routeConsentChosen, true);
  });
});
