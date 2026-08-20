import type { Command } from "commander";
import { readRouteHistory, usageViews, USAGE_DEADWEIGHT_DAYS } from "@skillet/core";
import { bold, dim } from "../cli-colors.js";

/** Short relative last-used label ("today", "3d ago", "5w ago"). */
function lastUsedLabel(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days <= 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 14) return `${days}d ago`;
  if (days < 60) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/**
 * `skillet usage [--json]` — your routed skills from the LOCAL route history:
 * invocation count, last-used, the runtimes each fired on, and dead-weight prune
 * flags. Pure local read (no registry), so it works offline and for
 * anonymous users. The desktop/web surfaces consume the same `--json` shape.
 */
export function registerUsageCommand(program: Command): void {
  program
    .command("usage")
    .description("Skill stats on this machine (local only)")
    .option("--json", "Emit a machine-readable usage list")
    .action(async (opts: { json?: boolean }) => {
      const history = await readRouteHistory();
      const views = usageViews(history);

      if (opts.json === true) {
        process.stdout.write(JSON.stringify({ ok: true, skills: views }, null, 2) + "\n");
        return;
      }

      if (views.length === 0) {
        console.log(
          "No /skillet routes recorded yet.\n" +
            "Use `/skillet <task>` in your agent, or run `skillet sync` to add skills.",
        );
        return;
      }

      const refWidth = Math.max(6, ...views.map((v) => v.skillRef.length));
      console.log(bold(`${"SKILL".padEnd(refWidth)}  USES  LAST       AGENTS`));
      for (const v of views) {
        const runtimes = Object.keys(v.runtimes).join(", ") || "—";
        const flag = v.deadWeight ? dim("  (prune?)") : "";
        console.log(
          `${v.skillRef.padEnd(refWidth)}  ${String(v.count).padStart(4)}  ${lastUsedLabel(
            v.lastUsed,
          ).padEnd(9)}  ${runtimes}${flag}`,
        );
      }

      const dead = views.filter((v) => v.deadWeight).length;
      if (dead > 0) {
        console.log(
          dim(`\n${dead} skill(s) not routed in ${USAGE_DEADWEIGHT_DAYS}+ days: prune candidates.`),
        );
      }
    });
}
