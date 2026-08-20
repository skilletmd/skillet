import type { Command } from "commander";
import { readState, publishAll, loadIdentity, loadRegistryBearer, PublishError } from "@skillet/core";
import * as clack from "@clack/prompts";
import { printDeprecationHint } from "../cli-deprecation.js";
import { fail } from "../cli-colors.js";
import { ExitCode, exitWith } from "../exit-codes.js";
import { formatScanFinding } from "../sanitize-output.js";

export function registerPublishCommand(program: Command): void {
  program
    .command("publish [slug]")
    .description(
      "Legacy: sign and push skill(s) to the registry (prefer `upload` on this device)",
    )
    .option(
      "--registry <url>",
      "Registry base URL (defaults to the one captured at login)",
      process.env["SKILLET_REGISTRY_URL"],
    )
    .option("--token <token>", "Bearer token for the registry (defaults to $SKILLET_TOKEN)")
    .option("--public", "Publish publicly (requires confirmation; default is private)")
    .option("--yes", "Skip the public-publish confirmation (required for --public without a terminal)")
    .option("--handle <handle>", "Claim this handle at first publish (inline login)")
    .option("--name <name>", "Display name for inline handle claim")
    .option("--session", "Publish via verified session (web/desktop); no local Ed25519 signature")
    .option("--json", "Emit a machine-readable publish report (for the native app)")
    .action(
      async (
        slug: string | undefined,
        opts: {
          registry?: string;
          token?: string;
          public?: boolean;
          yes?: boolean;
          handle?: string;
          name?: string;
          json?: boolean;
          session?: boolean;
        },
      ) => {
        printDeprecationHint(
          "To share local skills from this machine, use `skillet upload`",
        );
        const asJson = opts.json === true;
        const isPublic = opts.public === true;
        const visibility = isPublic ? "public" : "private";

        let slugsToPublish: string[];
        if (slug) {
          slugsToPublish = [slug];
        } else {
          const state = await readState();
          slugsToPublish = Object.keys(state.skills);
          if (slugsToPublish.length === 0) {
            if (asJson) {
              process.stdout.write(
                JSON.stringify({ ok: true, visibility, results: [], empty: true }) + "\n",
              );
              return;
            }
            console.log("Kit is empty. Use `skillet import <path>` to add a skill first.");
            return;
          }
          if (!asJson) {
            console.log(
              `Found ${slugsToPublish.length} skill(s) in kit: ${slugsToPublish.join(", ")}`,
            );
          }
        }

        // Public visibility always needs explicit consent: the clack confirm
        // on a terminal, or the --yes flag anywhere. Headless --public without
        // --yes refuses — it must never publish publicly in silence.
        if (isPublic && opts.yes !== true) {
          // Prompting needs BOTH streams: clack renders on stdout and reads
          // stdin. Either one piped means no real consent is possible — the
          // explicit flag is the only path (fail closed).
          if (process.stdout.isTTY !== true || process.stdin.isTTY !== true) {
            if (asJson) {
              process.stdout.write(
                JSON.stringify({
                  ok: false,
                  code: "confirmation_required",
                  error: "publishing publicly needs --yes when not run interactively",
                }) + "\n",
              );
            } else {
              console.error(fail("Publishing publicly needs --yes when not run interactively."));
            }
            exitWith(ExitCode.USAGE);
            return;
          }
          const answer = await clack.confirm({
            message: `Publish ${slugsToPublish.length} skill${slugsToPublish.length === 1 ? "" : "s"} publicly? Anyone will be able to see them.`,
            initialValue: false,
          });
          // Esc or No: fail closed, nothing published.
          if (clack.isCancel(answer) || answer !== true) {
            console.log("Cancelled. Nothing published.");
            return;
          }
        }

        const identity = await loadIdentity();
        const bearer = await loadRegistryBearer(opts.token);
        const useSessionPublish = opts.session === true || (!!bearer.token && !identity);

        let resolvedHandle = opts.handle;
        let resolvedName = opts.name;
        if (
          !identity &&
          !useSessionPublish &&
          !resolvedHandle &&
          process.stdout.isTTY === true &&
          process.stdin.isTTY === true
        ) {
          console.log("\nFirst publish. Claim your identity.\n");
          const handleAnswer = await clack.text({
            message: "Handle",
            placeholder: "e.g. taylor",
            validate: (v) => (v && v.trim().length > 0 ? undefined : "A handle is required"),
          });
          if (clack.isCancel(handleAnswer)) {
            console.log("Cancelled. Nothing published.");
            return;
          }
          resolvedHandle = String(handleAnswer).trim().toLowerCase();
          const nameAnswer = await clack.text({
            message: "Display name",
            placeholder: "e.g. Taylor Santos",
          });
          if (clack.isCancel(nameAnswer)) {
            console.log("Cancelled. Nothing published.");
            return;
          }
          resolvedName = String(nameAnswer ?? "").trim();
        }

        try {
          const results = await publishAll(slugsToPublish, {
            ...(opts.registry ? { registryUrl: opts.registry } : {}),
            ...(opts.token ? { token: opts.token } : {}),
            visibility,
            ...(resolvedHandle ? { handle: resolvedHandle } : {}),
            ...(resolvedName ? { name: resolvedName } : {}),
            ...(useSessionPublish ? { sessionAuth: true } : {}),
          });

          const resolvedIdentity = await loadIdentity();
          const handle = resolvedIdentity?.handle ?? resolvedHandle ?? "unknown";

          if (asJson) {
            process.stdout.write(
              JSON.stringify({
                ok: true,
                visibility,
                handle,
                results: results.map((r) => ({
                  slug: r.slug,
                  alreadyExists: r.alreadyExists,
                  hashRef: r.hashRef,
                  versionUrl: r.versionUrl,
                  requiresWarnings: r.requiresWarnings,
                })),
              }) + "\n",
            );
            return;
          }

          for (const result of results) {
            for (const w of result.requiresWarnings) {
              console.log(`⚠  ${result.slug}: requires: ${w}`);
            }
            console.log(
              result.alreadyExists
                ? `= ${handle}/${result.slug} already at ${result.hashRef.slice(0, 19)}… (no-op)`
                : `✓ Published ${handle}/${result.slug} [${visibility}] ${result.hashRef.slice(0, 19)}…`,
            );
            if (!result.alreadyExists) {
              console.log(`  ${result.versionUrl}`);
            }
            // A flagged version publishes, but installers see the
            // findings. Nudge the author to explain them on the web (notes can't
            // be entered from the CLI).
            if (result.serverScan?.status === "flagged") {
              const n = result.serverScan.findings.length;
              console.log(
                `  ⚑ ${n} pattern${n === 1 ? "" : "s"} flagged. Add an explanation at /${handle}/${result.slug} so installers know why.`,
              );
            }
          }
        } catch (err) {
          if (asJson) {
            const code = err instanceof PublishError ? err.code : "publish_failed";
            const detail = err instanceof PublishError ? err.detail : undefined;
            process.stdout.write(
              JSON.stringify({
                ok: false,
                code,
                error: (err as Error).message,
                ...(detail !== undefined ? { detail } : {}),
              }) + "\n",
            );
            exitWith(ExitCode.ERROR);
          }
          if (err instanceof PublishError) {
            console.error(`✗ ${err.message}`);
            if (err.code === "stale_base") {
              console.error("  Run `skillet sync` to pick up the latest version, then publish again.");
              exitWith(ExitCode.CONFLICT);
            } else if (err.code === "scan_blocked") {
              // The registry refused a secret or quarantined verdict.
              const body = err.detail as
                | {
                    reason?: "secret" | "quarantine";
                    findings?: Array<{ file: string; lineStart: number; category: string }>;
                  }
                | undefined;
              for (const f of body?.findings ?? []) {
                console.error(formatScanFinding(f));
              }
              console.error(
                body?.reason === "secret"
                  ? "  Remove the credential (use an env var or placeholder) and republish."
                  : "  Fix the flagged patterns and republish.",
              );
            }
            exitWith(ExitCode.ERROR);
          }
          console.error(`✗ Publish failed: ${(err as Error).message}`);
          exitWith(ExitCode.ERROR);
        }
      },
    );
}
