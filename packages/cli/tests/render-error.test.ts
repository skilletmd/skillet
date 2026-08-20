// One error renderer (U6/KTD3): internal codes become a sentence plus the one
// next action; unknown text is cleaned, never dumped; registry-supplied text
// is sanitized (terminal-injection boundary); exit-code contracts hold.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { renderError, renderErrorLines } from "../src/render-error.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, "..", "src");

const CASES: Array<{ raw: string; mustNotContain: RegExp; hasNext: boolean }> = [
  {
    raw: "signature_invalid: @a/x bundle hashed to sha256:" + "a".repeat(64) + ", server stamped sha256:" + "b".repeat(64),
    mustNotContain: /sha256|signature_invalid/,
    hasNext: true,
  },
  { raw: "rollback_detected: manifest version 3 is older than local 4", mustNotContain: /rollback_detected/, hasNext: true },
  { raw: "manifest_empty: registry returned a 200 without a body", mustNotContain: /manifest_empty|200/, hasNext: true },
  { raw: "registry_missing: kit entry has no registryUrl — re-add to repair", mustNotContain: /registry_missing|registryUrl/, hasNext: true },
  { raw: "http_500: sync manifest request failed (HTTP 500)", mustNotContain: /http_500/, hasNext: true },
  { raw: "HTTP 401", mustNotContain: /401/, hasNext: true },
  { raw: "fetch failed", mustNotContain: /fetch failed/, hasNext: true },
];

test("known codes render as a sentence plus one next action, no internals", () => {
  for (const { raw, mustNotContain, hasNext } of CASES) {
    const { line, next } = renderError(raw);
    assert.doesNotMatch(line, mustNotContain, `line for ${raw.slice(0, 30)}`);
    assert.ok(line.length > 20, "a real sentence, not a code");
    assert.equal(next !== undefined, hasNext, `next for ${raw.slice(0, 30)}`);
  }
});

test("unknown reasons are cleaned: known code prefix dropped, hashes shortened", () => {
  const { line } = renderError("integrity_failed: something odd with sha256:" + "c".repeat(64) + " happened");
  assert.doesNotMatch(line, /^integrity_failed/);
  assert.doesNotMatch(line, /c{64}/);
  assert.match(line, /sha256:c{8}…/);
});

test("slug-shaped prefixes are NOT eaten — only known internal codes are", () => {
  const { line } = renderError("my-skill: boom");
  assert.match(line, /^my-skill: boom$/);
});

test("ANSI/OSC escapes in registry-supplied text never reach the terminal", () => {
  const hostile = "pull_failed: ]0;owned look [31mred[0m";
  for (const lineOut of renderErrorLines(hostile)) {
    assert.doesNotMatch(lineOut, /|/);
  }
});

test("exit-code and handler contracts hold in source", () => {
  const publish = readFileSync(join(srcDir, "commands", "publish.ts"), "utf8");
  assert.match(publish, /stale_base[\s\S]{0,200}ExitCode\.CONFLICT/);
  const connected = readFileSync(join(srcDir, "connected-sync.ts"), "utf8");
  assert.match(connected, /Sync didn't finish[\s\S]{0,300}process\.exitCode = 1/);
  const index = readFileSync(join(srcDir, "index.ts"), "utf8");
  assert.match(index, /SKILLET_DEBUG/);
  assert.match(index, /catch \(err\)/);
});
