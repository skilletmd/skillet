import assert from "node:assert/strict";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "dist", "cli.cjs");

async function withTestKit(
  fn: (env: NodeJS.ProcessEnv) => void | Promise<void>,
): Promise<void> {
  const root = join(
    process.env["TMPDIR"] ?? "/tmp",
    `skillet-route-cli-${process.pid}-${Date.now()}`,
  );
  await rm(root, { recursive: true, force: true });
  const env = {
    ...process.env,
    HOME: root,
    SKILLET_DIR: join(root, ".skillet"),
    SKILLET_ACTIVITY: "0",
  };
  try {
    await fn(env);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function seedKitSkill(root: string): Promise<void> {
  const slug = "@thiago/the-lazy-dm";
  const dir = join(root, ".skillet", "skills", slug);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "SKILL.md"),
    `---\nname: The Lazy DM\ndescription: RPG prep\n---\n\n# Lazy DM\n`,
  );
  const state = {
    version: 1,
    artifact_schema_version: 1,
    skills: {
      [slug]: {
        slug,
        owner: "thiago",
        name: "The Lazy DM",
        description: "RPG prep",
        version: 1,
        hash: "sha256:test",
        source: "local",
        importedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    },
  };
  await mkdir(join(root, ".skillet"), { recursive: true });
  await writeFile(join(root, ".skillet", "state.json"), JSON.stringify(state));
}

function runCli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env,
    input,
  });
}

test("route manifest --json lists kit skills", async () => {
  await withTestKit(async (env) => {
    await seedKitSkill(env.HOME!);
    const res = runCli(["route", "manifest", "--json"], env);
    assert.equal(res.status, 0, res.stderr);
    const parsed = JSON.parse(res.stdout.trim()) as {
      skills: Array<{ skillRef: string }>;
    };
    assert.equal(parsed.skills.length, 1);
    assert.equal(parsed.skills[0]?.skillRef, "@thiago/the-lazy-dm");
  });
});

test("route record --json emits phase markers", async () => {
  await withTestKit(async (env) => {
    await seedKitSkill(env.HOME!);
    const res = runCli(["route", "record", "@thiago/the-lazy-dm", "--json"], env);
    assert.equal(res.status, 0, res.stderr);
    const parsed = JSON.parse(res.stdout.trim()) as {
      phases: string[];
      skillRef: string;
      ok: boolean;
    };
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.phases, ["Searching", "Picked", "Using"]);
    assert.equal(parsed.skillRef, "@thiago/the-lazy-dm");
  });
});

test("route begin --json records invocation metadata", async () => {
  await withTestKit(async (env) => {
    const res = runCli(
      [
        "route",
        "begin",
        "--runtime",
        "cursor",
        "--source",
        "cursor-hook",
        "--surface",
        "user-prompt-submit",
        "--json",
      ],
      env,
    );
    assert.equal(res.status, 0, res.stderr);
    const parsed = JSON.parse(res.stdout.trim()) as {
      ok: boolean;
      event: string;
      meta: Record<string, string>;
    };
    assert.equal(parsed.ok, true);
    assert.equal(parsed.event, "skill.route.invoke");
    assert.deepEqual(parsed.meta, {
      command: "skillet",
      runtime: "cursor",
      source: "cursor-hook",
      surface: "user-prompt-submit",
    });
  });
});

test("route begin is quiet by default for hooks", async () => {
  await withTestKit(async (env) => {
    const res = runCli(["route", "begin", "--runtime", "cursor"], env);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout, "");
  });
});

test("route hook --runtime records invocation for matching prompts", async () => {
  await withTestKit(async (env) => {
    const debugEnv = { ...env, SKILLET_ACTIVITY_DEBUG: "1" };
    const hit = runCli(
      ["route", "hook", "--runtime", "claude-code"],
      debugEnv,
      JSON.stringify({ prompt: "/skillet prep RPG" }),
    );
    assert.equal(hit.status, 0, hit.stderr);
    assert.match(hit.stderr, /skill\.route\.invoke/);
    assert.match(hit.stderr, /claude-code/);
  });
});

test("route hook ignores non-/skillet prompts", async () => {
  await withTestKit(async (env) => {
    const res = runCli(
      ["route", "hook", "--runtime", "codex"],
      env,
      JSON.stringify({ prompt: "hello" }),
    );
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout, "");
  });
});

test("route manifest exits non-zero on empty kit", async () => {
  await withTestKit(async (env) => {
    await mkdir(join(env.HOME!, ".skillet", "skills"), { recursive: true });
    await writeFile(
      join(env.HOME!, ".skillet", "state.json"),
      JSON.stringify({ version: 1, artifact_schema_version: 1, skills: {} }),
    );
    const res = runCli(["route", "manifest"], env);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /No skills in your kit/);
  });
});
