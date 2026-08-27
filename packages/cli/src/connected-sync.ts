import {
  sync,
  readState,
  authConnectPair,
  loadRegistryBearer,
  extractPairCode,
} from "@skillet/core";
import * as clack from "@clack/prompts";
import { homedir } from "node:os";
import { join } from "node:path";
import { stat } from "node:fs/promises";
import { runtimeLabel } from "@skillet/core";
import { ADDITIONAL_ADAPTERS, BASELINE_GLOBAL_ADAPTERS, countUserSkills } from "./cli-context.js";
import { resolveSyncAdapters } from "./adapter-tiers.js";
import { REGISTRY_DEFAULT } from "./cli-context.js";
import { installRouteHooksWithConsent } from "./route-hooks-consent.js";
import { webBaseUrl } from "./cli-command-tier.js";
import { resolveBundledCreateSkillDir, resolveBundledRouteSkillDir } from "./bundled-route-path.js";
import { inlinedCreateSkillMd, inlinedRouteSkillMd } from "./bundled-route-content.js";
import { ok, fail, dim, bold, cyan } from "./cli-colors.js";
import { printPendingReviewSummary } from "./pending-review-summary.js";
import { printRenderedError } from "./render-error.js";

function settingsPageUrl(): string {
  return `${webBaseUrl()}/settings`;
}

/**
 * Name the agents actually on this machine so connect pitches are concrete:
 * "…use your skills in Claude Code" beats "…in every agent". Local fs checks
 * only; any failure just falls back to the generic phrasing.
 */
export async function detectedAgentsPhrase(): Promise<string> {
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const adapter of [...ADDITIONAL_ADAPTERS, ...BASELINE_GLOBAL_ADAPTERS]) {
    if (seen.has(adapter.name)) continue;
    seen.add(adapter.name);
    // The codex adapter also claims the universal ~/.agents dir it owns, which
    // Skillet creates on every synced machine — so its detect() can't prove
    // Codex is installed. Name Codex only on direct evidence, and never say
    // "Universal" to a person.
    if (adapter.name === "codex") {
      try {
        await stat(join(homedir(), ".codex"));
        labels.push("Codex");
      } catch {
        // No ~/.codex — leave Codex unnamed.
      }
      continue;
    }
    const label = runtimeLabel(adapter.name);
    if (label.startsWith("Universal")) continue;
    try {
      if (await adapter.detect()) labels.push(label);
    } catch {
      // One adapter's failure shouldn't cost the others their mention.
    }
  }
  if (labels.length === 0) return "on this machine";
  if (labels.length === 1) return `in ${labels[0]}`;
  if (labels.length === 2) return `in ${labels[0]} and ${labels[1]}`;
  if (labels.length === 3) return `in ${labels[0]}, ${labels[1]}, and ${labels[2]}`;
  return `in ${labels[0]}, ${labels[1]}, and ${labels.length - 2} more`;
}

/** Pair-code prompt: grayed placeholder carries the cancel affordance, Esc exits. */
async function promptPairCode(): Promise<string> {
  const entry = await clack.text({
    message: "Pair code",
    placeholder: "Paste your code · Esc to cancel",
    // Format mistakes never submit — the prompt stays open with the reason.
    // Accepts dashed codes and full pasted connect commands (extractPairCode).
    validate: (value) => {
      if (!value || !value.trim()) return undefined; // empty submit = skip
      return extractPairCode(value) ? undefined : "That doesn't look like a pair code";
    },
  });
  if (clack.isCancel(entry)) return "";
  const raw = String(entry ?? "").trim();
  return raw ? (extractPairCode(raw) ?? raw) : "";
}

/**
 * Prompt-and-pair loop: a rejected code re-prompts instead of exiting — the
 * user is already at the prompt, so the prompt is the retry. Esc or an empty
 * submit leaves. Returns the pair result, or null if the user backed out.
 */
export async function pairInteractively(
  opts: { registryUrl?: string; label?: string; clientKind?: "cli" | "desktop" } = {},
): Promise<Awaited<ReturnType<typeof authConnectPair>> | null> {
  for (;;) {
    const code = await promptPairCode();
    if (!code) return null;
    try {
      return await authConnectPair({ code, registryUrl: REGISTRY_DEFAULT, ...opts });
    } catch (err) {
      const reason = (err as Error).message.replace(/^Could not connect with pair code:\s*/i, "");
      console.error(`\n${fail(reason)}`);
      console.log(dim("  Codes are single-use. Get a fresh one at ") + cyan(settingsPageUrl()) + "\n");
    }
  }
}

/**
 * Sync this machine and report the outcome. Shared by the bare-command wizard
 * and `skillet connect` (human path) so pairing always ends in a synced
 * machine, matching the desktop's pair-then-sync behavior.
 */
export async function runConnectedSync(
  allowReconnectPrompt = true,
  // homeMenuFollows: the bare-run menu renders pending review and teaching
  // itself, with the data on the option — printing them here too would say
  // everything twice on one screen.
  opts: { homeMenuFollows?: boolean } = {},
): Promise<void> {
  // Progress only if there's a wait worth explaining: a fast result (or a
  // fast 401 on a disconnected machine) should print nothing but the outcome.
  // A managed spinner, not a bare log line — it stops BEFORE any other output
  // so it can never interleave with results, hooks, or the consent ask.
  const spin = clack.spinner();
  let spinning = false;
  const progress = setTimeout(() => {
    if (process.stdout.isTTY === true) {
      spin.start("Syncing");
      spinning = true;
    } else {
      console.log("\nSyncing…");
    }
  }, 750);
  const stopProgress = (note?: string) => {
    clearTimeout(progress);
    if (spinning) {
      spin.stop(note ?? "Synced.");
      spinning = false;
    }
  };

  try {
    const bearer = await loadRegistryBearer();
    const { adapters: syncAdapters, baselineNames } = await resolveSyncAdapters(process.cwd());
    // Core can write mid-run (skip lines, the TTY quarantine consent prompt).
    // Any such output must kill the spinner FIRST or the animation draws over
    // it — so sync writes through a proxy that stops progress on first use.
    const syncOutput = new Proxy(process.stdout, {
      get(target, prop, receiver) {
        if (prop === "write") {
          return (...args: Parameters<typeof process.stdout.write>) => {
            stopProgress("Syncing paused.");
            return target.write(...args);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as NodeJS.WriteStream;
    const result = await sync(process.cwd(), syncAdapters, {
      output: syncOutput,
      token: bearer.token || undefined,
      baselineAdapterNames: baselineNames,
      // Core's default is hardcoded prod; without this, the auto-sync after
      // pairing ignores SKILLET_REGISTRY_URL and 401s dev/local tokens
      // against production, printing a bogus "disconnected" right after a
      // successful pair.
      registryUrl: REGISTRY_DEFAULT,
      bundledRouteSkillDir: resolveBundledRouteSkillDir(),
      bundledRouteSkillMd: inlinedRouteSkillMd(),
      bundledCreateSkillDir: resolveBundledCreateSkillDir(),
      bundledCreateSkillMd: inlinedCreateSkillMd(),
    });
    const stateAfter = await readState();
    const totalSkills = countUserSkills(stateAfter);
    const detected = result.adapters.filter((a) => a.status !== "skipped-not-detected").length;

    // One synced line, ever: when the spinner was shown it resolves INTO the
    // summary; otherwise the summary prints plainly. Never both.
    const finish = (line: string) => {
      if (spinning) {
        stopProgress(line);
      } else {
        stopProgress();
        console.log(`\n${ok(line)}`);
      }
    };

    if (totalSkills === 0) {
      finish("Sync complete. Your kit is ready.");
      console.log(dim("  Add skills on ") + cyan(webBaseUrl()));
      await installRouteHooksWithConsent(result, { teachHint: !opts.homeMenuFollows });
      return;
    }

    // One count, plain words: "18 skills in 4 agents". The kit-vs-individual
    // breakdown lives in `skillet list`; here it only invited a "kit vs kits"
    // double meaning, and "materialized into runtimes" is internal vocabulary.
    // Honesty rule, per kind: a held NEW skill is genuinely absent from the
    // machine, but a held UPDATE means the previous approved version is
    // still synced — it must not subtract from the synced count.
    const newCount = result.pendingReview.filter((p) => p.range === "new").length;
    const updCount = result.pendingReview.length - newCount;
    const applied = Math.max(0, totalSkills - newCount);
    const waitingPhrase =
      newCount > 0 && updCount > 0
        ? `${newCount} new skill${newCount === 1 ? "" : "s"} and ${updCount} update${updCount === 1 ? "" : "s"} need your OK`
        : newCount > 0
          ? `${newCount} new skill${newCount === 1 ? "" : "s"} need${newCount === 1 ? "s" : ""} your OK`
          : `${updCount} update${updCount === 1 ? "" : "s"} need${updCount === 1 ? "s" : ""} your OK`;
    finish(
      newCount === 0 && updCount === 0
        ? `You're synced: ${totalSkills} skill${totalSkills === 1 ? "" : "s"}.`
        : newCount === 0
          ? `You're synced: ${totalSkills} skill${totalSkills === 1 ? "" : "s"}; ${waitingPhrase}.`
          : `Synced ${applied} of ${totalSkills} skills; ${waitingPhrase}.`,
    );
    if (detected === 0) {
      console.log(
        "  Universal ~/.agents/skills should have received skills. Run `skillet sync` again if it did not arrive.",
      );
    }
    // The receipt: what arrived THIS run (the CLI's activity view). Silent
    // consent for your own work must never mean invisible arrival — these
    // lines are information, not questions. Held items are excluded; their
    // menu rows / summary carry them.
    const held = new Set(result.pendingReview.map((p) => p.slug));
    const arrived = [
      ...result.unionPull
        .filter((o) => o.status === "updated" && !held.has(o.slug))
        .map((o) => ({ slug: o.slug, kind: "new" as const })),
      ...result.pull
        .filter((o) => o.status === "updated" && !held.has(o.slug))
        .map((o) => ({ slug: o.slug, kind: "update" as const })),
    ];
    const RECEIPT_MAX = 6;
    for (const item of arrived.slice(0, RECEIPT_MAX)) {
      const entry = stateAfter.skills[item.slug];
      const version = entry ? `v${entry.versionLabel ?? entry.version}` : "";
      console.log(
        dim(
          item.kind === "new"
            ? `  + ${item.slug} ${version} (new)`
            : `  ↑ ${item.slug} ${version} (updated)`,
        ),
      );
    }
    if (arrived.length > RECEIPT_MAX) {
      console.log(dim(`  …and ${arrived.length - RECEIPT_MAX} more`));
    }
    if (!opts.homeMenuFollows) printPendingReviewSummary(result.pendingReview);
    // Hooks + the one-time stats-consent question come LAST: the sync outcome
    // reads first, and the run ends on the question rather than burying it.
    // (Pairing's auto-sync shares this moment — the old "run skillet sync"
    // homework was where onboarding got hooks and consent.)
    await installRouteHooksWithConsent(result, { teachHint: !opts.homeMenuFollows });
  } catch (err) {
    stopProgress("Sync stopped.");
    // A dead session means this machine needs to re-pair; retrying sync
    // cannot succeed. Detect by code, with a prose fallback for errors that
    // lost their type across the CLI boundary.
    const disconnected =
      (err as { code?: string }).code === "machine_disconnected" ||
      /disconnected from your account/i.test((err as Error).message);
    if (disconnected) {
      console.error(`\n${fail("This machine was disconnected from your account.")}`);
      // Interactive terminals reconnect right here: the fix is pasting a code,
      // not remembering a command. One retry loop only, then hand off.
      if (allowReconnectPrompt && process.stdout.isTTY === true) {
        console.log(dim("  Get a pair code at ") + cyan(settingsPageUrl()));
        const result = await pairInteractively();
        if (result) {
          const who = result.handle ? `@${result.handle}` : "your account";
          console.log(`\n${ok(`Connected to ${who}`)}`);
          return runConnectedSync(false);
        }
        console.log(dim("\n  Reconnect anytime: ") + bold("skillet connect <code>"));
        return;
      }
      console.log(dim("  Get a pair code at ") + cyan(settingsPageUrl()));
      console.log(`\n    ${bold("skillet connect <code>")}`);
      return;
    }
    printRenderedError(
      err as Error,
      (what) => `\n${fail(`Sync didn't finish: ${what}`)}`,
      (line) => console.log(line.startsWith("\n") ? line : dim(line)),
    );
    // A sync that didn't finish is a failure — scripts and CI must see it.
    process.exitCode = 1;
  }
}
