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
    USERPROFILE: root,
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

// U1 / R12. The hook and the route verb both recorded, so every /skillet on a
// hook-installed runtime counted twice. The verb is the single recorder now:
// it runs everywhere, while the hook exists on three runtimes.
test("route hook does not record; the route verb is the single recorder", async () => {
  await withTestKit(async (env) => {
    const debugEnv = { ...env, SKILLET_ACTIVITY_DEBUG: "1" };
    const hooked = runCli(
      ["route", "hook", "--runtime", "claude-code"],
      debugEnv,
      JSON.stringify({ prompt: "/skillet prep RPG" }),
    );
    assert.equal(hooked.status, 0, hooked.stderr);
    assert.doesNotMatch(hooked.stderr, /skill\.route\.invoke/);

    const begun = runCli(
      ["route", "begin", "--runtime", "claude-code", "--source", "route-skill"],
      debugEnv,
    );
    assert.equal(begun.status, 0, begun.stderr);
    const events = begun.stderr.match(/skill\.route\.invoke/g) ?? [];
    assert.equal(events.length, 1, "one invocation records exactly one event");
    assert.match(begun.stderr, /claude-code/);
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

// U4 / R2, R3, R17. Each verb returns its data AND the instructions for that
// path, so no path needs a separate file read to know how to proceed.
test("route start returns candidates plus pick rules, and carries no dead fields", async () => {
  await withTestKit(async (env) => {
    await seedKitSkill(env.HOME!);
    const res = runCli(["route", "start"], env);
    assert.equal(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout) as {
      ok: boolean;
      candidates: Array<Record<string, unknown>>;
      instructions: string;
    };
    assert.equal(out.ok, true);
    assert.ok(out.candidates.length > 0, "kit skills are candidates");
    assert.match(out.instructions, /skillet route use/);
    // Only what picking needs: path/slug/owner are all derivable from ref.
    for (const c of out.candidates) {
      assert.deepEqual(Object.keys(c).sort(), ["description", "ref"]);
    }
  });
});

test("route use returns the body with apply rules and records exactly one invoke", async () => {
  await withTestKit(async (env) => {
    await seedKitSkill(env.HOME!);
    const debugEnv = { ...env, SKILLET_ACTIVITY_DEBUG: "1" };
    const start = runCli(["route", "start"], env);
    const ref = (JSON.parse(start.stdout) as { candidates: Array<{ ref: string }> }).candidates[0]!
      .ref;

    const res = runCli(["route", "use", ref, "--runtime", "claude-code"], debugEnv);
    assert.equal(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout) as {
      ok: boolean;
      ref: string;
      path: string;
      body: string | null;
      instructions: string;
    };
    assert.equal(out.ok, true);
    assert.equal(out.ref, ref);
    assert.ok(out.path.endsWith("SKILL.md"));
    assert.equal(typeof out.body, "string", "a small skill comes back inline");
    assert.match(out.instructions, /body/);

    const invokes = res.stderr.match(/skill\.route\.invoke/g) ?? [];
    assert.equal(invokes.length, 1, "the use verb is the single recorder");
  });
});

test("route use reports a ref that is not on this machine", async () => {
  await withTestKit(async (env) => {
    await seedKitSkill(env.HOME!);
    const res = runCli(["route", "use", "@nobody/nothing"], env);
    assert.notEqual(res.status, 0);
    const out = JSON.parse(res.stdout) as { ok: boolean; error: string };
    assert.equal(out.ok, false);
    assert.equal(out.error, "skill_not_in_kit");
  });
});

test("route use hands back a path instead of truncating an oversized skill", async () => {
  await withTestKit(async (env) => {
    await seedKitSkill(env.HOME!);
    const start = runCli(["route", "start"], env);
    const ref = (JSON.parse(start.stdout) as { candidates: Array<{ ref: string }> }).candidates[0]!
      .ref;
    const use = runCli(["route", "use", ref], env);
    const { path } = JSON.parse(use.stdout) as { path: string };

    // Push the same skill past the response cap; the verb must decline to
    // inline it rather than hand the agent a truncated body.
    await writeFile(path, "x".repeat(30_000), "utf8");
    const big = runCli(["route", "use", ref], env);
    assert.equal(big.status, 0, big.stderr);
    const out = JSON.parse(big.stdout) as { ok: boolean; body: string | null; path: string };
    assert.equal(out.ok, true);
    assert.equal(out.body, null, "oversized bodies come back as a path");
    assert.ok(out.path.endsWith("SKILL.md"));
  });
});

// U6 / R7, R8. The prompt that used to gate the library search is gone; the
// disclosure line replaces it, and the numbered menu still gates installs.
test("the pick block searches without asking, bounds the payload, and gates installs", async () => {
  await withTestKit(async (env) => {
    await seedKitSkill(env.HOME!);
    const res = runCli(["route", "start"], env);
    const { instructions } = JSON.parse(res.stdout) as { instructions: string };

    assert.match(instructions, /Do not ask first/);
    assert.match(instructions, /skillet search --json --source route-skill/);
    assert.match(instructions, /names the keywords you sent/);
    // The payload bound is the substitute for the removed gate.
    assert.match(instructions, /Never send the task text/);
    assert.match(instructions, /credential-shaped/);
    // Install consent survives.
    assert.match(instructions, /A number is the only thing that installs/);
    assert.match(instructions, /skillet add <ref> -y/);
  });
});

// U8 / R11. Pre-injection is the turn saving: candidates arrive before the
// agent's first turn, so it can skip the start verb. Only where the runtime can
// actually add to a prompt, and only where the local kit is what gets routed.
test("the hook injects kit candidates on a runtime that can add context", async () => {
  await withTestKit(async (env) => {
    await seedKitSkill(env.HOME!);
    const res = runCli(
      ["route", "hook", "--runtime", "claude-code"],
      env,
      JSON.stringify({ prompt: "/skillet prep an RPG session" }),
    );
    assert.equal(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    assert.equal(out.hookSpecificOutput.hookEventName, "UserPromptSubmit");
    assert.match(out.hookSpecificOutput.additionalContext, /@thiago\/the-lazy-dm/);
    assert.match(out.hookSpecificOutput.additionalContext, /skillet route use/);
  });
});

test("cursor installs a hook that neither records nor injects", async () => {
  await withTestKit(async (env) => {
    await seedKitSkill(env.HOME!);
    const res = runCli(
      ["route", "hook", "--runtime", "cursor"],
      { ...env, SKILLET_ACTIVITY_DEBUG: "1" },
      JSON.stringify({ prompt: "/skillet prep an RPG session" }),
    );
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout, "", "beforeSubmitPrompt cannot add context");
    assert.doesNotMatch(res.stderr, /skill\.route\.invoke/);
  });
});

// A bare first word is genuinely ambiguous ("mattpocock" vs "prep"), and the
// router resolves it by judgment. The hook only skips the unambiguous cases:
// guessing "handle" on an ordinary task would cost the turn injection exists to
// save, which is the more expensive mistake.
test("an @handle or create invocation injects nothing, since neither reads the kit", async () => {
  await withTestKit(async (env) => {
    await seedKitSkill(env.HOME!);
    for (const prompt of [
      "/skillet @mattpocock review my PR",
      "/skillet create a skill for our deploy ritual",
    ]) {
      const res = runCli(
        ["route", "hook", "--runtime", "claude-code"],
        env,
        JSON.stringify({ prompt }),
      );
      assert.equal(res.status, 0, res.stderr);
      assert.equal(res.stdout, "", `no injection for: ${prompt}`);
    }
  });
});

test("an empty kit injects nothing rather than an empty candidate list", async () => {
  await withTestKit(async (env) => {
    await mkdir(join(env.HOME!, ".skillet", "skills"), { recursive: true });
    const res = runCli(
      ["route", "hook", "--runtime", "claude-code"],
      env,
      JSON.stringify({ prompt: "/skillet do a thing" }),
    );
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout, "");
  });
});
