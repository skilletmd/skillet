import type { Command } from "commander";
import {
  readState,
  uploadLocalSkills,
  type UploadProgressEvent,
} from "@skillet/core";
import { requirePaired } from "../auth-required.js";
import { confirm } from "./import-cmd.js";
import {
  configureAddPresent,
  printAddHint,
  printStepInfo,
} from "../cli-add-present.js";
import { collect, REGISTRY_DEFAULT } from "../cli-context.js";
import { ExitCode, exitWith, exitCodeForError } from "../exit-codes.js";
import { fail } from "../cli-colors.js";
import {
  displaySlug,
  renderUploadProgress,
  summarizeUploadResult,
} from "./upload-present.js";

export { displaySlug, renderUploadProgress, summarizeUploadResult };

/** Count local, un-owned skills — the set a no-`--skill` batch would publish. */
async function countCapturable(): Promise<number> {
  const state = await readState();
  return Object.values(state.skills).filter((s) => s.source === "local" && !s.owner)
    .length;
}

/** Upload local skills to the account's profile kit (desktop + device golden route). */
export function registerUploadCommand(program: Command): void {
  program
    .command("upload [name]")
    .description("Upload local skills, private, to your account")
    .option("--skill <slug>", "Upload only the named skill(s); repeatable", collect, [] as string[])
    .option("--all", "Upload every un-published local skill (required for a no --skill batch)")
    .option("--public", "Publish publicly (requires confirmation; default is private)")
    .option("--yes", "Skip the public-upload confirmation (required for --public without a terminal)")
    .option("--json", "Emit a machine-readable report (for the desktop app)")
    .option("--registry <url>", "Registry base URL", REGISTRY_DEFAULT)
    .option("--token <token>", "Session token (defaults to $SKILLET_TOKEN)")
    .action(
      async (
        name: string | undefined,
        opts: {
          skill: string[];
          all?: boolean;
          public?: boolean;
          yes?: boolean;
          json?: boolean;
          registry: string;
          token?: string;
        },
      ) => {
        const asJson = opts.json === true;

        // The positional was removed (skills go to the profile kit, not a named
        // kit). It used to be accepted-and-ignored, which silently turned
        // `upload marketing-skills` (intent: one skill) into a no-`--skill`
        // batch that published EVERY local skill. Hard-fail instead so the old
        // syntax can never trigger a mass upload.
        if (name !== undefined) {
          const msg =
            `upload no longer takes a positional name. Use \`--skill ${name}\` to upload one skill, or \`--all\` to upload every local skill.`;
          if (asJson) {
            process.stdout.write(JSON.stringify({ ok: false, error: msg, code: "positional_removed" }) + "\n");
          } else {
            console.error(fail(msg));
          }
          exitWith(ExitCode.ERROR);
        }

        // Pairing gate — upload publishes local skills to the account, so an
        // unpaired machine fails with the shared auth-required message. In
        // --json mode (how the desktop invokes it) the envelope goes to stdout.
        await requirePaired(opts.token, { json: asJson });

        // No `--skill` means "publish every local skill." That is a bulk,
        // hard-to-undo action, so it must be explicit: `--all` (scripts/desktop
        // — desktop always passes `--skill`, so it never reaches here) or an
        // interactive y/N confirm. Refusing the silent default is what closes
        // the accidental mass-upload path.
        // Public visibility always needs explicit consent, same contract as
        // publish: the clack confirm on a terminal, or --yes anywhere.
        // Headless --public without --yes fails closed — an upload must never
        // go public in silence.
        if (opts.public === true && opts.yes !== true) {
          if (process.stdout.isTTY !== true || process.stdin.isTTY !== true) {
            const msg = "Uploading publicly needs --yes when not run interactively.";
            if (asJson) {
              process.stdout.write(
                JSON.stringify({ ok: false, code: "confirmation_required", error: msg }) + "\n",
              );
            } else {
              console.error(fail(msg));
            }
            exitWith(ExitCode.USAGE);
          }
          const accepted = await confirm(
            "Upload publicly? Anyone will be able to see these skills.",
          );
          if (!accepted) {
            console.log("Cancelled. Nothing uploaded.");
            return;
          }
        }

        if (opts.skill.length === 0 && opts.all !== true) {
          const count = await countCapturable();
          if (count === 0) {
            const msg = "Nothing to upload. Run `skillet import` to pull skills from this machine first.";
            if (asJson) {
              process.stdout.write(JSON.stringify({ ok: false, empty: true, error: msg }) + "\n");
            } else {
              console.log(msg);
            }
            return;
          }
          const vis = opts.public === true ? "publicly" : "privately (private)";
          const proceed =
            process.stdin.isTTY === true &&
            (await confirm(
              `This will upload all ${count} local skill(s) ${vis} to your profile. Continue?`,
            ));
          if (!proceed) {
            const msg =
              `Refusing to upload all ${count} local skill(s) without confirmation. Pass \`--all\` or select skills with \`--skill <slug>\`.`;
            if (asJson) {
              process.stdout.write(JSON.stringify({ ok: false, error: msg, code: "confirmation_required" }) + "\n");
            } else {
              console.error(fail(msg));
            }
            // USAGE, matching publish's confirmation_required and the
            // documented exit-code table (missing flags, not a failure).
            exitWith(ExitCode.USAGE);
          }
        }

        const visibility = opts.public === true ? "public" : "private";
        if (!asJson) {
          configureAddPresent({ json: false, color: process.stdout.isTTY === true });
        }

        try {
          const result = await uploadLocalSkills({
            ...(opts.skill.length > 0 ? { slugs: opts.skill } : {}),
            visibility,
            registryUrl: opts.registry,
            token: opts.token,
            sessionAuth: true,
            ...(!asJson
              ? {
                  onProgress: (event: UploadProgressEvent) => {
                    if (event.phase === "start" && event.index === 0) {
                      printStepInfo(
                        `${event.total} local skill${event.total === 1 ? "" : "s"} (${visibility})`,
                      );
                    }
                    renderUploadProgress(event);
                  },
                }
              : {}),
          });
          if (asJson) {
            process.stdout.write(JSON.stringify(result) + "\n");
            if (!result.ok && !result.empty) exitWith(ExitCode.ERROR);
            return;
          }
          if (result.empty) {
            console.log(
              "Nothing to upload. Run `skillet import` to pull skills from this machine first.",
            );
            return;
          }
          if (!result.ok) {
            console.error(fail("Upload did not complete."));
            if (result.published.length === 0) {
              for (const f of result.failed) {
                console.error(`  ${displaySlug(f.slug)}: ${f.error}`);
              }
            }
            exitWith(ExitCode.ERROR);
          }
          console.log(summarizeUploadResult(result, visibility));
          printAddHint("Other devices pull them in on the next sync.");
        } catch (err) {
          const message = (err as Error).message;
          // Auth rejection (401/403) exits AUTH so a revoked device reads as
          // "re-pair", not a retryable error; stale base (409) exits CONFLICT.
          const exit = exitCodeForError(err);
          if (asJson) {
            process.stdout.write(JSON.stringify({ ok: false, error: message }) + "\n");
          } else {
            console.error(fail(`Upload failed: ${message}`));
          }
          exitWith(exit);
        }
      },
    );
}
