import type { Command } from "commander";
import { propose, ProposeError, RegistryClient } from "@skillet/core";
import { resolveRegistryUrl } from "../cli-context.js";
import { ExitCode, exitWith } from "../exit-codes.js";
import { stripControlChars, formatScanFinding } from "../sanitize-output.js";

async function registryClient(opts: { registry?: string; token?: string }): Promise<RegistryClient> {
  const registryUrl = await resolveRegistryUrl(opts);
  const token = opts.token ?? process.env["SKILLET_TOKEN"];
  return new RegistryClient({
    baseUrl: registryUrl,
    ...(token ? { token } : {}),
  });
}

export function registerProposeCommands(program: Command): void {
  program
    .command("propose <slug>")
    .description(
      "Sign and submit a pending proposal for a skill. Does not publish live until the owner approves.",
    )
    .option("--registry <url>", "Registry base URL (overrides identity default)")
    .option("--token <token>", "Bearer token (overrides SKILLET_TOKEN env var)")
    .action(async (slug: string, opts: { registry?: string; token?: string }) => {
      try {
        const result = await propose(slug, {
          ...(opts.registry ? { registryUrl: opts.registry } : {}),
          ...(opts.token ? { token: opts.token } : {}),
        });
        console.log(`✓ Proposal submitted for ${slug}`);
        console.log(`  proposal: ${result.proposalId}`);
        console.log(`  hash:     ${result.hash}`);
        console.log(`  url:      ${result.proposalUrl}`);
      } catch (err) {
        if (err instanceof ProposeError) {
          console.error(`✗ ${err.message}`);
          if (err.code === "stale_base") {
            console.error("  Run `skillet sync` (or fetch the latest manifest) and re-propose.");
          } else if (err.code === "scan_blocked") {
            // The registry proposal gate refused a secret — list each file:line
            // so the author knows what to remove (same shape as publish).
            const body = err.detail as
              | { findings?: Array<{ file: string; lineStart: number; category: string }> }
              | undefined;
            for (const f of body?.findings ?? []) {
              console.error(formatScanFinding(f));
            }
            console.error("  Remove the credential (use an env var or placeholder) and re-propose.");
          }
          exitWith(ExitCode.ERROR);
        }
        console.error(`✗ Propose failed: ${(err as Error).message}`);
        exitWith(ExitCode.ERROR);
      }
    });

  const proposals = program
    .command("proposals")
    .description("Inspect proposals for a skill (@author/slug)");

  proposals
    .command("list <ref>")
    .description("List proposals for a skill (@author/slug)")
    .option("--registry <url>", "Registry base URL")
    .option("--token <token>", "Bearer token (overrides SKILLET_TOKEN env var)")
    .option("--json", "Emit raw JSON")
    .action(
      async (ref: string, opts: { registry?: string; token?: string; json?: boolean }) => {
        const client = await registryClient(opts);
        try {
          const list = await client.listProposals(ref);
          if (opts.json) {
            console.log(JSON.stringify(list, null, 2));
            return;
          }
          if (list.length === 0) {
            console.log(`No proposals for ${ref}.`);
            return;
          }
          for (const p of list) {
            const date = new Date(p.created_at * 1000).toISOString().slice(0, 10);
            console.log(
              `  ${p.proposal_id.slice(0, 8)}…  [${p.state}]  ${p.proposer}  ${date}`,
            );
            console.log(`    hash: ${p.proposed_hash}`);
          }
        } catch (err) {
          console.error(`✗ ${(err as Error).message}`);
          exitWith(ExitCode.ERROR);
        }
      },
    );

  proposals
    .command("show <ref> <proposalId>")
    .description("Show proposal detail with graded diff (@author/slug proposalId)")
    .option("--registry <url>", "Registry base URL")
    .option("--token <token>", "Bearer token (overrides SKILLET_TOKEN env var)")
    .option("--json", "Emit raw JSON")
    .action(
      async (
        ref: string,
        proposalId: string,
        opts: { registry?: string; token?: string; json?: boolean },
      ) => {
        const client = await registryClient(opts);
        try {
          const detail = await client.getProposal(ref, proposalId);
          if (opts.json) {
            console.log(JSON.stringify(detail, null, 2));
            return;
          }
          console.log(`Proposal ${detail.proposal_id} [${detail.state}]`);
          console.log(`  skill:    ${ref}`);
          console.log(`  proposer: ${detail.proposer.handle}`);
          console.log(`  hash:     ${detail.proposed_hash}`);
          console.log(`  scan:     ${detail.scan.status}`);
          if (detail.diff.length > 0) {
            console.log("\nDiff:");
            for (const f of detail.diff) {
              if (f.status === "unchanged") continue;
              // Path + diff content are attacker-controlled (registry-supplied);
              // strip terminal control sequences before printing.
              console.log(
                `  ${f.status.toUpperCase()}  ${stripControlChars(f.path)}${f.binary ? " (binary)" : ""}`,
              );
              if (f.diff) {
                for (const line of f.diff.split("\n").slice(0, 20)) {
                  console.log(`    ${stripControlChars(line)}`);
                }
              }
            }
          }
        } catch (err) {
          console.error(`✗ ${(err as Error).message}`);
          exitWith(ExitCode.ERROR);
        }
      },
    );
}
