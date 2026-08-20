import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { rm } from "node:fs/promises";
import test from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "dist", "cli.cjs");

// `skillet init --print` emits the bundled router skill without writing
// anywhere or needing an account (the copy-paste install fallback). Run under a
// throwaway HOME so nothing touches the real machine.
test("init --print emits the router skill with the @handle summon flow", async () => {
  const root = join(process.env["TMPDIR"] ?? "/tmp", `skillet-init-${process.pid}-${Date.now()}`);
  const env = {
    ...process.env,
    HOME: root,
    SKILLET_DIR: join(root, ".skillet"),
    SKILLET_ACTIVITY: "0",
  };
  try {
    const res = spawnSync(process.execPath, [CLI, "init", "--print"], { encoding: "utf8", env });
    assert.equal(res.status, 0, res.stderr);
    // It is the router skill...
    assert.match(res.stdout, /^---\nname: skillet\n/);
    // ...carrying the @handle summon flow this feature added.
    assert.match(res.stdout, /Summon a handle/);
    assert.match(res.stdout, /authors\/\{handle\}\/summon/);
    // --print must not create the skillet skill dir under HOME.
    const home = spawnSync("ls", [join(root, ".claude", "skills")], { encoding: "utf8" });
    assert.notEqual(home.status, 0, "init --print must not write any skill files");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
