import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

test("status is the overview on the human path and the scan report on --json", async () => {
  // The deprecation hint is gone: `status` is a real command again (overview
  // for humans, scan-shape JSON for the tray). Source-shape assertions keep
  // this cheap — the spawned behavior lives in surface-defaults.test.ts.
  const src = readFileSync(join(srcDir, "commands", "status.ts"), "utf8");
  assert.doesNotMatch(src, /printDeprecationHint/);
  assert.match(src, /runOverview/);
  assert.match(src, /runScanReport\(opts\)/);
});
