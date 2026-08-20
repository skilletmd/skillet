/**
 * `skillet doctor` CLI wiring — human output (JSON schema covered in core doctor.test.ts).
 */
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { Command } from "commander";

const TEST_ROOT = join(tmpdir(), `skillet-doctor-cli-${randomBytes(4).toString("hex")}`);
process.env["HOME"] = TEST_ROOT;
process.env["SKILLET_DIR"] = join(TEST_ROOT, ".skillet");

const { registerDoctorCommand } = await import("../src/commands/doctor.js");

async function runDoctor(args: string[]): Promise<{ stdout: string }> {
  let stdout = "";
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = function (
    chunk: string | Uint8Array,
    ...rest: unknown[]
  ): boolean {
    if (typeof chunk === "string") stdout += chunk;
    else stdout += Buffer.from(chunk).toString("utf8");
    const cb = rest.find((arg) => typeof arg === "function") as (() => void) | undefined;
    cb?.();
    return true;
  } as typeof process.stdout.write;
  const program = new Command();
  program.exitOverride();
  registerDoctorCommand(program);
  try {
    await program.parseAsync(["node", "skillet", "doctor", ...args]);
  } finally {
    process.stdout.write = origWrite;
  }
  return { stdout };
}

before(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
  mkdirSync(join(TEST_ROOT, ".skillet"), { recursive: true });
});

after(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
  process.exitCode = 0;
});

test("doctor TTY output includes auth and paths sections", async () => {
  const { stdout } = await runDoctor([]);
  assert.match(stdout, /Skillet doctor \(doctor_report\/v1\)/);
  assert.match(stdout, /Auth \/ enrollment/);
  assert.match(stdout, /Local state/);
  assert.match(stdout, /Paths/);
});
