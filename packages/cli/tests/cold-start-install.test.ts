import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, rm, readFile } from "node:fs/promises";
import test from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "dist", "cli.cjs");

// U3: a cold-start bare `skillet` (no account, agents detected) installs the
// `/skillet` router skill and points the user at `skillet connect` — instead of
// the old pairing wizard. All under a throwaway HOME so nothing touches the real
// machine. Piped stdout is non-TTY, so there is no interactive prompt to hang on.
function coldStartEnv(root: string): NodeJS.ProcessEnv {
  const env = {
    ...process.env,
    HOME: root,
    SKILLET_DIR: join(root, ".skillet"),
    SKILLET_ACTIVITY: "0",
  };
  // Claude detection resolves CLAUDE_CONFIG_DIR ?? ~/.claude; unset so the
  // throwaway HOME is authoritative and a stray dev value can't leak in.
  delete env["CLAUDE_CONFIG_DIR"];
  return env;
}

test("cold-start bare `skillet` installs the router skill when an agent is detected", async () => {
  const root = join(process.env["TMPDIR"] ?? "/tmp", `skillet-cold-${process.pid}-${Date.now()}`);
  try {
    // A present ~/.claude makes the Claude Code adapter detect (it checks the
    // parent of ~/.claude/skills).
    await mkdir(join(root, ".claude"), { recursive: true });

    const res = spawnSync(process.execPath, [CLI], { encoding: "utf8", env: coldStartEnv(root) });
    assert.equal(res.status, 0, res.stderr);

    // The router skill landed in the detected runtime.
    const skill = await readFile(join(root, ".claude", "skills", "skillet", "SKILL.md"), "utf8");
    assert.match(skill, /^---\nname: skillet\n/);

    // The user sees the install and the connect hint...
    assert.match(res.stdout, /Installed \/skillet/);
    assert.match(res.stdout, /skillet connect/);
    // ...and NOT the old pairing wizard (KTD4: connecting is opt-in, not a gate).
    assert.doesNotMatch(res.stdout, /Sign in and get a pair code/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
