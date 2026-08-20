import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "dist", "cli.cjs");

test("device rename --json writes error envelope to stdout", () => {
  // Unreachable registry → deterministic failure regardless of whether this
  // machine is paired (unpaired short-circuits before the network; paired
  // fails the PATCH). Either way the --json contract is the error envelope
  // the desktop tray parses.
  const res = spawnSync(
    process.execPath,
    [CLI, "device", "rename", "new name", "--json", "--registry", "http://127.0.0.1:1"],
    { encoding: "utf8" },
  );
  if (process.platform !== "win32") {
    assert.equal(res.status, 1);
  }
  const body = JSON.parse(res.stdout.trim()) as { ok: boolean; error?: string };
  assert.equal(body.ok, false);
  assert.ok((body.error ?? "").length > 0, "error envelope carries a message");
});
