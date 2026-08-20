import type { Command } from "commander";
import { listTrash, restoreTrash } from "@skillet/core";
import { ExitCode, exitWith } from "../exit-codes.js";

function relTime(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return iso;
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function registerRestoreCommand(program: Command): void {
  program
    .command("restore [run]")
    .description(
      "Restore skills a sync prune moved to trash. No args lists runs; pass a run id or `latest`.",
    )
    .option("--json", "Emit machine-readable output")
    .action(async (run: string | undefined, opts: { json?: boolean }) => {
      const asJson = opts.json === true;

      // No arg → list restorable runs.
      if (!run) {
        const runs = await listTrash();
        if (asJson) {
          process.stdout.write(JSON.stringify({ ok: true, runs }, null, 2) + "\n");
          return;
        }
        if (runs.length === 0) {
          console.log("Nothing in trash to restore.");
          return;
        }
        console.log("Trashed by sync prune (restore with `skillet restore <id>` or `latest`):\n");
        for (const r of runs) {
          console.log(
            `  ${r.id}  · ${relTime(r.trashedAt)} · ${r.skills.length} skill${r.skills.length === 1 ? "" : "s"}`,
          );
          console.log(`    ${r.skills.join(", ")}`);
        }
        return;
      }

      const runId = run === "latest" ? undefined : run;
      const result = await restoreTrash(runId);

      if (asJson) {
        process.stdout.write(JSON.stringify({ ok: result != null, result }, null, 2) + "\n");
        if (result == null) exitWith(ExitCode.ERROR);
        return;
      }

      if (result == null) {
        console.log(run === "latest" ? "Nothing in trash to restore." : `No trash run "${run}".`);
        exitWith(ExitCode.ERROR);
        return;
      }

      if (result.restored.length > 0) {
        console.log(
          `Restored ${result.restored.length} skill${result.restored.length === 1 ? "" : "s"}: ${result.restored.join(", ")}`,
        );
      } else {
        console.log("Nothing restored. Every item was already in place or missing.");
      }
      for (const s of result.skipped) {
        console.log(`  skipped ${s.slug} (${s.reason})`);
      }
    });
}
