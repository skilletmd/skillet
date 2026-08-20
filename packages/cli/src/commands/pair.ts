import type { Command } from "commander";
import { mintPairCode } from "@skillet/core";
import { REGISTRY_DEFAULT } from "../cli-context.js";
import { ExitCode, exitWith } from "../exit-codes.js";

export function registerPairCommand(program: Command): void {
  program
    .command("pair")
    .description("Mint a join code to attach another device, browser, or app to this account")
    .option("--registry <url>", "Registry base URL", REGISTRY_DEFAULT)
    .option("--json", "Emit machine-readable result")
    .action(async (opts: { registry: string; json?: boolean }) => {
      try {
        const result = await mintPairCode({ registryUrl: opts.registry });
        if (opts.json) {
          process.stdout.write(JSON.stringify({ ok: true, ...result }, null, 2) + "\n");
          return;
        }
        const mins = Math.round(result.ttl_sec / 60);
        console.log(`Join code: ${result.code}`);
        console.log(`  Expires in ${mins} min.`);
        console.log(`  On the other device, run: skillet connect ${result.code}`);
        console.log(`  Or paste it into skillet.md → Settings → Devices, or the desktop app.`);
      } catch (err) {
        console.error(`✗ pair failed: ${(err as Error).message}`);
        exitWith(ExitCode.ERROR);
      }
    });
}
