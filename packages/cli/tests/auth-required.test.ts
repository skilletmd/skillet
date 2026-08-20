import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  AUTH_REQUIRED,
  AUTH_REQUIRED_EXIT,
  authRequiredJson,
  authRequiredMessage,
} from "../src/auth-required.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "dist", "cli.cjs");

// Unpaired machine: empty SKILLET_DIR (no device.json/session.json) and no
// token env, so nothing on the dev machine leaks in. HOME is isolated too so
// "no materialization" is observable (adapters write HOME-relative dirs).
function isolatedEnv(extra: Record<string, string> = {}): {
  env: NodeJS.ProcessEnv;
  skilletDir: string;
  home: string;
} {
  const skilletDir = mkdtempSync(join(tmpdir(), "skillet-auth-required-"));
  const home = mkdtempSync(join(tmpdir(), "skillet-auth-required-home-"));
  return {
    env: {
      ...process.env,
      SKILLET_DIR: skilletDir,
      SKILLET_TOKEN: "",
      HOME: home,
      SKILLET_WEB_URL: "https://skillet.md",
      ...extra,
    },
    skilletDir,
    home,
  };
}

test("shared auth-required envelope has the sidecar contract shape", () => {
  const body = authRequiredJson();
  assert.equal(body.ok, false);
  assert.equal(body.error, AUTH_REQUIRED);
  assert.equal(body.code, AUTH_REQUIRED);
  assert.equal(body.message, authRequiredMessage());
  assert.match(body.message, /skillet connect <code>/);
  assert.match(body.message, /\/settings/);
  assert.equal(AUTH_REQUIRED_EXIT, 3);
});

test("unpaired sync (human) exits non-zero with pair-flow guidance, no files written", () => {
  const { env, skilletDir, home } = isolatedEnv();
  const res = spawnSync(process.execPath, [CLI, "sync"], { encoding: "utf8", env });
  // Windows: libuv can assert on process exit after stdio; message is authoritative.
  if (process.platform !== "win32") assert.equal(res.status, AUTH_REQUIRED_EXIT);
  assert.match(res.stderr, /Sign in and get a pair code at https:\/\/skillet\.md\/settings/);
  assert.match(res.stderr, /\/settings/);
  assert.match(res.stderr, /skillet connect <code>/);
  // No local materialization: nothing appears in SKILLET_DIR or HOME runtimes.
  assert.deepEqual(readdirSync(skilletDir), []);
  assert.equal(existsSync(join(home, ".agents")), false);
});

test("unpaired sync --json emits the auth_required envelope on stdout", () => {
  const { env } = isolatedEnv();
  const res = spawnSync(process.execPath, [CLI, "sync", "--json"], { encoding: "utf8", env });
  if (process.platform !== "win32") assert.equal(res.status, AUTH_REQUIRED_EXIT);
  const body = JSON.parse(res.stdout.trim()) as { ok: boolean; error?: string; message?: string };
  assert.equal(body.ok, false);
  assert.equal(body.error, "auth_required");
  assert.match(body.message ?? "", /skillet connect <code>/);
});

test("unpaired sync --check --json emits the auth_required envelope on stdout", () => {
  const { env } = isolatedEnv();
  const res = spawnSync(process.execPath, [CLI, "sync", "--check", "--json"], {
    encoding: "utf8",
    env,
  });
  if (process.platform !== "win32") assert.equal(res.status, AUTH_REQUIRED_EXIT);
  const body = JSON.parse(res.stdout.trim()) as { ok: boolean; error?: string };
  assert.equal(body.ok, false);
  assert.equal(body.error, "auth_required");
});

test("unpaired import of a real local skill exits 3 with the shared message, kit untouched", () => {
  const { env, skilletDir, home } = isolatedEnv();
  // A valid importable skill — proves the gate blocks a would-succeed import.
  const skillDir = mkdtempSync(join(tmpdir(), "skillet-auth-required-skill-"));
  writeFileSync(
    join(skillDir, "SKILL.md"),
    "---\nname: demo-skill\ndescription: test skill\n---\n\nBody.\n",
  );
  const res = spawnSync(process.execPath, [CLI, "import", skillDir], { encoding: "utf8", env });
  if (process.platform !== "win32") assert.equal(res.status, AUTH_REQUIRED_EXIT);
  assert.match(res.stderr, /Sign in and get a pair code at https:\/\/skillet\.md\/settings/);
  assert.match(res.stderr, /skillet connect <code>/);
  assert.doesNotMatch(res.stdout, /Imported/);
  // No kit writes and no materialization.
  assert.deepEqual(readdirSync(skilletDir), []);
  assert.equal(existsSync(join(home, ".agents")), false);
});

test("unpaired import -y (desktop invocation) exits 3 on stderr, discovery never prompts", () => {
  const { env, skilletDir } = isolatedEnv();
  const res = spawnSync(process.execPath, [CLI, "import", "-y"], { encoding: "utf8", env });
  if (process.platform !== "win32") assert.equal(res.status, AUTH_REQUIRED_EXIT);
  assert.match(res.stderr, /skillet connect <code>/);
  // Discovery output never appears — the gate precedes the runtime scan.
  assert.doesNotMatch(res.stdout, /We found|Import|runtimes/);
  assert.deepEqual(readdirSync(skilletDir), []);
});

test("unpaired add owner/repo exits 3 before any fetch or kit write", () => {
  const { env, skilletDir, home } = isolatedEnv();
  const res = spawnSync(process.execPath, [CLI, "add", "foo/bar"], { encoding: "utf8", env });
  if (process.platform !== "win32") assert.equal(res.status, AUTH_REQUIRED_EXIT);
  assert.match(res.stderr, /Sign in and get a pair code at https:\/\/skillet\.md\/settings/);
  assert.match(res.stderr, /skillet connect <code>/);
  // The gate fires before the add banner and source resolution — nothing on
  // stdout means no GitHub discovery, no selection, no materialization.
  assert.equal(res.stdout.trim(), "");
  assert.deepEqual(readdirSync(skilletDir), []);
  assert.equal(existsSync(join(home, ".agents")), false);
});

test("unpaired add --json emits the auth_required envelope on stdout", () => {
  const { env } = isolatedEnv();
  const res = spawnSync(process.execPath, [CLI, "add", "foo/bar", "--json"], {
    encoding: "utf8",
    env,
  });
  if (process.platform !== "win32") assert.equal(res.status, AUTH_REQUIRED_EXIT);
  const body = JSON.parse(res.stdout.trim()) as { ok: boolean; error?: string; message?: string };
  assert.equal(body.ok, false);
  assert.equal(body.error, "auth_required");
  assert.match(body.message ?? "", /skillet connect <code>/);
});

test("unpaired add kit @owner/name exits 3 with the shared message", () => {
  const { env, skilletDir } = isolatedEnv();
  const res = spawnSync(process.execPath, [CLI, "add", "kit", "@owner/kit"], {
    encoding: "utf8",
    env,
  });
  if (process.platform !== "win32") assert.equal(res.status, AUTH_REQUIRED_EXIT);
  assert.match(res.stderr, /skillet connect <code>/);
  assert.deepEqual(readdirSync(skilletDir), []);
});

test("unpaired upload --json emits the auth_required envelope (desktop upload_skills)", () => {
  const { env } = isolatedEnv();
  const res = spawnSync(process.execPath, [CLI, "upload", "--skill", "foo", "--json"], {
    encoding: "utf8",
    env,
  });
  if (process.platform !== "win32") assert.equal(res.status, AUTH_REQUIRED_EXIT);
  const body = JSON.parse(res.stdout.trim()) as { ok: boolean; error?: string };
  assert.equal(body.ok, false);
  assert.equal(body.error, "auth_required");
});

test("import, add, and upload gate through the shared module before any work", () => {
  const srcDir = join(__dirname, "..", "src");
  const importSrc = readFileSync(join(srcDir, "commands", "import-cmd.ts"), "utf8");
  const addSrc = readFileSync(join(srcDir, "commands", "add-cmd.ts"), "utf8");
  const uploadSrc = readFileSync(join(srcDir, "commands", "upload-cmd.ts"), "utf8");

  // Copy is an import, not a convention: every gated command reaches pairing
  // through the shared requirePaired helper.
  for (const src of [importSrc, addSrc, uploadSrc]) {
    assert.match(src, /from ["']\.\.\/auth-required\.js["']/);
    assert.match(src, /requirePaired\(/);
  }

  // import: guard precedes discovery and the local/GitHub import branches.
  const importAction = importSrc.slice(importSrc.indexOf("registerImportCommand"));
  assert.ok(
    importAction.indexOf("requirePaired") < importAction.indexOf("runDiscovery("),
    "import guard must precede discovery",
  );
  assert.ok(
    importAction.indexOf("requirePaired") < importAction.indexOf("importSkill("),
    "import guard must precede local import",
  );

  // add: guard sits in the command actions, before either flow runs (so no
  // GitHub or registry fetch is ever attempted unpaired).
  const addAction = addSrc.slice(addSrc.indexOf("addCmd.action"));
  assert.ok(
    addAction.indexOf("requirePaired") < addAction.indexOf("runSkillAddFlow"),
    "add guard must precede the skill flow",
  );
  const kitAction = addSrc.slice(addSrc.indexOf("kitCmd.action"));
  assert.ok(
    kitAction.indexOf("requirePaired") < kitAction.indexOf("runKitAddFlow"),
    "add kit guard must precede the kit flow",
  );

  // upload: guard precedes the publish call.
  assert.ok(
    uploadSrc.indexOf("requirePaired") < uploadSrc.indexOf("uploadLocalSkills("),
    "upload guard must precede publish",
  );
});

test("paired import of a local skill still works (regression)", () => {
  // Refused-connection registry so the fail-silent telemetry flush never
  // reaches the real registry with the fake device token.
  const { env, skilletDir } = isolatedEnv({ SKILLET_REGISTRY_URL: "http://127.0.0.1:1" });
  // Any stored device token marks a linked machine (post-U1 invariant).
  mkdirSync(skilletDir, { recursive: true });
  writeFileSync(
    join(skilletDir, "device.json"),
    JSON.stringify({ device_id: "dev_test", device_token: "skillet_d_test" }),
  );
  const skillDir = mkdtempSync(join(tmpdir(), "skillet-auth-required-paired-"));
  writeFileSync(
    join(skillDir, "SKILL.md"),
    "---\nname: paired-demo\ndescription: test skill\n---\n\nBody.\n",
  );
  const res = spawnSync(process.execPath, [CLI, "import", skillDir], { encoding: "utf8", env });
  if (process.platform !== "win32") assert.equal(res.status, 0);
  assert.match(res.stdout, /Imported "paired-demo"/);
  // The kit actually received the skill — the gate blocks only unpaired runs.
  assert.ok(readdirSync(skilletDir).some((f) => f !== "device.json"));
});

test("wizard with no credentials never calls /signup and exits cleanly with connect guidance", async () => {
  // Point the CLI at a recording registry so any anonymous-mint attempt is visible.
  const paths: string[] = [];
  const server = createServer((req, res) => {
    paths.push(req.url ?? "");
    res.statusCode = 404;
    res.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  try {
    const { env } = isolatedEnv({ SKILLET_REGISTRY_URL: `http://127.0.0.1:${port}` });
    const result = await new Promise<{ status: number | null; stdout: string }>((resolve) => {
      const child = spawn(process.execPath, [CLI], { env, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
      child.on("close", (status) => resolve({ status, stdout }));
    });

    // Deliberate exit, not an error: cold start installs the router skill for
    // the detected agents (this repo checkout is itself a detected runtime) and
    // points at `skillet connect` for opt-in pairing.
    if (process.platform !== "win32") assert.equal(result.status, 0);
    assert.match(result.stdout, /Installed \/skillet/);
    assert.match(result.stdout, /skillet connect/);
    // No anonymous device mint — /signup is gone from core and never fetched.
    assert.equal(
      paths.some((p) => p.includes("signup")),
      false,
      `unexpected signup call: ${paths.join(", ")}`,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
