import type { Command } from "commander";
import {
  listPending,
  approveUpdate,
  rejectUpdate,
  readState,
  requiresQuarantineConsent,
  renderFindingsSummary,
  setTccInvocation,
} from "@skillet/core";
import type { PendingEntry } from "@skillet/core";
import { ALL_ADAPTERS } from "../cli-context.js";
import { applyToAgents } from "../apply-to-agents.js";
import { ExitCode, exitWith } from "../exit-codes.js";
import { ok, fail, dim } from "../cli-colors.js";
import { printRenderedError } from "../render-error.js";
import { stripControlChars } from "../sanitize-output.js";

/**
 * `v1.0.0 → v1.1.0`-style range. Both sides read as semver when both labels
 * are present; if either is missing (a pre-semver version), both fall back to
 * the integer ordinal so the range never mixes `v1 → v1.1.0`.
 */
export function formatPendingRange(
  entry: Pick<
    PendingEntry,
    "approvedVersion" | "approvedVersionLabel" | "incomingVersion" | "incomingVersionLabel"
  >,
): string {
  // Only trust semver labels when BOTH sides have one; otherwise stay ordinal
  // on both sides to keep the two ends of the arrow the same shape.
  const bothLabelled =
    entry.incomingVersionLabel != null &&
    (entry.approvedVersion === null || entry.approvedVersionLabel != null);
  const incoming = `v${bothLabelled ? entry.incomingVersionLabel : entry.incomingVersion}`;
  if (entry.approvedVersion === null) return `new (${incoming})`;
  const approved = `v${bothLabelled ? entry.approvedVersionLabel : entry.approvedVersion}`;
  return `${approved} → ${incoming}`;
}

export function registerPendingCommands(program: Command): void {
  program
    .command("pending")
    .description(
      "Skills waiting for your review, with their diffs",
    )
    .option("--json", "Emit a machine-readable pending list")
    .option(
      "--background",
      "Mark this run as an automatic background check. Agent folders that still need macOS folder access stay parked",
    )
    .action(async (opts: { json?: boolean; background?: boolean }) => {
      // TCC initiation (U3): the tray's pending poll is never a TTY, so
      // without an explicit signal it classifies fail-closed as unattended
      // and even a GRANTED protected root stays parked. --background lets a
      // caller that knows its own provenance read under its earned marker.
      // Deliberately no --user-initiated here: a read-only listing never
      // earns or records a grant, so the flag would only mislead. Without
      // the flag, non-TTY runs remain unattended (fail closed).
      if (opts.background === true) setTccInvocation({ initiation: "background" });
      try {
        const result = await listPending(ALL_ADAPTERS);
        if (opts.json === true) {
          process.stdout.write(JSON.stringify(result, null, 2) + "\n");
          return;
        }
        if (result.pending.length === 0) {
          console.log("No pending updates. All skills are approved or auto-applied.");
          return;
        }
        console.log(`${result.pending.length} skill(s) pending review:\n`);
        for (const entry of result.pending) {
          const from = formatPendingRange(entry);
          const author = entry.authorKeyId
            ? `  author: ${entry.authorKeyId.slice(0, 16)}…`
            : "";
          console.log(`  • ${entry.slug} (${from})${author}`);
          if (entry.quarantined && entry.scanSummary) {
            console.log(stripControlChars(entry.scanSummary));
          }
          if (entry.diff) {
            console.log(stripControlChars(entry.diff));
          } else {
            console.log("  (no diff available; no agents detected)");
          }
          console.log(
            `  Approve: skillet approve ${entry.slug} --version ${entry.incomingVersion}`,
          );
          console.log(`  Reject:  skillet reject ${entry.slug}\n`);
        }
      } catch (err) {
        console.error(`✗ pending failed: ${(err as Error).message}`);
        exitWith(ExitCode.ERROR);
      }
    });

  program
    .command("approve <slug>")
    .description("Approve a skill's waiting update and apply it")
    .option(
      "--version <number>",
      "Exact version to approve (defaults to the current waiting version)",
    )
    .action(async (slug: string, opts: { version?: string }) => {
      let version: number;
      if (opts.version !== undefined) {
        // Strict integer: parseInt("1.5") truncates to 1, which would silently
        // approve the wrong version instead of rejecting the typo. Require all
        // digits.
        const raw = opts.version.trim();
        version = /^\d+$/.test(raw) ? parseInt(raw, 10) : NaN;
        if (isNaN(version) || version < 1) {
          console.error(fail(`--version must be a positive integer, got "${opts.version}"`));
          exitWith(ExitCode.USAGE);
          return;
        }
      } else {
        // No flag: approve what's actually waiting — the CLI already knows.
        const state = await readState();
        const entry = state.skills[slug];
        if (!entry) {
          console.error(fail(`"${slug}" isn't in your kit.`));
          exitWith(ExitCode.ERROR);
          return;
        }
        version = entry.version;
      }
      // Quarantine check comes BEFORE the approval is recorded: a recorded
      // approval satisfies the pending gate, which would make the entry
      // vanish from `skillet pending` and the home menu — stranding a
      // quarantined skill as approved-but-unapplied with no review surface
      // left to consent on. Refuse first, record nothing.
      const stateNow = await readState();
      const entryNow = stateNow.skills[slug];
      if (entryNow && requiresQuarantineConsent(entryNow.scan)) {
        if (entryNow.scan) console.log(stripControlChars(renderFindingsSummary(entryNow.scan)));
        console.error(
          fail(
            `"${slug}" is quarantined and was not approved or applied. Review it with \`skillet\` (home menu) or \`skillet pending\`.`,
          ),
        );
        exitWith(ExitCode.ERROR);
        return;
      }
      try {
        await approveUpdate(slug, version, {});
      } catch (err) {
        console.error(fail(`approve failed: ${(err as Error).message}`));
        exitWith(ExitCode.ERROR);
        return;
      }
      try {
        await applyToAgents([slug]);
      } catch (err) {
        // The approval IS recorded — say so, or the user can't explain why
        // the entry vanished from pending while nothing changed on disk.
        console.log(ok(`Approved "${slug}" v${version}.`));
        printRenderedError(err as Error, (what) => fail(`Applying failed: ${what}`));
        console.error(dim("  The approval is recorded; run `skillet sync` to finish applying."));
        exitWith(ExitCode.ERROR);
        return;
      }
      console.log(ok(`Approved and applied "${slug}" v${version}.`));
    });

  program
    .command("reject <slug>")
    .description(
      "Reject a skill's waiting update; a newer version asks again",
    )
    .action(async (slug: string) => {
      try {
        await rejectUpdate(slug);
        console.log(
          `✓ Rejected pending update for "${slug}". A new version will prompt again when it arrives.`,
        );
      } catch (err) {
        console.error(`✗ reject failed: ${(err as Error).message}`);
        exitWith(ExitCode.ERROR);
      }
    });
}
