import type { Command } from "commander";
import {
  setActivity,
  activityState,
  chooseRouteConsent,
  loadRegistryBearer,
  readRouteHistory,
  exportRecord,
  clearRouteHistory,
  REGISTRY_API,
} from "@skillet/core";
import { REGISTRY_DEFAULT } from "../cli-context.js";
import { ExitCode, exitWith } from "../exit-codes.js";
import { fail } from "../cli-colors.js";
import { STATS_SYNC_ON_MSG, STATS_LOCAL_MSG } from "../skill-stats-copy.js";

/** Push the private-mode flag to the registry. Best-effort — local config is the
 * source of truth for the client; the server flag just stops a stale client. */
async function syncServerFlag(privateMode: boolean): Promise<"ok" | "no-token" | "failed"> {
  const bearer = await loadRegistryBearer();
  if (!bearer.token) return "no-token";
  try {
    const base = (process.env["SKILLET_REGISTRY_URL"] ?? REGISTRY_DEFAULT).replace(/\/+$/, "");
    const res = await fetch(`${base}${REGISTRY_API}/me/activity`, {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: `Bearer ${bearer.token}` },
      body: JSON.stringify({ private: privateMode }),
    });
    return res.ok ? "ok" : "failed";
  } catch {
    return "failed";
  }
}

function serverNote(result: "ok" | "no-token" | "failed"): string {
  if (result === "failed") return " (set locally; couldn't reach the server to sync it)";
  return "";
}

/** Delete the caller's recorded activity (events + availability) on the server. */
async function clearServer(): Promise<{ events: number; availability: number } | "no-token" | "failed"> {
  const bearer = await loadRegistryBearer();
  if (!bearer.token) return "no-token";
  try {
    const base = (process.env["SKILLET_REGISTRY_URL"] ?? REGISTRY_DEFAULT).replace(/\/+$/, "");
    const headers = { authorization: `Bearer ${bearer.token}` };
    const [ev, re] = await Promise.all([
      fetch(`${base}${REGISTRY_API}/me/events`, { method: "DELETE", headers }),
      fetch(`${base}${REGISTRY_API}/me/availability`, { method: "DELETE", headers }),
    ]);
    if (!ev.ok || !re.ok) return "failed";
    const events = ((await ev.json()) as { deleted?: number }).deleted ?? 0;
    const availability = ((await re.json()) as { deleted?: number }).deleted ?? 0;
    return { events, availability };
  } catch {
    return "failed";
  }
}

/** The `activity status` view. Shared by the `status` subcommand and by bare
 *  `skillet activity`, which defaults to it — the noun alone shows the state,
 *  subcommands change it. */
async function runActivityStatus(opts: { json?: boolean }): Promise<void> {
  const s = await activityState();
  if (opts.json === true) {
    process.stdout.write(JSON.stringify({ ok: true, ...s }, null, 2) + "\n");
    return;
  }
  console.log(`Activity recording: ${s.recording ? "ON" : "OFF"} (${s.source})`);
  if (s.source === "env") {
    console.log("  Set by the SKILLET_ACTIVITY env var (overrides config).");
  }
  if (s.recording) {
    console.log(
      "  Records sync stats (which skills, which agents) to power your devices,\n" +
        "  profile, and the public availability graph. `skillet activity off` to opt out.",
    );
  } else {
    console.log("  Not recording. `skillet activity on` to re-enable.");
  }
  if (!s.routeConsentChosen) {
    // The consent question only appears once there's real usage to sync:
    // `skillet sync` asks "you've used /skillet N times — sync those stats?",
    // so with zero routes it teaches the verb instead of asking. Say which
    // one you're in so `status` doesn't promise a question that won't come.
    const history = await readRouteHistory();
    const uses = Object.values(history.skills).reduce((n, r) => n + r.count, 0);
    console.log(
      uses === 0
        ? "  /skillet route recording: choice not made yet. Route events stay local.\n" +
            "  Use `/skillet <task>` at least once, then an interactive `skillet sync`\n" +
            "  will ask whether to sync those stats to your account."
        : "  /skillet route recording: choice not made yet. Route events stay local\n" +
            "  until you choose on your next interactive `skillet sync`.",
    );
  }
}

export function registerActivityCommand(program: Command): void {
  const activity = program
    .command("activity")
    .description("What Skillet records: view, export, delete, or change it");

  // Bare `skillet activity` shows the status — same shape as `edits`/`pending`.
  activity.action(async () => {
    await runActivityStatus({});
  });

  activity
    .command("status")
    .description("Show whether activity is recorded and what decides it")
    .option("--json", "Emit machine-readable state")
    .action(async (opts: { json?: boolean }) => {
      await runActivityStatus(opts);
    });

  activity
    .command("on")
    .description("Turn activity recording on")
    .action(async () => {
      await setActivity(true);
      const server = await syncServerFlag(false);
      console.log(`Activity recording on.${serverNote(server)}`);
    });

  activity
    .command("off")
    .description("Turn activity recording off (opt out)")
    .action(async () => {
      await setActivity(false);
      const server = await syncServerFlag(true);
      console.log(`Activity recording off.${serverNote(server)}`);
      console.log("Past activity is retained. `skillet activity clear` to delete it.");
    });

  activity
    .command("choose <where>")
    .description("Answer the skill-stats question: `sync` stats to your account, or keep them `local`")
    .option("--json", "Emit machine-readable result")
    .action(async (where: string, opts: { json?: boolean }) => {
      // The one verb that marks the consent question ANSWERED (routeConsentChosen),
      // unlike `on`/`off` which only flip the flag. The desktop tray's one-time
      // ask card calls this with --json; the CLI first-run ask uses the same
      // chooseRouteConsent underneath.
      if (where !== "sync" && where !== "local") {
        const msg = "choose takes `sync` or `local`";
        if (opts.json === true) {
          process.stdout.write(JSON.stringify({ ok: false, error: msg }) + "\n");
        } else {
          console.error(fail(msg));
        }
        exitWith(ExitCode.USAGE);
        return;
      }
      const record = where === "sync";
      await chooseRouteConsent(record);
      // Server flag parity with `on`/`off` (best-effort; local config is truth).
      const server = await syncServerFlag(!record);
      if (opts.json === true) {
        const s = await activityState();
        process.stdout.write(
          JSON.stringify(
            { ok: true, recording: s.recording, routeConsentChosen: s.routeConsentChosen },
            null,
            2,
          ) + "\n",
        );
        return;
      }
      console.log(`${record ? STATS_SYNC_ON_MSG : STATS_LOCAL_MSG}${serverNote(server)}`);
    });

  activity
    .command("clear")
    .description("Delete your recorded activity: local history and server events")
    .action(async () => {
      // Local first: this always succeeds and covers anonymous users, who have
      // no server records to clear.
      await clearRouteHistory();
      console.log("Cleared local /skillet route history.");

      const res = await clearServer();
      if (res === "no-token") {
        console.log("Not signed in. Nothing on the server to clear.");
        return;
      }
      if (res === "failed") {
        console.log("Couldn't reach the server to clear your server-side activity. Try again.");
        return;
      }
      console.log(`Cleared ${res.events} server event(s) and ${res.availability} availability row(s).`);
    });

  activity
    .command("export")
    .description("Export everything recorded about you (local route history + server activity)")
    .action(async () => {
      // The full local store (skill refs, counts, timestamps, runtimes — all
      // content-free) plus your server-side activity, so you can inspect exactly
      // what Skillet holds about you.
      const local = exportRecord(await readRouteHistory());
      const server = await fetchServerActivity();
      process.stdout.write(JSON.stringify({ ok: true, local, server }, null, 2) + "\n");
    });
}

/** Best-effort read of the caller's server-recorded activity for export. */
async function fetchServerActivity(): Promise<
  { events: unknown; availability: unknown } | "no-token" | "failed"
> {
  const bearer = await loadRegistryBearer();
  if (!bearer.token) return "no-token";
  try {
    const base = (process.env["SKILLET_REGISTRY_URL"] ?? REGISTRY_DEFAULT).replace(/\/+$/, "");
    const headers = { authorization: `Bearer ${bearer.token}` };
    const [ev, re] = await Promise.all([
      fetch(`${base}${REGISTRY_API}/me/events`, { headers }),
      fetch(`${base}${REGISTRY_API}/me/availability`, { headers }),
    ]);
    if (!ev.ok || !re.ok) return "failed";
    return { events: await ev.json(), availability: await re.json() };
  } catch {
    return "failed";
  }
}
