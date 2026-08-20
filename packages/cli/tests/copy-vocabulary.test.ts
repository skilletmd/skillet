// One vocabulary, enforced (U4/KTD4): user-facing copy says "agent", never
// runtime/adapter; changes "apply", never materialize; no TOFU, no "Library".
// Scans string literals in the user-visible surfaces so a regression fails a
// test instead of shipping. Flags and JSON keys kept for compat are stripped
// before scanning; single-word literals (enum values, object keys) and module
// paths are not user copy and are skipped.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliSrc = join(__dirname, "..", "src");
const coreSrc = join(__dirname, "..", "..", "core", "src");

// The user-visible string surfaces this rule covers. Growing this list is
// encouraged; shrinking it needs a reason in the commit message.
const SCANNED_FILES = [
  join(cliSrc, "commands", "runtimes.ts"),
  join(cliSrc, "commands", "usage.ts"),
  join(cliSrc, "commands", "activity.ts"),
  join(cliSrc, "commands", "edits.ts"),
  join(cliSrc, "commands", "sync.ts"),
  join(cliSrc, "commands", "add-cmd.ts"),
  join(cliSrc, "commands", "route-cmd.ts"),
  join(cliSrc, "commands", "pending.ts"),
  join(cliSrc, "commands", "status.ts"),
  join(cliSrc, "commands", "import-cmd.ts"),
  join(cliSrc, "commands", "list.ts"),
  join(cliSrc, "commands", "pin.ts"),
  join(cliSrc, "commands", "doctor.ts"),
  join(cliSrc, "commands", "avatar.ts"),
  join(cliSrc, "commands", "auth.ts"),
  join(cliSrc, "commands", "connect.ts"),
  join(cliSrc, "commands", "export.ts"),
  join(cliSrc, "commands", "publish.ts"),
  join(cliSrc, "commands", "sweep.ts"),
  join(cliSrc, "commands", "upload-cmd.ts"),
  join(cliSrc, "commands", "web-cmd.ts"),
  join(cliSrc, "commands", "update-mode.ts"),
  join(cliSrc, "apply-to-agents.ts"),
  join(cliSrc, "cli-add-present.ts"),
  join(cliSrc, "render-error.ts"),
  join(cliSrc, "cli-add-adapters.ts"),
  join(cliSrc, "kit-list-format.ts"),
  join(cliSrc, "connected-sync.ts"),
  join(cliSrc, "home-menu.ts"),
  join(cliSrc, "help", "root-surface.ts"),
  join(coreSrc, "metrics.ts"),
  join(coreSrc, "commands", "edits.ts"),
  join(coreSrc, "trust", "quarantine.ts"),
];

// Flag names and placeholders kept for compatibility — vocabulary rules do not
// rename flags (scripts depend on them). Stripped before the banned-word scan.
const COMPAT_TOKENS = [
  /--runtime(?: <runtime>)?/g,
  /-a, --adapter(?: <name>)?/g,
  /--adapter(?: <name>)?/g,
  /--allow-quarantined/g,
];

const BANNED: Array<{ name: string; re: RegExp }> = [
  { name: "runtime", re: /runtime/i },
  { name: "adapter", re: /adapter/i },
  { name: "materialize", re: /materiali[zs]/i },
  { name: "TOFU", re: /\bTOFU\b/ },
  { name: "Library", re: /\bLibrary\b/ },
];

const LITERAL_RE = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/gs;

function stripComments(source: string): string {
  // Crude but sufficient for a lint: block comments go entirely; line
  // comments go from // to EOL when the line's code part holds no quote
  // (avoids eating URLs inside strings).
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("//");
      if (idx === -1) return line;
      const before = line.slice(0, idx);
      const quotes = (before.match(/['"`]/g) ?? []).length;
      return quotes % 2 === 0 && !before.includes("://") ? before : line;
    })
    .join("\n");
}

function userCopyLiterals(source: string): string[] {
  const found: string[] = [];
  for (const match of stripComments(source).matchAll(LITERAL_RE)) {
    let literal = match[0].slice(1, -1);
    // Interpolations are code, not copy — scan only the prose around them.
    literal = literal.replace(/\$\{[^}]*\}/g, " ");
    // Not user copy: module paths and bare keys/enum values (no spaces).
    if (!literal.trim().includes(" ")) continue;
    if (/^(\.|@|node:)/.test(literal)) continue;
    found.push(literal);
  }
  return found;
}

test("user-facing copy holds the vocabulary line", () => {
  const violations: string[] = [];
  for (const file of SCANNED_FILES) {
    const source = readFileSync(file, "utf8");
    for (const literal of userCopyLiterals(source)) {
      let cleaned = literal;
      for (const token of COMPAT_TOKENS) cleaned = cleaned.replace(token, "");
      for (const { name, re } of BANNED) {
        if (re.test(cleaned)) {
          violations.push(`${file.split("/packages/")[1]}: [${name}] "${literal.slice(0, 90)}"`);
        }
      }
    }
  }
  assert.deepEqual(violations, [], `banned vocabulary in user copy:\n${violations.join("\n")}`);
});

test("the compat allowlist itself still exists (no silent rot)", () => {
  const addCmd = readFileSync(join(cliSrc, "commands", "add-cmd.ts"), "utf8");
  const routeCmd = readFileSync(join(cliSrc, "commands", "route-cmd.ts"), "utf8");
  assert.match(addCmd, /--adapter <name>/);
  assert.match(routeCmd, /--runtime <runtime>/);
});
