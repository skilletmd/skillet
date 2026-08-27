import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, rm } from "node:fs/promises";
import test from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "dist", "cli.cjs");

function tmp(label: string): string {
  return join(process.env["TMPDIR"] ?? "/tmp", `skillet-create-${label}-${process.pid}-${Date.now()}`);
}

function env(root: string) {
  return { ...process.env, HOME: root, USERPROFILE: root, SKILLET_DIR: join(root, ".skillet"), SKILLET_ACTIVITY: "0" };
}

// A real trigger sentence contains a colon ("Does X: use when Y"), which is
// exactly what breaks an unquoted YAML scalar. The scaffold used to emit one,
// so `skillet create --description "...: ..."` produced a skill that failed to
// parse on import — a broken file from the command whose only job is to make a
// valid one.
test("create quotes the description so YAML-hostile text still parses", async () => {
  const root = tmp("yaml");
  try {
    await mkdir(root, { recursive: true });
    const hostile = 'Does this: yes, "always" #here';
    const res = spawnSync(
      process.execPath,
      [CLI, "create", "colon-test", "--description", hostile, "--dir", root],
      { encoding: "utf8", env: env(root) },
    );
    assert.equal(res.status, 0, res.stderr);

    const body = await readFile(join(root, "colon-test", "SKILL.md"), "utf8");
    assert.match(body, /^name: colon-test$/m);
    // Emitted as a double-quoted scalar, so the value round-trips through JSON
    // (which is what YAML double-quoted style accepts) with the colon intact.
    const line = body.match(/^description: (.*)$/m);
    assert.ok(line, "description line missing");
    assert.equal(line![1]![0], '"', "description must be quoted, not a plain scalar");
    assert.equal(JSON.parse(line![1]!), hostile);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("create refuses a name no adapter could materialize", async () => {
  const root = tmp("badname");
  try {
    await mkdir(root, { recursive: true });
    for (const bad of ["My Skill", "UPPER", "-leading", "a"]) {
      const res = spawnSync(process.execPath, [CLI, "create", bad, "--dir", root], {
        encoding: "utf8",
        env: env(root),
      });
      assert.notEqual(res.status, 0, `"${bad}" should be rejected`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("create never overwrites an existing directory", async () => {
  const root = tmp("collide");
  try {
    await mkdir(root, { recursive: true });
    const first = spawnSync(process.execPath, [CLI, "create", "dupe", "--dir", root], {
      encoding: "utf8",
      env: env(root),
    });
    assert.equal(first.status, 0, first.stderr);
    const second = spawnSync(process.execPath, [CLI, "create", "dupe", "--dir", root], {
      encoding: "utf8",
      env: env(root),
    });
    assert.notEqual(second.status, 0);
    assert.match(second.stderr, /already exists/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
