import type { Command } from "commander";
import {
  createKit,
  addSkillToKit,
  inviteKitMember,
  listKitMembers,
  mintKitKey,
  removeKitMember,
  revokeKitKey,
  bootstrapLocalKit,
} from "@skillet/core";
import { REGISTRY_DEFAULT_TEAM } from "../../cli-context.js";
import { ExitCode, exitWith } from "../../exit-codes.js";

export function registerKitCommands(program: Command): void {
  const kit = program
    .command("kit")
    .description("Manage private skill kits (share skills with teammates)");

  kit
    .command("create <name>")
    .description("Create a private kit")
    .option("--registry <url>", "Registry base URL", REGISTRY_DEFAULT_TEAM)
    .option("--token <token>", "Session token (defaults to $SKILLET_TOKEN)")
    .action(async (name: string, opts: { registry: string; token?: string }) => {
      try {
        const result = await createKit({
          name,
          registryUrl: opts.registry,
          token: opts.token,
        });
        console.log(`✓ Kit "${result.name}" created for @${result.owner}`);
        console.log(`  id: ${result.id}`);
      } catch (err) {
        const e = err as Error & { code?: string };
        console.error(`✗ kit create failed: ${e.message}`);
        exitWith(ExitCode.ERROR);
      }
    });

  kit
    .command("bootstrap <name>")
    .description(
      "Publish local skills, create a named kit, and add them so every signed-in device can sync the set",
    )
    .option("--json", "Emit a machine-readable report (for the desktop app)")
    .option("--registry <url>", "Registry base URL", REGISTRY_DEFAULT_TEAM)
    .option("--token <token>", "Session token (defaults to $SKILLET_TOKEN)")
    .action(async (name: string, opts: { json?: boolean; registry: string; token?: string }) => {
      try {
        const result = await bootstrapLocalKit({
          name,
          registryUrl: opts.registry,
          token: opts.token,
          sessionAuth: true,
        });
        if (opts.json) {
          process.stdout.write(JSON.stringify(result) + "\n");
          if (!result.ok && !result.empty) exitWith(ExitCode.ERROR);
          return;
        }
        if (result.empty) {
          console.log("No local skills to back up. Run `skillet import` to add skills from your runtimes first.");
          return;
        }
        if (!result.ok) {
          console.error("✗ kit bootstrap did not complete.");
          for (const f of result.failed) {
            console.error(`  ${f.slug} (${f.stage}): ${f.error}`);
          }
          exitWith(ExitCode.ERROR);
        }
        console.log(
          `✓ Backed up ${result.kitLinked.length} skill(s) to kit "${result.kit?.name}" (@${result.owner})`,
        );
        if (result.failed.length > 0) {
          console.log(`  ${result.failed.length} skill(s) had errors. See above.`);
        }
        console.log("  Run `skillet sync` on your other devices to pull them in.");
      } catch (err) {
        const e = err as Error;
        if (opts.json) {
          process.stdout.write(JSON.stringify({ ok: false, error: e.message }) + "\n");
        } else {
          console.error(`✗ kit bootstrap failed: ${e.message}`);
        }
        exitWith(ExitCode.ERROR);
      }
    });

  kit
    .command("add <kit> <ref>")
    .description("Link a published skill into a kit (@author/slug into kit name or UUID)")
    .option("--registry <url>", "Registry base URL", REGISTRY_DEFAULT_TEAM)
    .option("--token <token>", "Session token (defaults to $SKILLET_TOKEN)")
    .action(
      async (kitRef: string, ref: string, opts: { registry: string; token?: string }) => {
        try {
          await addSkillToKit({
            kitRef,
            skillRef: ref,
            registryUrl: opts.registry,
            token: opts.token,
          });
          console.log(`✓ Added ${ref} to kit ${kitRef}`);
        } catch (err) {
          const e = err as Error & { code?: string };
          console.error(`✗ kit add failed: ${e.message}`);
          exitWith(ExitCode.ERROR);
        }
      },
    );

  kit
    .command("invite <kit> <handle>")
    .description("Invite a teammate to a private kit by handle")
    .option("--registry <url>", "Registry base URL", REGISTRY_DEFAULT_TEAM)
    .option("--token <token>", "Session token (defaults to $SKILLET_TOKEN)")
    .action(
      async (kitRef: string, handle: string, opts: { registry: string; token?: string }) => {
        try {
          const result = await inviteKitMember({
            kitRef,
            handle,
            registryUrl: opts.registry,
            token: opts.token,
          });
          if (result.status === "added") {
            console.log(`✓ @${handle} added to kit ${kitRef}`);
          } else {
            console.log(`✓ @${handle} invited to kit ${kitRef} (pending until they claim handle)`);
          }
        } catch (err) {
          const e = err as Error & { code?: string };
          console.error(`✗ kit invite failed: ${e.message}`);
          exitWith(ExitCode.ERROR);
        }
      },
    );

  kit
    .command("members <kit>")
    .description("List humans, pending invites, and kit-keys for a kit")
    .option("--json", "Emit machine-readable output")
    .option("--registry <url>", "Registry base URL", REGISTRY_DEFAULT_TEAM)
    .option("--token <token>", "Session token (defaults to $SKILLET_TOKEN)")
    .action(async (kitRef: string, opts: { json?: boolean; registry: string; token?: string }) => {
      try {
        const result = await listKitMembers({
          kitRef,
          registryUrl: opts.registry,
          token: opts.token,
        });
        if (opts.json) {
          process.stdout.write(JSON.stringify(result, null, 2) + "\n");
          return;
        }
        const ownerPrefix = result.owner ? `owner @${result.owner}, ` : "";
        console.log(
          `Kit ${kitRef} — ${ownerPrefix}${result.humans.length} invited member(s), ${result.pending_humans.length} pending, ${result.agents.length} key(s)`,
        );
        if (result.owner) {
          console.log(`  owner   @${result.owner}`);
        }
        for (const h of result.humans) {
          console.log(`  member  @${h.handle ?? h.user_id}`);
        }
        for (const p of result.pending_humans) {
          console.log(`  pending ${p.handle ? `@${p.handle}` : p.email ?? p.invite_id}`);
        }
        for (const a of result.agents) {
          const revoked = a.revoked_at ? " (revoked)" : "";
          console.log(`  key     ${a.kit_key_id}  ${a.label}${revoked}`);
        }
      } catch (err) {
        const e = err as Error & { code?: string };
        console.error(`✗ kit members failed: ${e.message}`);
        exitWith(ExitCode.ERROR);
      }
    });

  const kitKey = kit.command("key").description("Manage headless kit-keys");

  kitKey
    .command("mint <kit>")
    .description("Mint a scoped kit-key for CI/agents")
    .requiredOption("--label <label>", "Label for this key, e.g. ci-runner")
    .option("--registry <url>", "Registry base URL", REGISTRY_DEFAULT_TEAM)
    .option("--token <token>", "Session token (defaults to $SKILLET_TOKEN)")
    .action(async (kitRef: string, opts: { label: string; registry: string; token?: string }) => {
      try {
        const result = await mintKitKey({
          kitRef,
          label: opts.label,
          registryUrl: opts.registry,
          token: opts.token,
        });
        console.log(`✓ Kit-key minted for ${kitRef} (${result.label})`);
        console.log(`  kit_key_id: ${result.kit_key_id}`);
        console.log(`  token: ${result.kit_token}`);
        console.log("  Store this token now. It is shown exactly once.");
      } catch (err) {
        const e = err as Error & { code?: string };
        console.error(`✗ kit key mint failed: ${e.message}`);
        exitWith(ExitCode.ERROR);
      }
    });

  kitKey
    .command("revoke <kit> <kit-key-id>")
    .description("Revoke a kit-key")
    .option("--registry <url>", "Registry base URL", REGISTRY_DEFAULT_TEAM)
    .option("--token <token>", "Session token (defaults to $SKILLET_TOKEN)")
    .action(
      async (kitRef: string, kitKeyId: string, opts: { registry: string; token?: string }) => {
        try {
          await revokeKitKey({
            kitRef,
            kitKeyId,
            registryUrl: opts.registry,
            token: opts.token,
          });
          console.log(`✓ Revoked kit-key ${kitKeyId} on kit ${kitRef}`);
        } catch (err) {
          const e = err as Error & { code?: string };
          console.error(`✗ kit key revoke failed: ${e.message}`);
          exitWith(ExitCode.ERROR);
        }
      },
    );

  const kitMember = kit.command("member").description("Manage kit membership");

  kitMember
    .command("remove <kit> <handle>")
    .description("Remove a human member from a kit")
    .option("--registry <url>", "Registry base URL", REGISTRY_DEFAULT_TEAM)
    .option("--token <token>", "Session token (defaults to $SKILLET_TOKEN)")
    .action(
      async (kitRef: string, handle: string, opts: { registry: string; token?: string }) => {
        try {
          await removeKitMember({
            kitRef,
            handle,
            registryUrl: opts.registry,
            token: opts.token,
          });
          console.log(`✓ Removed @${handle} from kit ${kitRef}`);
        } catch (err) {
          const e = err as Error & { code?: string };
          console.error(`✗ kit member remove failed: ${e.message}`);
          exitWith(ExitCode.ERROR);
        }
      },
    );
}
