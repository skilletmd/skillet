import * as clack from "@clack/prompts";
import { Command } from "commander";
import {
  readState,
  readRouteHistory,
  listPending,
  approveUpdate,
  rejectUpdate,
  requiresQuarantineConsent,
  groupSkillsByKit,
  type PendingEntry,
} from "@skillet/core";
import { ALL_ADAPTERS, CLI_VERSION, countUserSkills } from "./cli-context.js";
import { registerAllCommands } from "./commands/register-all.js";
import { formatSkilletHelp } from "./help-format.js";
import { applyToAgents } from "./apply-to-agents.js";
import { renderKitList } from "./kit-list-format.js";
import { formatPendingRange } from "./commands/pending.js";
import { stripControlChars } from "./sanitize-output.js";
import { webBaseUrl } from "./cli-command-tier.js";
import { ok, fail, bold, dim, cyan } from "./cli-colors.js";
import { printRenderedError } from "./render-error.js";

/**
 * The bare-run home: after sync reports, one navigable menu instead of a wall
 * of hints. Options are earned, not fixed — review only appears when something
 * waits, and the /skillet teach block leads until the first real use. Esc or
 * "Done" leaves quietly; every other action returns here.
 */
export async function runHomeMenu(): Promise<void> {
  if (process.stdout.isTTY !== true) return;

  for (;;) {
    const state = await readState();
    const total = countUserSkills(state);
    const history = await readRouteHistory();
    const used = Object.values(history.skills).some((s) => s.count > 0);
    let pending: PendingEntry[] = [];
    try {
      pending = (await listPending(ALL_ADAPTERS)).pending;
    } catch {
      // Pending listing is a menu nicety, never a blocker.
    }

    const options: { value: string; label: string; hint?: string }[] = [];
    // Updates and new arrivals are different decisions — "accept this change
    // to something I run" vs "let this onto my machine at all" — so they get
    // separate rows. Version moves stay inside the review flow, where each
    // skill's header carries its range.
    const updates = pending.filter((p) => p.approvedVersion !== null);
    const arrivals = pending.filter((p) => p.approvedVersion === null);
    const hintFor = (list: PendingEntry[]) => {
      const shown = list.slice(0, 3).map((p) => p.slug).join(", ");
      return list.length > 3 ? `${shown} +${list.length - 3} more` : shown;
    };
    // Menu rows are ACTIONS, not status lines: with a handful of items each
    // gets a verb-led row naming the actual skill (the Apple move — name the
    // thing when you can). Past that, collapse to one count row per kind.
    const REVIEW_INLINE_MAX = 4;
    // New skills outrank updates: letting something onto the machine is the
    // bigger decision, so it always sits first.
    if (pending.length > 0 && pending.length <= REVIEW_INLINE_MAX) {
      for (const p of arrivals) {
        options.push({
          value: `review-one:${p.slug}`,
          // Outcome, not mechanism: choosing this ADDS the skill (after a
          // look at what it is). "Review" stays for updates, where reviewing
          // the change IS the action.
          label: `Add new skill: ${p.slug}`,
          hint: `v${p.incomingVersionLabel ?? p.incomingVersion}`,
        });
      }
      for (const p of updates) {
        options.push({
          value: `review-one:${p.slug}`,
          label: `Review update: ${p.slug}`,
          hint: formatPendingRange(p),
        });
      }
    } else {
      if (arrivals.length > 0) {
        options.push({
          value: "review-new",
          label: `Add ${arrivals.length} new skills`,
          hint: hintFor(arrivals),
        });
      }
      if (updates.length > 0) {
        options.push({
          value: "review-updates",
          label: `Review ${updates.length} skill updates`,
          hint: hintFor(updates),
        });
      }
    }
    if (!used) {
      // Honest label: the CLI can't run /skillet itself (it lives inside the
      // agents), so this shows how — it never claims to execute anything.
      options.push({ value: "learn", label: "How to run your first skill", hint: "/skillet" });
    }
    options.push({ value: "skills", label: `Your skills (${total})` });
    if (used) {
      options.push({ value: "learn", label: "How /skillet works" });
    }
    options.push({ value: "help", label: "Help", hint: "all commands" });
    options.push({ value: "exit", label: "Done" });

    console.log("");
    const choice = await clack.select({
      message: "What next?",
      options,
      initialValue: options[0]!.value,
    });
    if (clack.isCancel(choice) || choice === "exit") return;
    if (typeof choice === "string" && choice.startsWith("review-one:")) {
      const slug = choice.slice("review-one:".length);
      const entry = pending.find((p) => p.slug === slug);
      if (entry) await reviewPending([entry]);
    }
    if (choice === "review-updates") await reviewPending(updates);
    if (choice === "review-new") await reviewPending(arrivals);
    if (choice === "skills") showSkills(state, arrivals);
    if (choice === "learn") showLearn();
    if (choice === "help") showHelp();
  }
}

/** Render the same root `skillet --help` surface from inside the home menu. */
function showHelp(): void {
  const program = new Command("skillet").version(CLI_VERSION);
  program.configureHelp({ formatHelp: formatSkilletHelp, sortSubcommands: false });
  registerAllCommands(program);
  console.log("");
  console.log(program.helpInformation());
}

function showSkills(
  state: Awaited<ReturnType<typeof readState>>,
  awaitingArrivals: PendingEntry[] = [],
): void {
  // Same grouped view as `skillet list`: kits are how skills arrive, so the
  // kit is the section header, not a suffix repeated on every row. Local
  // grouping only — a menu action shouldn't wait on the network.
  const groups = groupSkillsByKit(state);
  console.log("");
  console.log(
    renderKitList(groups, { awaitingConsent: new Set(awaitingArrivals.map((p) => p.slug)) }),
  );
  console.log(dim("\n  Add more at ") + cyan(`${webBaseUrl()}/browse`));
}

function showLearn(): void {
  console.log("");
  console.log(`  In any agent (Claude Code, Cursor, Codex), type ${bold("/skillet")} and the task:`);
  console.log("");
  console.log(cyan("  /skillet review this PR like grace would"));
  console.log("");
  console.log("  Skillet picks the right skill from your kit and your agent runs it.");
  console.log(dim("  Uses stay on this machine. See them with ") + cyan("skillet usage"));
}

/**
 * Per-skill review loop: the diff (already deduped to one copy with an
 * applies-to header), then approve / later / reject. Approvals materialize
 * immediately with a scoped sync — no "now run skillet sync" homework.
 *
 * Quarantined entries are the safety-critical path: the harm-scan findings
 * render BEFORE the decision, the select never defaults to Approve, and
 * approving asks one more default-No confirm that becomes the quarantine
 * consent. That consent is granted per slug (allowQuarantinedSlugs), never
 * batch-wide — a grant is exactly as wide as what this user saw and accepted.
 */
async function reviewPending(pending: PendingEntry[]): Promise<void> {
  const approved: string[] = [];
  const quarantineConsented: string[] = [];
  for (const entry of pending) {
    console.log("");
    console.log(`${bold(entry.slug)} ${dim(`(${formatPendingRange(entry)})`)}`);
    if (entry.quarantined && entry.scanSummary) {
      console.log(stripControlChars(entry.scanSummary));
      console.log("");
    }
    if (entry.diff) console.log(stripControlChars(entry.diff));
    const isNew = entry.approvedVersion === null;
    const action = await clack.select({
      message: entry.quarantined
        ? `${entry.slug} is quarantined. ${isNew ? "Add" : "Apply"} anyway?`
        : isNew
          ? `Add ${entry.slug}?`
          : `Apply this update to ${entry.slug}?`,
      options: [
        {
          value: "approve",
          label: entry.quarantined
            ? `${isNew ? "Add" : "Approve"} quarantined skill`
            : isNew
              ? "Add it"
              : "Approve",
          hint: isNew ? "installs now" : "applies now",
        },
        { value: "later", label: "Decide later" },
        { value: "reject", label: "Reject this version", hint: "a newer version asks again" },
      ],
      // Never preselect Approve on a quarantined entry: Enter-Enter must not
      // be able to materialize harm-scan-flagged content.
      initialValue: entry.quarantined ? "later" : "approve",
    });
    if (clack.isCancel(action)) break;
    if (action === "approve") {
      // Re-read the entry: the menu's pending snapshot can be stale (a
      // background tray sync may have flipped the scan verdict since). The
      // consent decision must be made against what will actually be written.
      const stateNow = await readState();
      const entryNow = stateNow.skills[entry.slug];
      const quarantinedNow = entry.quarantined || requiresQuarantineConsent(entryNow?.scan);
      if (quarantinedNow && !entry.quarantined) {
        console.log(dim(`  ${entry.slug} was quarantined by a newer scan. Review it again next pass.`));
        continue;
      }
      if (entry.quarantined) {
        const consent = await clack.confirm({
          message: `Apply the quarantined ${entry.slug} despite the findings above?`,
          initialValue: false,
        });
        // Esc or No: fail closed — no approval, nothing written.
        if (clack.isCancel(consent) || consent !== true) {
          console.log(dim("  Left for later. Nothing applied."));
          continue;
        }
        quarantineConsented.push(entry.slug);
      }
      await approveUpdate(entry.slug, entry.incomingVersion, {});
      approved.push(entry.slug);
    } else if (action === "reject") {
      await rejectUpdate(entry.slug);
      console.log(dim(`  Rejected v${entry.incomingVersionLabel ?? entry.incomingVersion}.`));
    }
  }
  if (approved.length === 0) return;

  try {
    const result = await applyToAgents(approved, { allowQuarantinedSlugs: quarantineConsented });
    // Say what actually happened, not what was approved: a quarantine skip
    // (scan flipped mid-review) must not be counted as applied.
    const skipped = result.failed.filter((f) => f.reason.startsWith("quarantined"));
    const appliedCount = approved.length - skipped.length;
    if (appliedCount > 0) {
      console.log(ok(`Applied ${appliedCount} update${appliedCount === 1 ? "" : "s"}.`));
    }
    for (const f of skipped) {
      console.log(dim(`  ${f.slug} was quarantined by a newer scan and was not applied.`));
    }
  } catch (err) {
    printRenderedError(err as Error, (what) => fail(`Applying failed: ${what}`));
    console.log(dim("  The approvals were recorded; run `skillet sync` to finish applying."));
  }
}
