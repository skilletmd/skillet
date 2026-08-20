import { Command, CommanderError } from "commander";
import {
  readState,
  loadRegistryBearer,
  readActiveDeviceFile,
  discoverExistingSkills,
  flushEvents,
} from "@skillet/core";
import { formatSkilletHelp } from "./help-format.js";
import { ok, fail, bold, dim, cyan } from "./cli-colors.js";
import { runConnectedSync, detectedAgentsPhrase } from "./connected-sync.js";
import { installRouterSkill } from "./commands/init.js";
import { runHomeMenu } from "./home-menu.js";
import { launchBanner } from "./brand.js";
import { printRenderedError } from "./render-error.js";
import { writeJsonError } from "./json-output.js";
import { ALL_ADAPTERS, CLI_VERSION, countUserSkills } from "./cli-context.js";
import { webBaseUrl } from "./cli-command-tier.js";
import { registerAllCommands } from "./commands/register-all.js";
import { runDiscovery } from "./commands/import-cmd.js";
import { shouldRunOnboardingWizard } from "./cli-routing.js";

function settingsPageUrl(): string {
  return `${webBaseUrl()}/settings`;
}

/**
 * First-run wizard: sign in on the web, connect with a pair code, then sync
 * and optionally import skills already on this machine.
 *
 * Pairing is the gate — sync and discovery run only once this machine is
 * paired to an account. With no pair code the wizard exits cleanly (code 0)
 * with `skillet connect` guidance instead of holding the terminal.
 */
async function runOnboardingWizard(): Promise<void> {
  const bearer = await loadRegistryBearer();
  // Every bare run opens with the face and an info column, Claude Code style.
  // Unpaired runs carry the tagline; paired runs say what this machine has.
  const nameLine = bold("Skillet") + " " + dim(`v${CLI_VERSION}`);
  if (bearer.kind === "none") {
    // Cold-start front door: a bare `skillet` with no account installs the
    // `/skillet` router skill into every detected agent, so `/skillet @<handle>
    // <task>` works immediately with no pairing. Connecting is deliberate and
    // opt-in via `skillet connect`, not a wizard that gates the install.
    const { labels } = await installRouterSkill();
    console.log("\n" + launchBanner([nameLine, "your skills, everywhere."]));
    if (labels.length > 0) {
      console.log("");
      console.log(`  ${ok(`Installed /skillet into ${labels.join(", ")}`)}`);
      console.log("  Try it: /skillet @<handle> <task>  (for example, /skillet @taylor write me a blog)");
      console.log(dim("  Run `skillet connect` to save your own pack and sync it everywhere.") + "\n");
    } else {
      // Nothing to install: fall back to connect guidance so the run still helps.
      console.log("");
      console.log(`  Connect this machine to use your skills ${await detectedAgentsPhrase()}.`);
      console.log(dim("  Sign in and get a pair code at ") + cyan(settingsPageUrl()) + "\n");
      console.log(`  Then run \`skillet connect <code>\``);
    }
    // Deliberate exit, not an error: nothing syncs or imports unpaired.
    return;
  } else {
    // Info column mirrors Claude Code's: version, then what's here (skills
    // and where they run), then which machine this is. All local reads —
    // the banner never waits on the network.
    const state = await readState();
    const total = countUserSkills(state);
    const skillsLine =
      total === 0
        ? `no skills yet ${await detectedAgentsPhrase()}`
        : `${total} skill${total === 1 ? "" : "s"} ${await detectedAgentsPhrase()}`;
    const label = (await readActiveDeviceFile())?.label;
    console.log(
      "\n" + launchBanner([nameLine, skillsLine, ...(label ? [dim(label)] : [])]),
    );
    // Interactive bare runs sync — "open Skillet" means your skills are
    // current, same as launching the desktop app. Headless callers get no
    // implicit work: a script should say what it means (`skillet sync`).
    if (process.stdout.isTTY !== true) {
      console.log(`  Run \`skillet sync\` to sync, or \`skillet status --json\` for state.`);
      return;
    }
  }

  // The menu right after carries pending review and /skillet teaching with
  // the data on the options, so the sync path's own hint blocks stay quiet.
  await runConnectedSync(true, { homeMenuFollows: true });

  const stateAfter = await readState();
  const kitEmpty = Object.keys(stateAfter.skills).length === 0;
  if (kitEmpty) {
    const report = await discoverExistingSkills(ALL_ADAPTERS);
    if (report.scannedRuntimes.length > 0 && report.newSkills.length > 0) {
      console.log("\nOptional: Import skills you already use on this machine\n");
      await runDiscovery({ assumeYes: false });
    }
  }

  await runHomeMenu();
}

const program = new Command();

program
  .name("skillet")
  .description("Your skills, everywhere.")
  // Root options stay before the subcommand: without this, the root
  // -v/--version flag swallows a subcommand's own --version option —
  // `skillet approve <slug> --version 3` printed the CLI version and
  // approved nothing (the tray passes that flag too).
  .enablePositionalOptions()
  .version(CLI_VERSION, "-v, --version", "Show CLI version");

program.configureHelp({
  formatHelp: formatSkilletHelp,
  sortSubcommands: false,
});

registerAllCommands(program);

program.showHelpAfterError();

// Do not use program.action() for the wizard — Commander runs the default action
// before unknown-command handling, so typos like `skillet sghagsh` would start onboarding.

// Drain buffered activity before exit. The timer-based flush in metrics can race
// a fast process exit, so we await an explicit flush after the command resolves,
// with a `beforeExit` backstop for commands that set process.exitCode and return.
// (Hard exits via `exitWith` → `process.exit` can't be awaited; that's the one
// unavoidable gap, and only failing commands take it.)
void (async () => {
  process.once("beforeExit", () => {
    void flushEvents();
  });
  try {
    if (shouldRunOnboardingWizard(process.argv)) {
      await runOnboardingWizard();
    } else {
      await program.parseAsync(process.argv);
    }
  } catch (err) {
    // Last-resort net: a command without its own catch must never dump a
    // stack trace at a person. One human line (control chars stripped,
    // hashes shortened), the stack behind SKILLET_DEBUG=1 for us.
    if (err instanceof CommanderError) throw err; // commander handles its own exits
    // JSON callers (the tray among them) get a parseable envelope even from
    // the last-resort net; humans get the rendered line.
    if (process.argv.includes("--json")) {
      writeJsonError((err as Error).message || String(err) || "unknown error");
    } else {
      printRenderedError(err as Error, fail);
    }
    if (process.env["SKILLET_DEBUG"] === "1" && err instanceof Error && err.stack) {
      console.error(dim(err.stack));
    } else {
      console.error(dim("  Set SKILLET_DEBUG=1 for the full details."));
    }
    process.exitCode = 1;
  } finally {
    await flushEvents();
  }
})();
