import type { Command } from "commander";
import { resolve } from "node:path";
import { sweepOrphans } from "@skillet/core";

export function registerSweepCommand(program: Command): void {
  program
    .command("sweep <path>")
    .description("Move a removed agent's skill folders to the trash (restorable)")
    .option("--json", "Emit machine-readable output")
    .action(async (path: string, opts: { json?: boolean }) => {
      const res = await sweepOrphans(resolve(path));
      if (opts.json === true) {
        process.stdout.write(JSON.stringify({ ok: true, ...res }, null, 2) + "\n");
        return;
      }
      if (res.trashed.length === 0) {
        console.log(`No Skillet-managed folders found under ${path}.`);
        return;
      }
      console.log(
        `Moved ${res.trashed.length} Skillet folder(s) to trash: ${res.trashed.join(", ")}`,
      );
      console.log(`  → ${res.trashDir} (restore with \`skillet restore\`)`);
    });
}
