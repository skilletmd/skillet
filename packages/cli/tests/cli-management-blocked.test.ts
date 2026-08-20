import assert from "node:assert/strict";
import { Command, CommanderError } from "commander";
import test from "node:test";
import { registerAllCommands } from "../src/commands/register-all.js";
import { formatSkilletHelp } from "../src/help-format.js";

function buildProgram(legacyManagement = false): Command {
  const program = new Command("skillet").version("test");
  program.configureHelp({
    formatHelp: formatSkilletHelp,
    sortSubcommands: false,
  });
  registerAllCommands(program, { legacyManagement });
  program.showHelpAfterError();
  return program;
}

test("management commands are not registered by default", () => {
  const program = buildProgram(false);
  assert.equal(program.commands.find((c) => c.name() === "publish"), undefined);
  assert.equal(program.commands.find((c) => c.name() === "pair"), undefined);
  assert.ok(program.commands.find((c) => c.name() === "add"));
});

test("management commands register when legacy mode is on", () => {
  const program = buildProgram(true);
  assert.ok(program.commands.find((c) => c.name() === "publish"));
  assert.ok(program.commands.find((c) => c.name() === "kit"));
});

test("blocked management invocations are unknown commands", async () => {
  for (const args of [
    ["node", "skillet", "publish"],
    ["node", "skillet", "pair"],
    ["node", "skillet", "kit", "create", "x"],
  ]) {
    const program = buildProgram(false);
    const stderr: string[] = [];
    program.exitOverride();
    program.configureOutput({
      writeOut: () => undefined,
      writeErr: (str) => {
        stderr.push(str);
      },
    });

    await assert.rejects(
      () => program.parseAsync(args, { from: "node" }),
      (err: unknown) => {
        assert.ok(err instanceof CommanderError);
        assert.equal(err.code, "commander.unknownCommand");
        return true;
      },
    );
    assert.match(stderr.join(""), /unknown command/);
  }
});
