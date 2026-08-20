import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "dist", "cli.cjs");

// Run with an empty SKILLET_DIR and no token env so no real session.json /
// identity on the dev machine leaks into the test. Both assertions below
// short-circuit before any network call, so they are deterministic offline.
function isolatedEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const dir = mkdtempSync(join(tmpdir(), "skillet-update-mode-"));
  return { ...process.env, SKILLET_DIR: dir, SKILLET_TOKEN: "", ...extra };
}

test("update-mode requires a session (exits AUTH when not signed in)", () => {
  const res = spawnSync(process.execPath, [CLI, "update-mode", "auto"], {
    encoding: "utf8",
    env: isolatedEnv(),
  });
  // Windows libuv can assert on exit after stdio; the message is authoritative.
  if (process.platform !== "win32") assert.equal(res.status, 3);
  assert.match(res.stderr, /Not signed in/i);
});

test("update-mode rejects an invalid mode before any network call (exits USAGE)", () => {
  const res = spawnSync(
    process.execPath,
    [CLI, "update-mode", "bogus", "--token", "faketoken"],
    { encoding: "utf8", env: isolatedEnv() },
  );
  if (process.platform !== "win32") assert.equal(res.status, 2);
  assert.match(res.stderr, /Invalid mode/i);
});
