import assert from "node:assert/strict";
import test from "node:test";
import { hookRuntimesFromDetected } from "@skillet/core";

test("hookRuntimesFromDetected maps sync adapter names", () => {
  assert.deepEqual(hookRuntimesFromDetected(["cursor", "codex", "codex-project"]), [
    "cursor",
    "codex",
  ]);
  assert.deepEqual(hookRuntimesFromDetected(["windsurf"]), []);
});
