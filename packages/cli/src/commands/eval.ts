import type { Command } from "commander";
import { evalSkills } from "@skillet/core";
import { ExitCode } from "../exit-codes.js";

export function registerEvalCommand(program: Command): void {
  program
    .command("eval [slug]")
    .description("Run the static basic eval (evals/smoke.json) against kit skill(s)")
    .option("--json", "Emit machine-readable results")
    .action(async (slug: string | undefined, opts: { json?: boolean }) => {
      const slugs = slug ? [slug] : undefined;
      const results = await evalSkills(slugs);
      if (opts.json) {
        process.stdout.write(JSON.stringify({ ok: true, results }) + "\n");
        return;
      }
      for (const r of results) {
        const label = r.status === "passed" ? "PASS" : r.status === "failed" ? "FAIL" : "SKIP";
        console.log(`${label}  ${r.slug}  (${r.status})`);
        if (r.case_results) {
          for (const c of r.case_results) {
            const mark = c.passed ? "  ✓" : "  ✗";
            console.log(`${mark} ${c.id}${c.missing ? ` (missing: ${c.missing.join(", ")})` : ""}`);
          }
        }
      }
      const failed = results.some((r) => r.status === "failed");
      if (failed) process.exitCode = ExitCode.ERROR;
    });
}
