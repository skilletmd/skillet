import assert from "node:assert/strict";
import test from "node:test";
import { ExitCode } from "../src/exit-codes.js";
import { writeJsonOk } from "../src/json-output.js";

test("ExitCode constants are stable for CI contract", () => {
  assert.equal(ExitCode.OK, 0);
  assert.equal(ExitCode.ERROR, 1);
  assert.equal(ExitCode.USAGE, 2);
  assert.equal(ExitCode.AUTH, 3);
  assert.equal(ExitCode.CONFLICT, 4);
});

test("writeJsonOk emits envelope to stdout", () => {
  const chunks: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string) => {
    chunks.push(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    writeJsonOk({ plan: true });
    const parsed = JSON.parse(chunks.join("")) as { ok: boolean; data: { plan: boolean } };
    assert.equal(parsed.ok, true);
    assert.equal(parsed.data.plan, true);
  } finally {
    process.stdout.write = orig;
  }
});
