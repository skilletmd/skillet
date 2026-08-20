import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Command, type Command as CommanderCommand } from "commander";
import { registerAllCommands } from "../src/commands/register-all.js";
import { formatSkilletHelp } from "../src/help-format.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = join(__dirname, "fixtures", "cli-surface.snapshot.txt");

function buildProgram(): Command {
  const program = new Command("skillet").version("test");
  program.configureHelp({
    formatHelp: formatSkilletHelp,
    sortSubcommands: false,
  });
  registerAllCommands(program);
  return program;
}

function normalizeSurface(surface: string): string {
  // Commander embeds process.cwd() in --cwd defaults; keep snapshots portable.
  return surface
    .replace(/\r\n/g, "\n")
    .replace(/\/Users\/[^\s")\n]+/g, "<path>")
    .replace(/\/home\/[^\s")\n]+/g, "<path>")
    .replace(/[A-Za-z]:\\[^\s")\n]+/g, "<path>");
}

function collectHelpSurface(program: CommanderCommand): string {
  const lines: string[] = [];

  const walk = (cmd: CommanderCommand, label: string): void => {
    lines.push("");
    lines.push(`# ${label}`);
    lines.push(cmd.helpInformation());
    for (const sub of cmd.commands) {
      if ((sub as CommanderCommand & { _hidden?: boolean })._hidden) continue;
      walk(sub, `${label} ${sub.name()}`.trim());
    }
  };

  lines.push(program.helpInformation());
  for (const cmd of program.commands) {
    if ((cmd as CommanderCommand & { _hidden?: boolean })._hidden) continue;
    walk(cmd, cmd.name());
  }
  return lines.join("\n");
}

test("full command help/flag surface matches snapshot", () => {
  const surface = normalizeSurface(collectHelpSurface(buildProgram()));
  const update = process.env["UPDATE_CLI_SNAPSHOT"] === "1";
  if (update) {
    mkdirSync(dirname(SNAPSHOT_PATH), { recursive: true });
    writeFileSync(SNAPSHOT_PATH, surface, "utf8");
    return;
  }
  const expected = normalizeSurface(readFileSync(SNAPSHOT_PATH, "utf8"));
  assert.equal(surface, expected);
});

test("sync registers --dry-run flag", () => {
  const program = buildProgram();
  const sync = program.commands.find((c) => c.name() === "sync");
  assert.ok(sync);
  const help = sync!.helpInformation();
  assert.match(help, /--dry-run/);
  assert.match(help, /--check/);
});

test("pending omits unused --cwd when legacy management is registered", () => {
  const program = new Command("skillet").version("test");
  program.configureHelp({
    formatHelp: formatSkilletHelp,
    sortSubcommands: false,
  });
  registerAllCommands(program, { legacyManagement: true });
  const pending = program.commands.find((c) => c.name() === "pending");
  assert.ok(pending);
  const help = pending!.helpInformation();
  assert.doesNotMatch(help, /--cwd/);
  assert.match(help, /--json/);
});

test("management verbs are absent from default registration and root help", () => {
  const program = buildProgram();
  assert.equal(program.commands.find((c) => c.name() === "publish"), undefined);
  assert.equal(program.commands.find((c) => c.name() === "pair"), undefined);
  assert.ok(program.commands.find((c) => c.name() === "add"));

  const rootHelp = stripAnsi(program.helpInformation());
  assert.doesNotMatch(rootHelp, /kit create/);
  assert.doesNotMatch(rootHelp, /publish \[slug\]/);
  assert.doesNotMatch(rootHelp, /^\s+pair\s+/m);
  assert.doesNotMatch(rootHelp, /auth connect/);
  assert.match(rootHelp, /add \[source\]/);
  assert.doesNotMatch(rootHelp, /^\s+import \[source\]\s/m);
  // Footer lists power-user commands by bare name (dot-separated).
  assert.match(rootHelp, /\bimport\b/);
  assert.match(rootHelp, /scan/);
  assert.doesNotMatch(rootHelp, /^\s+route\s/m);
  assert.match(rootHelp, /doctor/);
  assert.doesNotMatch(rootHelp, /^\s+status\s/m);
  assert.doesNotMatch(rootHelp, /^\s+trust\s/m);
  assert.match(rootHelp, /\btrust\b/);
  assert.doesNotMatch(rootHelp, /^\s+pin\s/m);
  assert.doesNotMatch(rootHelp, /update-mode/);
});

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}
