import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Command } from "commander";
import { registerAllCommands } from "../src/commands/register-all.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Verbs that exist ONLY behind SKILLET_LEGACY_CLI=1, derived from the CLI's
 *  own registration so this list can never drift from reality. */
function managementOnlyVerbs(): Set<string> {
  const names = (legacy: boolean): Set<string> => {
    const p = new Command("skillet").version("test");
    registerAllCommands(p, { legacyManagement: legacy });
    return new Set(p.commands.map((c) => c.name()));
  };
  const device = names(false);
  return new Set([...names(true)].filter((n) => !device.has(n)));
}

function markdownFilesUnder(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e);
      if (statSync(full).isDirectory()) walk(full);
      else if (e.endsWith(".md")) out.push(full);
    }
  };
  walk(root);
  return out;
}

// A doc or skill that tells someone to run `skillet <verb>` is a promise the CLI
// has to keep. Management verbs exist only behind SKILLET_LEGACY_CLI=1, so on a
// default install that line is `error: unknown command`. Worse in a skill, which
// an agent executes verbatim.
//
// This caught four real ones: docs/skill-md.md, write-a-skill,
// skillet-onboarding, and skillet-sync all told people to run `skillet publish`,
// which has been a legacy alias of `upload` since the naming contract landed.
//
// Escape hatch: prefix the line with SKILLET_LEGACY_CLI=1, which is how
// docs/cli.md and docs/publish.md legitimately document these verbs.
test("docs and bundled skills only cite verbs that run on a default install", () => {
  const management = managementOnlyVerbs();
  assert.ok(management.size > 0, "expected some management-tier verbs to exist");

  const files = [
    ...markdownFilesUnder(join(REPO, "skills")),
    ...markdownFilesUnder(join(REPO, "packages", "web", "content", "docs")),
    ...markdownFilesUnder(join(REPO, "packages", "cli", "bundled-skills")),
  ];
  assert.ok(files.length > 5, "expected to find docs and skills to scan");

  const offenders: string[] = [];
  for (const file of files) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (line.includes("SKILLET_LEGACY_CLI")) return;
      for (const m of line.matchAll(/`?\bskillet ([a-z][a-z-]*)/g)) {
        const verb = m[1]!;
        if (management.has(verb)) {
          offenders.push(`${relative(REPO, file)}:${i + 1}  skillet ${verb}`);
        }
      }
    });
  }

  assert.deepEqual(
    offenders,
    [],
    `These cite a verb that only exists behind SKILLET_LEGACY_CLI=1:\n  ${offenders.join("\n  ")}\n` +
      `Management-tier verbs: ${[...management].sort().join(", ")}`,
  );
});
