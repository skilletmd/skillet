import type { Command } from "commander";
import { authConnectPair } from "@skillet/core";
import { REGISTRY_DEFAULT } from "../cli-context.js";
import { webBaseUrl } from "../cli-command-tier.js";
import { ExitCode, exitWith } from "../exit-codes.js";
import { writeJsonError } from "../json-output.js";
import { ok, fail, dim, cyan } from "../cli-colors.js";
import { printRenderedError } from "../render-error.js";
import { runConnectedSync, detectedAgentsPhrase, pairInteractively } from "../connected-sync.js";

export function registerConnectCommand(program: Command): void {
  program
    .command("connect [code]")
    .description("Link this machine with a pair code from skillet.md Settings")
    .option("--registry <url>", "Registry base URL", REGISTRY_DEFAULT)
    .option("--label <label>", "Label for this machine in settings")
    .option("--client <kind>", "Client surface: cli or desktop", "cli")
    .option("--json", "Emit machine-readable result")
    .action(async (codeArg: string | undefined, opts: { registry: string; label?: string; client: string; json?: boolean }) => {
      const clientKind = opts.client === 'desktop' ? 'desktop' : 'cli';
      const pairOpts = {
        registryUrl: opts.registry,
        ...(opts.label ? { label: opts.label } : {}),
        clientKind,
      } as const;
      const interactive = !opts.json && process.stdout.isTTY === true;
      const code = codeArg?.trim() ?? "";

      const printSuccessAndSync = async (result: Awaited<ReturnType<typeof authConnectPair>>) => {
        const who = result.handle ? `@${result.handle}` : "your account";
        console.log(ok(`Connected this machine to ${who}`));
        console.log(dim(`  added as ${result.label}`));
        console.log(dim(`  Manage pairing at `) + cyan(`${webBaseUrl()}/settings`));
        // Pairing ends in a synced machine, same as the desktop: no homework.
        await runConnectedSync(false);
      };

      // Prompt-and-retry loop for humans: bad codes re-prompt, Esc leaves quietly.
      const promptLoop = async () => {
        const result = await pairInteractively(pairOpts);
        if (!result) {
          exitWith(ExitCode.ERROR);
          return;
        }
        console.log("");
        await printSuccessAndSync(result);
      };

      // No code on an interactive terminal: ask for it here instead of making
      // the user retype the command after fetching one.
      if (!code && interactive) {
        console.log(`  Connect this machine to your account to use your skills ${await detectedAgentsPhrase()}.`);
        console.log(dim("  Get a pair code at ") + cyan(`${webBaseUrl()}/settings`));
        await promptLoop();
        return;
      }
      if (!code) {
        if (opts.json) {
          writeJsonError("missing pair code");
        } else {
          console.error(fail("No pair code provided."));
          console.error(dim("  Run `skillet connect <code>` with a code from ") + cyan(`${webBaseUrl()}/settings`));
        }
        exitWith(ExitCode.ERROR);
        return;
      }
      try {
        const result = await authConnectPair({ code, ...pairOpts });
        if (opts.json) {
          // Tokens stay out of the JSON surface — they're already persisted to
          // SKILLET_DIR, and stdout ends up in logs and tray transcripts.
          const { device_id, handle, user_id } = result;
          process.stdout.write(JSON.stringify({ ok: true, device_id, handle, user_id }, null, 2) + "\n");
          return;
        }
        await printSuccessAndSync(result);
      } catch (err) {
        const message = (err as Error).message;
        if (opts.json) {
          // Keep the raw message on the JSON surface: the desktop tray parses it.
          writeJsonError(message);
        }
        const reason = message.replace(/^Could not connect with pair code:\s*/i, "");
        printRenderedError(reason, (what) => fail(`Could not connect: ${what}`));
        if (interactive) {
          // The typed code failed but a human is right here — offer the
          // prompt instead of making them rebuild the command line.
          console.log(dim("  Get a fresh code at ") + cyan(`${webBaseUrl()}/settings`));
          await promptLoop();
          return;
        }
        console.error(dim("  Try again with a fresh code from ") + cyan(`${webBaseUrl()}/settings`));
        exitWith(ExitCode.ERROR);
      }
    });
}
