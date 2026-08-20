import {
  installRouteHooksForRuntimes,
  hookRuntimesFromDetected,
  routeConsentChosen,
  chooseRouteConsent,
  readRouteHistory,
  type SyncResult,
} from "@skillet/core";
import * as clack from "@clack/prompts";
import { STATS_SYNC_ON_MSG, STATS_LOCAL_MSG } from "./skill-stats-copy.js";
import { webBaseUrl } from "./cli-command-tier.js";
import { dim, cyan, yellow } from "./cli-colors.js";

/**
 * Post-sync /skillet hook install + first-run route-consent choice, shared by
 * `skillet sync` and the auto-sync after pairing (wizard / `skillet connect`).
 * Before connect auto-synced, the "run skillet sync" homework was accidentally
 * where onboarders got hooks and the consent question — this keeps that moment
 * on every path that syncs interactively.
 *
 * Consent gate: only interactive (TTY, not --json), only after a hook actually
 * installed, only if never chosen. In --json/CI we defer — leaving the choice
 * unmade keeps route events local until the next interactive surface, never
 * silently opting in.
 *
 * The prose promises here are privacy commitments (what telemetry collects and
 * where it stays) — reword only with product sign-off, and keep `skillet
 * activity` copy in lockstep.
 */
export async function installRouteHooksWithConsent(
  result: Pick<SyncResult, "adapters">,
  opts: { json?: boolean; teachHint?: boolean } = {},
): Promise<void> {
  const asJson = opts.json === true;
  try {
    // Dev runs from source (tsx) put the raw .ts entry in argv[1]; a hook
    // pointing there fails "Permission denied" on every agent prompt once
    // this process is gone. Fall back to the installed binary name — a dev
    // hook must be asked for explicitly via SKILLET_CLI.
    // Bun-compiled sidecar runs (the desktop tray) put the virtual
    // /$bunfs/... entry in argv[1]; that path only exists inside the
    // process, so a hook pointing there fails on every prompt. execPath is
    // the sidecar's real on-disk binary.
    const argvCommand = process.argv[1] ?? "skillet";
    const isBunfsEntry =
      argvCommand.startsWith("/$bunfs/") || argvCommand.includes("~BUN");
    const recorderCommand =
      process.env["SKILLET_CLI"] ??
      (isBunfsEntry
        ? process.execPath
        : /\.(mts|cts|ts|tsx)$/.test(argvCommand)
          ? "skillet"
          : argvCommand);
    const detected = result.adapters
      .filter((a) => a.status !== "skipped-not-detected")
      .map((a) => a.name);
    const hookRuntimes = hookRuntimesFromDetected(detected);
    const hookInstall = await installRouteHooksForRuntimes(hookRuntimes, {
      recorderCommand,
    });
    if (!asJson) {
      for (const warning of hookInstall.warnings) {
        console.log(`${yellow("⚠")}  ${warning}`);
      }
    }
    if (
      !asJson &&
      process.stdout.isTTY === true &&
      hookInstall.installed.length > 0 &&
      !(await routeConsentChosen())
    ) {
      // The ask waits for real stats: someone who has never run /skillet has
      // nothing to sync, so the first-run moment teaches the verb instead.
      // Once local uses exist, the question arrives with its own evidence.
      const history = await readRouteHistory();
      const uses = Object.values(history.skills).reduce((n, s) => n + s.count, 0);
      if (uses === 0) {
        // teachHint false = a surface that teaches on its own follows (the
        // bare-run home menu), so saying it here too would double up.
        if (opts.teachHint !== false) {
          console.log("");
          console.log(
            `Try ${cyan("/skillet <task>")} in any agent. It picks the right skill from your kit.`,
          );
          console.log(dim("Stats stay on this machine. See them with ") + cyan("skillet usage"));
        }
        return;
      }
      // Mirrors the web Settings "Skill stats" panel. Honesty contract: the
      // local tally is unconditional (route.ts writes route-history on every
      // route to power `skillet usage`), so the question is ONLY about what is
      // actually a choice — syncing those stats to the account. Never phrase
      // this as "count y/N"; declining does not stop local counting.
      console.log("");
      clack.log.message(
        [
          `You've used /skillet ${uses === 1 ? "once" : `${uses} times`} on this machine. Skillet keeps those`,
          "stats local: which skill it picks and which agent ran it. Nothing you",
          "type or the agent writes is ever saved.",
          dim("Details: ") + cyan(`${webBaseUrl()}/docs/privacy`),
        ].join("\n"),
      );
      const record = await clack.confirm({
        message: "Sync skill stats to your account?",
        initialValue: false,
      });
      // Esc defers: the choice stays unmade and the next interactive sync
      // asks again — never a silent, permanent opt-out.
      if (clack.isCancel(record)) return;
      await chooseRouteConsent(record);
      console.log(record ? STATS_SYNC_ON_MSG : STATS_LOCAL_MSG);
    }
  } catch (err) {
    if (!asJson) {
      console.log(`${yellow("⚠")}  /skillet usage hooks were not installed: ${(err as Error).message}`);
    }
  }
}
