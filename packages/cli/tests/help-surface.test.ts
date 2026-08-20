// Help single-sourcing (U5/KTD5): root help renders each command's real
// .description(), every advertised row provably resolves to a registered
// command (the class of bug where help teaches `skillet whoami` and the
// command doesn't exist), and no visible description leaks tickets or
// internal vocabulary.
import assert from "node:assert/strict";
import test from "node:test";
import { Command } from "commander";
import { registerAllCommands } from "../src/commands/register-all.js";
import { formatSkilletHelp } from "../src/help-format.js";
import { ROOT_SURFACE, resolveCommandDescription } from "../src/help/root-surface.js";

function buildProgram(): Command {
  const program = new Command("skillet").version("0.0.0-test");
  program.configureHelp({ formatHelp: formatSkilletHelp, sortSubcommands: false });
  registerAllCommands(program);
  return program;
}

test("every advertised surface row resolves to a registered command", () => {
  const program = buildProgram();
  // Legacy-tier rows register only behind SKILLET_LEGACY_CLI; they are not
  // advertised in help, so they may be absent from a default build.
  const unresolved = ROOT_SURFACE.filter(
    (row) => row.tier !== "legacy" && resolveCommandDescription(program, row.command) === null,
  ).map((row) => row.command);
  assert.deepEqual(unresolved, [], `advertised but not registered: ${unresolved.join(", ")}`);
});

test("root help renders the registered descriptions — one source, no drift", () => {
  const program = buildProgram();
  const help = program.createHelp();
  const rendered = formatSkilletHelp(program, help);
  for (const id of ["sync", "add", "usage", "connect", "doctor"]) {
    const desc = resolveCommandDescription(program, id);
    assert.ok(desc, `${id} must be registered`);
    assert.ok(rendered.includes(desc!), `root help must render ${id}'s own description`);
  }
});

test("no visible description leaks tickets or internal vocabulary", () => {
  const program = buildProgram();
  const banned = /GUI|AC #|runtime|materiali[zs]|for the desktop app|Harm-scan/i;
  const stripCompat = (d: string) => d.replace(/--runtime(?: <runtime>)?( cursor)?/g, "");
  const offenders: string[] = [];
  const walk = (cmd: Command, path: string): void => {
    for (const sub of cmd.commands) {
      const subPath = path ? `${path} ${sub.name()}` : sub.name();
      // Hidden commands are compat plumbing; visible ones are the contract.
      if (!(sub as unknown as { _hidden?: boolean })._hidden) {
        const desc = stripCompat(sub.description());
        if (banned.test(desc)) offenders.push(`${subPath}: ${desc}`);
      }
      walk(sub as Command, subPath);
    }
  };
  walk(program, "");
  assert.deepEqual(offenders, [], `jargon in descriptions:\n${offenders.join("\n")}`);
});
