import assert from "node:assert/strict";
import { Command, CommanderError } from "commander";
import test from "node:test";
import { CLI_VERSION } from "../src/cli-context.js";

test("skillet -v and --version print semver", async () => {
  for (const flag of ["-v", "--version"]) {
    const program = new Command("skillet").version(
      CLI_VERSION,
      "-v, --version",
      "Show CLI version",
    );
    const stdout: string[] = [];
    program.configureOutput({
      writeOut: (str) => {
        stdout.push(str);
      },
      writeErr: () => undefined,
    });
    program.exitOverride();

    await assert.rejects(
      () => program.parseAsync(["node", "skillet", flag], { from: "node" }),
      (err: unknown) => {
        assert.ok(err instanceof CommanderError);
        assert.equal(err.code, "commander.version");
        assert.equal(err.exitCode, 0);
        return true;
      },
    );
    assert.match(stdout.join(""), new RegExp(`^${CLI_VERSION}\\n?$`));
  }
});
