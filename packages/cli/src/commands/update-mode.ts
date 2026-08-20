import type { Command } from "commander";
import { RegistryClient, loadSessionToken } from "@skillet/core";
import { resolveRegistryUrl } from "../cli-context.js";
import { ExitCode, exitWith } from "../exit-codes.js";

/** Build an account-scoped RegistryClient from the stored session (or overrides).
 *  update-mode is account-scoped, so a session bearer is required. */
async function accountClient(opts: { registry?: string; token?: string }): Promise<RegistryClient> {
  const registryUrl = await resolveRegistryUrl(opts);
  const token = await loadSessionToken(opts.token);
  if (!token) {
    console.error("✗ Not signed in. Pair this machine with `skillet connect <code>`.");
    exitWith(ExitCode.AUTH);
  }
  return new RegistryClient({ baseUrl: registryUrl, token });
}

const label = (mode: "auto" | "manual"): string =>
  mode === "auto" ? "ON (auto)" : "OFF (manual)";

export function registerUpdateModeCommand(program: Command): void {
  program
    .command("update-mode [mode]", { hidden: true })
    .description(
      "Show or set whether subscribed skills auto-update. <mode>: auto | manual. No arg prints the current mode.",
    )
    .option("--registry <url>", "Registry base URL (overrides identity default)")
    .option("--token <token>", "Session bearer token (overrides the stored session)")
    .option("--json", "Emit raw JSON")
    .action(
      async (
        mode: string | undefined,
        opts: { registry?: string; token?: string; json?: boolean },
      ) => {
        try {
          const client = await accountClient(opts);

          if (mode === undefined) {
            const { update_mode } = await client.getMyDecisions();
            if (opts.json) {
              console.log(JSON.stringify({ mode: update_mode }));
              return;
            }
            console.log(`Auto-update is ${label(update_mode)}.`);
            return;
          }

          if (mode !== "auto" && mode !== "manual") {
            console.error(`✗ Invalid mode "${mode}". Use "auto" or "manual".`);
            exitWith(ExitCode.USAGE);
          }

          const result = await client.setUpdateMode(mode);
          if (opts.json) {
            console.log(JSON.stringify(result));
            return;
          }
          console.log(`✓ Auto-update set to ${label(result.mode)}.`);
          if (result.mode === "auto" && result.applied > 0) {
            console.log(`  Applied ${result.applied} pending update${result.applied === 1 ? "" : "s"}.`);
          }
        } catch (err) {
          console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
          exitWith(ExitCode.ERROR);
        }
      },
    );
}
