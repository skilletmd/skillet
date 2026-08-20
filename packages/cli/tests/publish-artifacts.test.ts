import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..");
const verifyScript = join(pkgRoot, "scripts", "verify-publish-artifacts.mjs");
const realDist = join(pkgRoot, "dist");

// The `test` script bundles once before any test file runs, so dist/ is ready
// here and nothing below needs to rebuild it. That matters: node --test runs
// these files in PARALLEL, and most of the other CLI test files spawn
// dist/cli.cjs. The three cases below have to damage an artifact to prove the
// verifier catches it, so each damages a throwaway COPY. Damaging the shared
// bundle in place made unrelated suites fail whenever a spawn landed inside the
// window — a stub cli.cjs exits 0 with empty stdout (JSON.parse then throws),
// and a renamed hook command exits 1.
function freshDist(): string {
  const dir = mkdtempSync(join(tmpdir(), "skillet-verify-dist-"));
  const copy = join(dir, "dist");
  cpSync(realDist, copy, { recursive: true });
  return copy;
}

function runVerify(dist?: string): { status: number; stderr: string } {
  try {
    execFileSync(process.execPath, dist ? [verifyScript, dist] : [verifyScript], {
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
  // Read-only against the real dist — the path prepublishOnly actually takes.
  const result = runVerify();
  assert.equal(result.status, 0, result.stderr);
});

test("verify-publish-artifacts fails when bundled-skills is missing", () => {
  const dist = freshDist();
  try {
    const bundledDir = join(dist, "bundled-skills");
    assert.ok(existsSync(bundledDir), "expected the copy to carry bundled-skills");
    renameSync(bundledDir, join(dist, "bundled-skills.bak-test"));
    const result = runVerify(dist);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /bundled route skill/i);
  } finally {
    rmSync(dirname(dist), { recursive: true, force: true });
  }
});

test("verify-publish-artifacts fails when route command is absent from cli.cjs", () => {
  const dist = freshDist();
  try {
    writeFileSync(join(dist, "cli.cjs"), "// stub without route\n");
    const result = runVerify(dist);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /route command/i);
  } finally {
    rmSync(dirname(dist), { recursive: true, force: true });
  }
});

test("verify-publish-artifacts fails when route hook subcommand is absent from cli.cjs", () => {
  const dist = freshDist();
  try {
    const cliPath = join(dist, "cli.cjs");
    const body = readFileSync(cliPath, "utf8");
    writeFileSync(cliPath, body.replace(/\.command\(["']hook["']\)/g, '.command("missing-hook")'));
    const result = runVerify(dist);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /route hook subcommand/i);
  } finally {
    rmSync(dirname(dist), { recursive: true, force: true });
  }
});
