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
    `skillet-activity-data-${process.pid}-${Date.now()}`,
  );
  await rm(root, { recursive: true, force: true });
  const env = { ...process.env, HOME: root, SKILLET_DIR: join(root, ".skillet"), SKILLET_ACTIVITY: "0" };
  delete (env as Record<string, unknown>)["SKILLET_TOKEN"]; // anonymous — no server side
  try {
    await fn(env);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function seedHistory(root: string): Promise<void> {
  const now = new Date().toISOString();
  await mkdir(join(root, ".skillet"), { recursive: true });
  await writeFile(
    join(root, ".skillet", "route-history.json"),
    JSON.stringify({
      version: 1,
      skills: { "@a/x": { count: 2, firstUsed: now, lastUsed: now, runtimes: { cursor: 2 } } },
    }),
  );
}

function runCli(args: string[], env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env });
}

test("activity export emits the content-free local store; nothing else, no server data when anonymous", async () => {
  await withTestKit(async (env) => {
    await seedHistory(env.HOME!);
    const res = runCli(["activity", "export"], env);
    assert.equal(res.status, 0, res.stderr);
    const parsed = JSON.parse(res.stdout.trim()) as {
      local: { version: number; skills: Record<string, unknown> };
      server: unknown;
    };
    assert.ok(parsed.local.skills["@a/x"], "exported local skills present");
    assert.deepEqual(Object.keys(parsed.local).sort(), ["skills", "version"]);
    assert.equal(parsed.server, "no-token"); // anonymous
    assert.ok(!/task|prompt/i.test(res.stdout), "no content in export");
  });
});

test("activity clear wipes the local route history (R4)", async () => {
  await withTestKit(async (env) => {
    await seedHistory(env.HOME!);
    const clr = runCli(["activity", "clear"], env);
    assert.equal(clr.status, 0, clr.stderr);
    assert.match(clr.stdout, /Cleared local/);

    const usage = runCli(["usage", "--json"], env);
    const parsed = JSON.parse(usage.stdout.trim()) as { skills: unknown[] };
    assert.deepEqual(parsed.skills, []);
  });
});
