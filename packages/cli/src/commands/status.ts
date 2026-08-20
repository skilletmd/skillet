import type { Command } from "commander";
import {
  status as statusCommand,
  readState,
  listPending,
  activityState,
  authStatus,
  type StatusEntry,
} from "@skillet/core";
import { ALL_ADAPTERS, countUserSkills } from "../cli-context.js";
import { detectAdapterNames } from "../adapter-tiers.js";
import { webBaseUrl } from "../cli-command-tier.js";
import { dim, cyan, green, yellow, bold, ok } from "../cli-colors.js";
import { ExitCode, exitWith } from "../exit-codes.js";

async function runScanReport(opts: { json?: boolean }): Promise<void> {
  const report = await statusCommand();
  if (opts.json === true) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    if (report.hasQuarantined) {
      exitWith(ExitCode.ERROR);
    }
    return;
  }
  if (report.total === 0) {
    console.log("Kit is empty.");
    console.log(dim("  Add skills at ") + cyan(webBaseUrl()));
    console.log(dim("  Or import local skills with `skillet import <path>`"));
    return;
  }
  const summary = [
    `quarantined=${report.byBucket.quarantined}`,
    `flagged=${report.byBucket.flagged}`,
    `pending=${report.byBucket.pending}`,
    `clean=${report.byBucket.clean}`,
  ].join(" · ");
  console.log(`${report.total} skill(s): ${summary}\n`);

  const glyph = (e: StatusEntry): string => {
    if (e.bucket === "quarantined") return "⛔";
    if (e.bucket === "flagged") return yellow("⚠ ");
    if (e.bucket === "pending") return dim("…");
    return green("✓");
  };

  for (const entry of report.entries) {
    const tail =
      entry.bucket === "clean"
        ? ""
        : entry.bucket === "pending"
          ? "  (scan in progress)"
          : `  (${entry.totalFindings} finding${entry.totalFindings === 1 ? "" : "s"}, top=${entry.topConfidence})`;
    console.log(`  ${glyph(entry)} ${entry.slug}${tail}`);
  }

  if (report.hasQuarantined) {
    console.log(
      "\nQuarantined entries require `--allow-quarantined` (CI) or interactive consent before they apply.",
    );
    exitWith(ExitCode.ERROR);
  }
}

/** One screen: who, how many skills, how many agents, what's waiting. */
async function runOverview(): Promise<void> {
  // All five reads are independent — one round of concurrency instead of a
  // serial chain (listPending includes a network read; detect() hits disk).
  const [state, auth, waiting, agents, stats] = await Promise.all([
    readState(),
    authStatus().catch(() => null),
    listPending(ALL_ADAPTERS).then(
      (r) => r.pending.length,
      () => 0, // pending count is a nicety here, never a blocker
    ),
    detectAdapterNames(ALL_ADAPTERS),
    activityState().catch(() => null),
  ]);
  const skills = countUserSkills(state);

  const handle = auth?.whoami?.handle ?? auth?.identity?.handle ?? null;
  console.log("");
  if (handle) {
    console.log(`  ${ok(`Connected as @${handle}`)}`);
  } else {
    console.log(`  Not connected. ${dim("Pair with")} ${cyan(bold("skillet connect <code>"))}`);
  }
  console.log(`  ${bold(String(skills))} skill${skills === 1 ? "" : "s"} in your kit · ${agents.length} agent${agents.length === 1 ? "" : "s"} on this machine`);
  if (waiting > 0) {
    console.log(`  ${waiting} skill${waiting === 1 ? "" : "s"} waiting for review ${dim("· skillet pending")}`);
  }
  if (stats) {
    // Unpaired machines cannot sync stats regardless of the flag — say what
    // is actually happening, not what the setting would do with an account.
    const syncing = stats.recording && handle !== null;
    console.log(`  Skill stats: ${syncing ? "syncing to your account" : "on this machine only"}`);
  }
  console.log("");
}

function attachScanOptions(cmd: Command): void {
  cmd.option("--json", "Emit a machine-readable scan report");
}

export function registerStatusCommand(program: Command): void {
  const scanCmd = program
    .command("scan")
    .description("Check your kit for unsafe skills");

  attachScanOptions(scanCmd);
  scanCmd.action(async (opts: { json?: boolean }) => {
    await runScanReport(opts);
  });

  // `status` is two commands in one, split by surface:
  //   - `--json` keeps the harm-scan report shape AND its non-zero exit on
  //     quarantined entries — the desktop tray parses exactly this
  //     (src-tauri lib.rs scan_status), so the shape is a compat contract.
  //   - the human path is the at-a-glance overview a person means by "status".
  // Hidden from help: `doctor` is the human diagnostic. Still registered and
  // callable so scripts and fall-through paths keep working.
  const statusCmd = program
    .command("status", { hidden: true })
    .description("Your connection, kit, agents, and anything waiting");

  attachScanOptions(statusCmd);
  statusCmd.action(async (opts: { json?: boolean }) => {
    if (opts.json === true) {
      await runScanReport(opts);
      return;
    }
    await runOverview();
  });
}
