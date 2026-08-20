import type { Command } from "commander";
import { readFileSync } from "node:fs";
import {
  readState,
  skillContentPath,
  groupSkillsByKit,
  resolveDeviceScopedManifest,
} from "@skillet/core";
import { renderKitList } from "../kit-list-format.js";
import { toListJsonSkill } from "../list-json-format.js";
import { REGISTRY_DEFAULT } from "../cli-context.js";
import { webBaseUrl } from "../cli-command-tier.js";
import { dim, bold, cyan } from "../cli-colors.js";

export function registerListCommand(program: Command): void {
  program
    .command("list")
    .description("List skills grouped by kit")
    .option(
      "--json",
      "Emit the kit as JSON, including each skill's SKILL.md body (the desktop app's read contract)",
    )
    .action(async (opts: { json?: boolean }) => {
      const state = await readState();
      const skills = Object.values(state.skills);

      const manifest = await resolveDeviceScopedManifest({
        registryUrl: REGISTRY_DEFAULT,
      });
      const listOpts =
        manifest.fetched && manifest.items !== undefined
          ? { manifestItems: manifest.items }
          : undefined;

      const groups = groupSkillsByKit(state, listOpts);
      const listedSkills = groups.flatMap((g) => g.skills);

      if (opts.json === true) {
        const out = listedSkills.map((s) => {
          let body = "";
          try {
            body = readFileSync(skillContentPath(s.slug), "utf8");
          } catch {
            body = "";
          }
          const local = skills.some((localSkill) => localSkill.slug === s.slug);
          return toListJsonSkill(s, { local, body });
        });
        process.stdout.write(
          JSON.stringify(
            {
              skills: out,
              groups: groups.map((g) => ({
                kitRef: g.kitRef,
                synced: g.kitRef !== null,
                skills: g.skills.map((s) => s.slug),
              })),
            },
            null,
            2,
          ) + "\n",
        );
        return;
      }

      if (listedSkills.length === 0) {
        if (manifest.fetched) {
          console.log("No skills in your kits yet.");
          console.log(dim("  Add skills at ") + cyan(webBaseUrl()));
          console.log(dim("  Or import local skills with `skillet import <path>`"));
        } else {
          console.log("Your kit is empty.");
          console.log(dim("  Sign in and get a pair code at ") + cyan(`${webBaseUrl()}/settings`));
          console.log(dim("  Then run ") + bold("skillet connect <code>"));
          console.log(dim("  Or import local skills with `skillet import <path>`"));
        }
        return;
      }

      const notLocal = listedSkills.some(
        (s) => !skills.some((localSkill) => localSkill.slug === s.slug),
      );
      console.log(renderKitList(groups, notLocal ? { registryOnly: true } : undefined));
    });
}
