import assert from "node:assert/strict";
import { Command, CommanderError } from "commander";
import test from "node:test";
import { shouldRunOnboardingWizard } from "../src/cli-routing.js";
import { registerAllCommands } from "../src/commands/register-all.js";
import { formatSkilletHelp } from "../src/help-format.js";

function buildProgram(): Command {
  const program = new Command("skillet").version("test");
  program.configureHelp({
    formatHelp: formatSkilletHelp,
    sortSubcommands: false,
  });
  registerAllCommands(program);
  program.showHelpAfterError();
  return program;
}

test("shouldRunOnboardingWizard is true only with no user args", () => {
  assert.equal(shouldRunOnboardingWizard(["node", "skillet"]), true);
  assert.equal(shouldRunOnboardingWizard(["node", "skillet", "sync"]), false);
  assert.equal(shouldRunOnboardingWizard(["node", "skillet", "--help"]), false);
  assert.equal(shouldRunOnboardingWizard(["node", "skillet", "sghagsh"]), false);
});

test("unknown subcommand shows grouped help instead of running a command", async () => {
  const program = buildProgram();
  const stderr: string[] = [];
  program.exitOverride();
  program.configureOutput({
    writeOut: () => undefined,
    writeErr: (str) => {
      stderr.push(str);
    },
  });

  await assert.rejects(
    () => program.parseAsync(["node", "skillet", "sghagsh"], { from: "node" }),
    (err: unknown) => {
      assert.ok(err instanceof CommanderError);
      assert.equal(err.code, "commander.unknownCommand");
      return true;
    },
  );

  const text = stderr.join("");
  assert.match(text, /unknown command 'sghagsh'/);
  assert.match(text, /Getting started/);
  assert.doesNotMatch(text, /Step 1 — Import/);
});
