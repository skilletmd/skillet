import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..");
const verifyScript = join(pkgRoot, "scripts", "verify-publish-artifacts.mjs");

function runVerify(): { status: number; stderr: string } {
  try {
    execFileSync(process.execPath, [verifyScript], {
      cwd: pkgRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stderr: "" };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string; status?: number };
    return { status: e.status ?? 1, stderr: String(e.stderr ?? e.message) };
  }
}

test("verify-publish-artifacts passes after bundle", () => {
  execFileSync("pnpm", ["bundle"], {
    cwd: pkgRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  const result = runVerify();
  assert.equal(result.status, 0, result.stderr);
});

test("verify-publish-artifacts fails when bundled-skills is missing", () => {
  execFileSync("pnpm", ["bundle"], {
    cwd: pkgRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  const bundledDir = join(pkgRoot, "dist", "bundled-skills");
  const backupDir = join(pkgRoot, "dist", "bundled-skills.bak-test");
  rmSync(backupDir, { recursive: true, force: true });
  if (existsSync(bundledDir)) {
    renameSync(bundledDir, backupDir);
  }
  try {
    const result = runVerify();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /bundled route skill/i);
  } finally {
    rmSync(bundledDir, { recursive: true, force: true });
    if (existsSync(backupDir)) {
      renameSync(backupDir, bundledDir);
    }
  }
});

test("verify-publish-artifacts fails when route command is absent from cli.cjs", () => {
  execFileSync("pnpm", ["bundle"], {
    cwd: pkgRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  const cliPath = join(pkgRoot, "dist", "cli.cjs");
  const backup = readFileSync(cliPath);
  writeFileSync(cliPath, "// stub without route\n");
  try {
    const result = runVerify();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /route command/i);
  } finally {
    writeFileSync(cliPath, backup);
  }
});

test("verify-publish-artifacts fails when route hook subcommand is absent from cli.cjs", () => {
  execFileSync("pnpm", ["bundle"], {
    cwd: pkgRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  const cliPath = join(pkgRoot, "dist", "cli.cjs");
  const backup = readFileSync(cliPath, "utf8");
  writeFileSync(cliPath, backup.replace(/\.command\(["']hook["']\)/g, '.command("missing-hook")'));
  try {
    const result = runVerify();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /route hook subcommand/i);
  } finally {
    writeFileSync(cliPath, backup);
  }
});
