import type { Command } from "commander";
import { createOrg, inviteOrgMember, listOrgMembers } from "@skillet/core";
import { REGISTRY_DEFAULT_TEAM } from "../../cli-context.js";
import { ExitCode, exitWith } from "../../exit-codes.js";

export function registerTeamCommands(program: Command): void {
  const team = program
    .command("team")
    .description("Manage teams (organizations) on the registry");

  team
    .command("create")
    .description("Create a new team on the registry")
    .requiredOption("--slug <slug>", "URL-safe team identifier, e.g. acme")
    .requiredOption("--name <name>", "Human-readable team name")
    .option("--registry <url>", "Registry base URL", REGISTRY_DEFAULT_TEAM)
    .option("--token <token>", "Session token (defaults to ~/.skillet/session.json)")
    .action(async (opts: { slug: string; name: string; registry: string; token?: string }) => {
      try {
        const result = await createOrg({
          slug: opts.slug,
          name: opts.name,
          registryUrl: opts.registry,
          token: opts.token,
        });
        console.log(`✓ Team "${result.name}" created (slug: ${result.slug})`);
        console.log(`  id: ${result.org_id}`);
      } catch (err) {
        const e = err as Error & { code?: string };
        console.error(`✗ team create failed: ${e.message}`);
        exitWith(ExitCode.ERROR);
      }
    });

  team
    .command("invite <slug>")
    .description("Invite a member to a team by handle or email")
    .option("--handle <handle>", "Skillet handle of the user to invite")
    .option("--email <email>", "Email address of the user to invite")
    .option("--role <role>", "Role to assign: member (default) or admin", "member")
    .option("--registry <url>", "Registry base URL", REGISTRY_DEFAULT_TEAM)
    .option("--token <token>", "Session token (defaults to ~/.skillet/session.json)")
    .action(
      async (
        slug: string,
        opts: { handle?: string; email?: string; role: string; registry: string; token?: string },
      ) => {
        if (!opts.handle && !opts.email) {
          console.error("✗ Provide --handle or --email");
          exitWith(ExitCode.USAGE);
        }
        if (opts.handle && opts.email) {
          console.error("✗ Provide --handle or --email, not both");
          exitWith(ExitCode.USAGE);
        }
        if (opts.role !== "member" && opts.role !== "admin") {
          console.error(`✗ Invalid role "${opts.role}". Use "member" or "admin".`);
          exitWith(ExitCode.USAGE);
        }
        try {
          const result = await inviteOrgMember({
            orgSlug: slug,
            handle: opts.handle,
            email: opts.email,
            role: opts.role as "member" | "admin",
            registryUrl: opts.registry,
            token: opts.token,
          });
          if (result.status === "added") {
            console.log(`✓ Added ${opts.handle ?? opts.email} to ${slug}`);
          } else {
            console.log(`✓ Invited ${opts.handle ?? opts.email} to ${slug} (pending acceptance)`);
          }
        } catch (err) {
          const e = err as Error & { code?: string };
          console.error(`✗ team invite failed: ${e.message}`);
          exitWith(ExitCode.ERROR);
        }
      },
    );

  team
    .command("members <slug>")
    .description("List members of a team")
    .option("--json", "Emit machine-readable member list")
    .option("--registry <url>", "Registry base URL", REGISTRY_DEFAULT_TEAM)
    .option("--token <token>", "Session token (defaults to ~/.skillet/session.json)")
    .action(async (slug: string, opts: { json?: boolean; registry: string; token?: string }) => {
      try {
        const result = await listOrgMembers({
          orgSlug: slug,
          registryUrl: opts.registry,
          token: opts.token,
        });
        if (opts.json) {
          process.stdout.write(JSON.stringify(result, null, 2) + "\n");
          return;
        }
        console.log(`Team: ${result.org.name} (${result.org.slug})`);
        if (result.members.length === 0 && result.pending.length === 0) {
          console.log("  (no members)");
          return;
        }
        if (result.members.length > 0) {
          console.log(`\n${result.members.length} member(s):`);
          for (const m of result.members) {
            console.log(`  ${m.role.padEnd(6)}  @${m.handle ?? m.user_id}`);
          }
        }
        if (result.pending.length > 0) {
          console.log(`\n${result.pending.length} pending invite(s):`);
          for (const p of result.pending) {
            const who = p.handle ? `@${p.handle}` : p.email ?? "(unknown)";
            console.log(`  ${p.role.padEnd(6)}  ${who}`);
          }
        }
      } catch (err) {
        const e = err as Error & { code?: string };
        console.error(`✗ team members failed: ${e.message}`);
        exitWith(ExitCode.ERROR);
      }
    });
}
