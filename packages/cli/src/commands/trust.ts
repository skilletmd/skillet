import type { Command } from "commander";
import {
  loadPolicy,
  setGlobalDefault,
  setAuthorPolicy,
  setSkillPolicy,
  setKitPolicy,
  type TrustMode,
  type SourceClass,
} from "@skillet/core";
import { ExitCode, exitWith } from "../exit-codes.js";

function parseMode(v: string): TrustMode {
  if (v === "auto" || v === "gate") return v;
  console.error(`✗ Invalid mode "${v}". Use "auto" or "gate".`);
  exitWith(ExitCode.USAGE);
}

export function registerTrustCommands(program: Command): void {
  const trust = program
    .command("trust", { hidden: true })
    .description("Control whether synced updates auto-apply or wait for a diff");

  trust
    .command("show")
    .description("Show the current update-trust policy (globals, authors, kits, skills)")
    .option("--json", "Emit the raw policy JSON")
    .action(async (opts: { json?: boolean }) => {
      const policy = await loadPolicy();
      if (opts.json) {
        console.log(JSON.stringify(policy, null, 2));
        return;
      }
      console.log("Update-trust policy");
      console.log(`  global  own-kit (your team):  ${policy.globals["own-kit"]}`);
      console.log(`  global  external (strangers): ${policy.globals.external}`);
      const authors = Object.entries(policy.authors);
      const kits = Object.entries(policy.kits);
      const skills = Object.entries(policy.skills);
      if (authors.length) {
        console.log("  per-author:");
        for (const [k, m] of authors) console.log(`    ${k.slice(0, 16)}… → ${m}`);
      }
      if (kits.length) {
        console.log("  per-kit:");
        for (const [k, m] of kits) console.log(`    ${k} → ${m}`);
      }
      if (skills.length) {
        console.log("  per-skill:");
        for (const [s, m] of skills) console.log(`    ${s} → ${m}`);
      }
      if (!authors.length && !kits.length && !skills.length) {
        console.log("  (no per-author, per-kit, or per-skill overrides; defaults apply)");
      }
    });

}

/** Legacy trust mutations — SKILLET_LEGACY_CLI=1 only. */
export function registerLegacyTrustCommands(program: Command): void {
  const trust = program.commands.find((c) => c.name() === "trust");
  if (!trust) {
    throw new Error("registerTrustCommands must run before registerLegacyTrustCommands");
  }

  trust
    .command("default <class> <mode>")
    .description('Set a global default. <class>: own-kit | external. <mode>: auto | gate')
    .action(async (cls: string, mode: string) => {
      if (cls !== "own-kit" && cls !== "external") {
        console.error(`✗ Invalid class "${cls}". Use "own-kit" or "external".`);
        exitWith(ExitCode.USAGE);
      }
      await setGlobalDefault(cls as SourceClass, parseMode(mode));
      console.log(`✓ Global default for ${cls} set to ${mode}.`);
    });

  trust
    .command("author <keyId> <mode>")
    .description('Trust an author by key ID. <mode>: auto | gate | clear (remove override)')
    .action(async (keyId: string, mode: string) => {
      if (mode === "clear") {
        await setAuthorPolicy(keyId, null);
        console.log(`✓ Cleared per-author override for ${keyId.slice(0, 16)}….`);
        return;
      }
      await setAuthorPolicy(keyId, parseMode(mode));
      console.log(`✓ Author ${keyId.slice(0, 16)}… set to ${mode}.`);
    });

  trust
    .command("skill <slug> <mode>")
    .description('Override trust for one skill. <mode>: auto | gate | clear (remove override)')
    .action(async (slug: string, mode: string) => {
      if (mode === "clear") {
        await setSkillPolicy(slug, null);
        console.log(`✓ Cleared per-skill override for ${slug}.`);
        return;
      }
      await setSkillPolicy(slug, parseMode(mode));
      console.log(`✓ Skill ${slug} set to ${mode}.`);
    });

  trust
    .command("kit <kitRef> <mode>")
    .description(
      "Auto-apply or gate updates from one subscribed kit. <kitRef>: @owner/kit. <mode>: auto | gate | clear (remove override)",
    )
    .action(async (kitRef: string, mode: string) => {
      if (mode === "clear") {
        await setKitPolicy(kitRef, null);
        console.log(`✓ Cleared per-kit override for ${kitRef}.`);
        return;
      }
      await setKitPolicy(kitRef, parseMode(mode));
      console.log(`✓ Kit ${kitRef} set to ${mode}.`);
    });
}
