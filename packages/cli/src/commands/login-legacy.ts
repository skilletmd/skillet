import type { Command } from "commander";
import { login, claimHandle, secondaryDeviceMessage } from "@skillet/core";
import { ExitCode, exitWith } from "../exit-codes.js";

export function registerLoginLegacyCommands(program: Command): void {
  program
    .command("login")
    .description(
      "Claim a handle and create local Ed25519 author key (native app flow; use `skillet connect` to pair this machine)",
    )
    .requiredOption("--handle <handle>", "Your registry handle, e.g. taylor")
    .requiredOption("--name <name>", "Display name for your profile")
    .option("--avatar <url>", "Avatar URL")
    .option(
      "--registry <url>",
      "Registry base URL (defaults to SKILLET_REGISTRY_URL env var or the built-in default)",
      process.env["SKILLET_REGISTRY_URL"],
    )
    .option("--json", "Emit machine-readable identity JSON (for the native app)")
    .action(
      async (opts: {
        handle: string;
        name: string;
        avatar?: string;
        registry?: string;
        json?: boolean;
      }) => {
        try {
          const result = await login({
            handle: opts.handle,
            name: opts.name,
            ...(opts.avatar ? { avatarUrl: opts.avatar } : {}),
            ...(opts.registry ? { registryUrl: opts.registry } : {}),
          });
          const { identity, created } = result;
          if (opts.json) {
            process.stdout.write(JSON.stringify({ ok: true, created, identity }) + "\n");
            return;
          }
          console.log(
            created
              ? `✓ Registered @${identity.handle} on ${identity.registryUrl}`
              : `✓ Re-attached @${identity.handle} on ${identity.registryUrl}`,
          );
          console.log(`  key: ${identity.keyId.slice(0, 16)}…`);
          if (created) {
            // Recoverability nudge: a handle-claimed account has no email, so
            // losing this machine loses the account. Point to the non-forking
            // path (pair the browser, then add an email in Settings).
            console.log(
              `\n  Tip: add an email so you can recover this account and sign in on the web.\n` +
                `  Run \`skillet pair\`, connect your browser at the link it prints, then add an email in Settings → Account.`,
            );
          }
        } catch (err) {
          if (opts.json) {
            process.stdout.write(
              JSON.stringify({ ok: false, error: (err as Error).message }) + "\n",
            );
            exitWith(ExitCode.ERROR);
          }
          console.error(`✗ Login failed: ${(err as Error).message}`);
          exitWith(ExitCode.ERROR);
        }
      },
    );

  program
    .command("claim")
    .description(
      "Bind this machine as the primary signing key (first device only; use connect on additional machines)",
    )
    .option(
      "--registry <url>",
      "Registry base URL (defaults to SKILLET_REGISTRY_URL or identity registry)",
      process.env["SKILLET_REGISTRY_URL"],
    )
    .option("--token <token>", "Session token (defaults to $SKILLET_TOKEN)")
    .action(async (opts: { registry?: string; token?: string }) => {
      try {
        const result = await claimHandle({
          ...(opts.registry ? { registryUrl: opts.registry } : {}),
          ...(opts.token ? { token: opts.token } : {}),
        });
        if (result.primaryElsewhere) {
          console.log(`✓ ${secondaryDeviceMessage(result.handle)}`);
          return;
        }
        console.log(`✓ Claimed @${result.handle} with key ${result.key_id.slice(0, 16)}…`);
      } catch (err) {
        console.error(`✗ Claim failed: ${(err as Error).message}`);
        exitWith(ExitCode.ERROR);
      }
    });
}
