import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "dist", "cli.cjs");

// Paired machine so the upload guards are reachable past the pairing gate. A
// stored device token marks a linked machine; the registry is a refused port so
// no publish/telemetry ever leaves the box.
function pairedEnv(): { env: NodeJS.ProcessEnv; skilletDir: string; home: string } {
  const skilletDir = mkdtempSync(join(tmpdir(), "skillet-upload-guard-"));
  const home = mkdtempSync(join(tmpdir(), "skillet-upload-guard-home-"));
  mkdirSync(skilletDir, { recursive: true });
  writeFileSync(
    join(skilletDir, "device.json"),
    JSON.stringify({ device_id: "dev_test", device_token: "skillet_d_test" }),
  );
  return {
    env: {
      ...process.env,
      SKILLET_DIR: skilletDir,
      SKILLET_TOKEN: "",
      HOME: home,
      SKILLET_WEB_URL: "https://skillet.md",
      SKILLET_REGISTRY_URL: "http://127.0.0.1:1",
    },
    skilletDir,
    home,
  };
}

/** Import a real local skill so the kit has one capturable (local, un-owned) entry. */
// cwd matters: `import` materializes through the project-scoped adapter, which
// walks up for a .git/.agents marker. Run it outside a sandbox and the skill
// lands in the REPO's .agents/skills — ambient state that later makes other
// tests pass locally and fail on a clean CI checkout.
function importLocalSkill(env: NodeJS.ProcessEnv, cwd: string): void {
  const skillDir = mkdtempSync(join(tmpdir(), "skillet-upload-guard-skill-"));
  writeFileSync(
    join(skillDir, "SKILL.md"),
    "---\nname: guard-demo\ndescription: test skill\n---\n\nBody.\n",
  );
  const res = spawnSync(process.execPath, [CLI, "import", skillDir], { encoding: "utf8", env, cwd });
  if (process.platform !== "win32") assert.equal(res.status, 0, res.stderr);
}

// The exact regression: `upload <name>` was accepted-and-ignored, which turned
// "upload one skill" into a no-`--skill` batch that published EVERY local skill.
test("upload with a positional name hard-fails and never uploads (human)", () => {
  const { env } = pairedEnv();
  const res = spawnSync(process.execPath, [CLI, "upload", "marketing-skills"], {
    encoding: "utf8",
    env,
  });
  if (process.platform !== "win32") assert.notEqual(res.status, 0);
  assert.match(res.stderr, /positional/i);
  assert.match(res.stderr, /--skill marketing-skills/);
  // No publish progress or success line — the guard precedes all work.
  assert.doesNotMatch(res.stdout, /Uploading|published|→ @/);
});

test("upload with a positional name emits a structured error (--json)", () => {
  const { env } = pairedEnv();
  const res = spawnSync(process.execPath, [CLI, "upload", "marketing-skills", "--json"], {
    encoding: "utf8",
    env,
  });
  if (process.platform !== "win32") assert.notEqual(res.status, 0);
  const body = JSON.parse(res.stdout.trim()) as { ok: boolean; code?: string };
  assert.equal(body.ok, false);
  assert.equal(body.code, "positional_removed");
});

// The second defense: a no-`--skill` batch is a bulk action. Non-interactively
// (no TTY) without `--all` it must refuse rather than silently publish all.
test("bare upload without --skill/--all refuses in non-TTY mode (--json)", () => {
  const { env, home } = pairedEnv();
  importLocalSkill(env, home);
  const res = spawnSync(process.execPath, [CLI, "upload", "--json"], { encoding: "utf8", env });
  if (process.platform !== "win32") assert.notEqual(res.status, 0);
  const body = JSON.parse(res.stdout.trim()) as { ok: boolean; code?: string };
  assert.equal(body.ok, false);
  assert.equal(body.code, "confirmation_required");
});

test("bare upload with nothing to publish reports empty, not a mass upload", () => {
  const { env } = pairedEnv();
  const res = spawnSync(process.execPath, [CLI, "upload", "--json"], { encoding: "utf8", env });
  const body = JSON.parse(res.stdout.trim()) as { ok: boolean; empty?: boolean };
  assert.equal(body.ok, false);
  assert.equal(body.empty, true);
});
