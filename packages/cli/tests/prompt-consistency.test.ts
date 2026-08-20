// U7: every CLI-owned prompt is clack (readline stays only in core's
// non-TTY-capable trust prompts), cancel is never a recorded "no", imports
// finish their own job, and the sync spinner can't interleave.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, "..", "src");
const CLI = join(__dirname, "..", "dist", "cli.cjs");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (entry.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

test("no raw readline prompts anywhere in the CLI package", () => {
  const offenders = walk(srcDir).filter((file) =>
    /node:readline/.test(readFileSync(file, "utf8")),
  );
  assert.deepEqual(
    offenders.map((f) => f.split("/src/")[1]),
    [],
    "raw readline found — use clack",
  );
});

test("import finishes its own job — no sync homework, apply chained", () => {
  const src = readFileSync(join(srcDir, "commands", "import-cmd.ts"), "utf8");
  // Success path: no homework. The catch path may point at sync as recovery.
  assert.doesNotMatch(src, /Run `skillet sync` to materialize/);
  assert.match(src, /Run `skillet sync` to retry/);
  assert.match(src, /applyImported\(/);
  assert.match(src, /applyToAgents\(/);
  // Cancel semantics: picker and confirm both route through isCancel.
  assert.match(src, /isCancel\(picked\)/);
  assert.match(src, /isCancel\(answer\)/);
});

test("sync spinner stops before hooks/consent can print", () => {
  const src = readFileSync(join(srcDir, "connected-sync.ts"), "utf8");
  const stopIdx = src.indexOf("stopProgress();");
  const hooksIdx = src.indexOf("await installRouteHooksWithConsent");
  assert.ok(stopIdx >= 0 && hooksIdx >= 0 && stopIdx < hooksIdx);
});

test("non-TTY import -y completes without prompting (tray path)", () => {
  const home = mkdtempSync(join(tmpdir(), "skillet-import-y-"));
  const env: Record<string, string> = {
    ...process.env,
    HOME: home,
    SKILLET_DIR: join(home, ".skillet"),
    XDG_CONFIG_HOME: join(home, ".config"),
  } as Record<string, string>;
  delete env["SKILLET_TOKEN"];
  delete env["SKILLET_REGISTRY_URL"];
  delete env["SKILLET_WEB_URL"];
  const res = spawnSync(process.execPath, [CLI, "import", "-y"], { encoding: "utf8", env });
  // Unpaired sandbox: the auth gate answers — the point is it never hangs on
  // a prompt and never throws a picker error.
  assert.doesNotMatch(res.stdout + res.stderr, /Which to import|\[y\/N\]/);
});
