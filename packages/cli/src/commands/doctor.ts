import type { Command } from "commander";
import { collectDoctorReport } from "@skillet/core";
import { ALL_ADAPTERS } from "../cli-context.js";
import { ExitCode, exitWith } from "../exit-codes.js";
import { fail } from "../cli-colors.js";

function formatDoctorHuman(report: Awaited<ReturnType<typeof collectDoctorReport>>): string {
  const lines: string[] = [];
  lines.push(`Skillet doctor (${report.schema})`);
  lines.push(`Generated: ${report.generated_at}`);
  lines.push("");

  lines.push("Auth / enrollment");
  lines.push(`  bearer: ${report.auth.bearer.kind}`);
  if (report.auth.bearer.tokenPreview) {
    lines.push(`  token: ${report.auth.bearer.tokenPreview}`);
  }
  lines.push(`  linked machine: ${report.auth.linked_machine ? "yes" : "no"}`);
  if (report.auth.whoami?.handle) {
    lines.push(`  whoami: @${report.auth.whoami.handle}`);
  } else if (report.auth.credential_rejected) {
    lines.push("  whoami: credential rejected. This machine was disconnected; re-pair with `skillet connect`");
  } else if (report.auth.whoami === null && report.auth.bearer.kind !== "none") {
    lines.push("  whoami: unreachable (offline or registry error)");
  }
  if (report.device.device_id) {
    lines.push(`  device id: ${report.device.device_id}`);
  }
  if (report.device.label) {
    lines.push(`  device label: ${report.device.label}`);
  }
  // Signing identity — the state `auth status` used to show. Surfacing it here
  // is what makes hiding that command lossless: is there a local signing key,
  // and does it match the account's registry primary?
  const who = report.auth.whoami;
  if (who?.user_id) {
    lines.push(`  user: ${who.user_id.slice(0, 8)}…`);
  }
  const remotePrimary = who?.author_key_id ?? null;
  const localKey = report.auth.identity?.keyId ?? null;
  if (remotePrimary) {
    lines.push(`  registry primary key: ${remotePrimary.slice(0, 16)}…`);
  }
  lines.push(
    localKey
      ? `  local signing key: ${localKey.slice(0, 16)}… ${
          remotePrimary && localKey !== remotePrimary ? "(not registry primary)" : "(registry primary)"
        }`
      : "  local signing key: none",
  );
  lines.push("");

  lines.push("Local state");
  lines.push(`  skills: ${report.state.skill_count}`);
  if (report.state.slugs_sample.length > 0) {
    lines.push(`  sample: ${report.state.slugs_sample.join(", ")}`);
  }
  lines.push(`  edited reported: ${report.state.edited_reported ? "yes" : "no"}`);
  lines.push(`  pending updates: ${report.pending.count}`);
  if (report.pending.slugs.length > 0) {
    lines.push(`  pending slugs: ${report.pending.slugs.join(", ")}`);
  }
  lines.push(`  pinned authors: ${report.pins.handles.length}`);
  if (report.pins.handles.length > 0) {
    lines.push(`  pin handles: ${report.pins.handles.join(", ")}`);
  }
  lines.push("");

  lines.push("Environment");
  lines.push(`  session precedence: ${report.env.session_token_precedence}`);
  lines.push(`  SKILLET_TOKEN set: ${report.env.skillet_token_set ? "yes" : "no"}`);
  lines.push(`  SKILLET_TOKEN_FORCE: ${report.env.skillet_token_force ? "yes" : "no"}`);
  lines.push(`  SKILLET_DAEMON: ${report.env.skillet_daemon ? "yes" : "no"}`);
  if (report.env.skillet_registry_url) {
    lines.push(`  SKILLET_REGISTRY_URL: ${report.env.skillet_registry_url}`);
  }
  lines.push(`  SKILLET_DIR override: ${report.env.skillet_dir_override ? "yes" : "no"}`);
  lines.push("");

  lines.push("Paths");
  lines.push(`  skillet dir: ${report.paths.skillet_dir}`);
  lines.push(`  state: ${report.paths.state_file}`);
  lines.push(`  session: ${report.paths.session_file}`);
  lines.push(`  device: ${report.paths.device_file}`);
  lines.push(`  approval lock: ${report.paths.approval_lock}`);
  lines.push(`  pin dir: ${report.paths.pin_dir}`);
  lines.push("");

  if (report.auth.hints.length > 0) {
    lines.push("Hints");
    for (const hint of report.auth.hints) {
      lines.push(`  • ${hint}`);
    }
  }

  return lines.join("\n") + "\n";
}

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Auth, sync state, pending updates, and paths")
    .option("--json", "Emit machine-readable doctor report")
    .action(async (opts: { json?: boolean }) => {
      try {
        const report = await collectDoctorReport({ adapters: ALL_ADAPTERS });
        if (opts.json === true) {
          process.stdout.write(JSON.stringify(report, null, 2) + "\n");
          return;
        }
        process.stdout.write(formatDoctorHuman(report));
      } catch (err) {
        console.error(fail(`Doctor failed: ${(err as Error).message}`));
        exitWith(ExitCode.ERROR);
      }
    });
}
