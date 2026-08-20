import assert from "node:assert/strict";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "dist", "cli.cjs");

async function withTestKit(fn: (env: NodeJS.ProcessEnv) => void | Promise<void>): Promise<void> {
  const root = join(
    process.env["TMPDIR"] ?? "/tmp",
    `skillet-usage-cli-${process.pid}-${Date.now()}`,
  );
  await rm(root, { recursive: true, force: true });
  const env = {
    ...process.env,
    HOME: root,
    SKILLET_DIR: join(root, ".skillet"),
    SKILLET_ACTIVITY: "0", // anonymous — nothing uploads
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
  await writeFile(join(dir, "SKILL.md"), `---\nname: The Lazy DM\ndescription: RPG prep\n---\n\n# Lazy DM\n`);
  const state = {
    version: 1,
    artifact_schema_version: 1,
    skills: {
      [slug]: { slug, owner: "thiago", name: "The Lazy DM", description: "RPG prep", hash: "sha256:test" },
    },
  };
  await mkdir(join(root, ".skillet"), { recursive: true });
  await writeFile(join(root, ".skillet", "state.json"), JSON.stringify(state));
}

function runCli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env, input });
}

test("usage --json shows a clear empty state before any route (R7)", async () => {
  await withTestKit(async (env) => {
    const res = runCli(["usage", "--json"], env);
    assert.equal(res.status, 0, res.stderr);
    const parsed = JSON.parse(res.stdout.trim()) as { ok: boolean; skills: unknown[] };
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.skills, []);
  });
});

test("route record then usage renders from local history while anonymous (AE1)", async () => {
  await withTestKit(async (env) => {
    await seedKitSkill(env.HOME!);
    const rec = runCli(["route", "record", "@thiago/the-lazy-dm", "--runtime", "cursor"], env);
    assert.equal(rec.status, 0, rec.stderr);

    const res = runCli(["usage", "--json"], env);
    assert.equal(res.status, 0, res.stderr);
    const parsed = JSON.parse(res.stdout.trim()) as {
      skills: Array<{ skillRef: string; count: number; runtimes: Record<string, number>; deadWeight: boolean }>;
    };
    assert.equal(parsed.skills.length, 1);
    assert.equal(parsed.skills[0]!.skillRef, "@thiago/the-lazy-dm");
    assert.equal(parsed.skills[0]!.count, 1);
    assert.equal(parsed.skills[0]!.runtimes["cursor"], 1);
    assert.equal(parsed.skills[0]!.deadWeight, false);

    // Content-free (R12): no task/prompt text anywhere in the output.
    assert.ok(!/task|prompt|rationale/i.test(res.stdout));
  });
});

test("usage flags a dead-weight skill as a prune candidate (R6)", async () => {
  await withTestKit(async (env) => {
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    await mkdir(join(env.HOME!, ".skillet"), { recursive: true });
    await writeFile(
      join(env.HOME!, ".skillet", "route-history.json"),
      JSON.stringify({
        version: 1,
        skills: { "@a/stale": { count: 3, firstUsed: old, lastUsed: old, runtimes: { cursor: 3 } } },
      }),
    );
    const res = runCli(["usage", "--json"], env);
    assert.equal(res.status, 0, res.stderr);
    const parsed = JSON.parse(res.stdout.trim()) as { skills: Array<{ skillRef: string; deadWeight: boolean }> };
    assert.equal(parsed.skills[0]!.deadWeight, true);
  });
});
