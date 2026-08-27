import type { Command } from "commander";
import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { loadRegistryBearer } from "@skillet/core";
import { pathExists } from "../cli-context.js";
import { ExitCode, exitWith } from "../exit-codes.js";
import { bold, cyan, dim, fail, ok } from "../cli-colors.js";

/** Slug rules for a skill directory: what every adapter can materialize. */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;

function skillMd(name: string, description: string): string {
  // Always emit the description as a double-quoted scalar. A plain scalar breaks
  // on a colon (`description: does: this`), which is the shape a real trigger
  // sentence takes, and the scaffold would then fail to parse on import. YAML
  // double-quoted style accepts JSON escaping.
  return `---
name: ${name}
description: ${JSON.stringify(description)}
user-invocable: true
---

# ${name}

Write the instructions here. Say what you want done, not everything you know.

## When this runs

Replace the description above with the real trigger: what this does, then
"Use when <specific situation>."

## Steps

1.
2.
3.
`;
}

/** Seed fixture for a fresh scaffold.
 *
 *  The one case is trivially true (the body names the skill it is named for) so
 *  `skillet eval` on an untouched scaffold reads as "not wired up yet" rather
 *  than as a broken tool. The term is meant to be replaced with a load-bearing
 *  instruction once the body says something. */
function smokeJson(name: string): string {
  return (
    JSON.stringify(
      {
        version: 1,
        cases: [
          {
            id: "basic",
            prompt: `TODO: something a user would say that should fire ${name}`,
            expect_in_skill: [name],
          },
        ],
      },
      null,
      2,
    ) + "\n"
  );
}

/** `skillet create` — scaffold a new skill directory.
 *
 *  Deliberately does NOT import into the kit. An empty stub in the kit
 *  materializes into every agent on the next sync, so the skill enters the kit
 *  only once it says something (`skillet import ./<name>`).
 *
 *  The mined-from-your-own-work version of this needs a model, which the CLI
 *  does not have. That flow is the bundled `@skillet/create` playbook, reached
 *  with `/skillet create` inside an agent — printed below so the terminal is a
 *  door to it rather than a competing authoring flow. */
export function registerCreateCommand(program: Command): void {
  program
    .command("create [name]")
    .description("Start a new skill: scaffold SKILL.md and its eval")
    .option("--description <text>", "Seed the description (the field that decides when it loads)")
    .option("--dir <path>", "Where to create the directory (defaults to the current directory)")
    .action(
      async (
        name: string | undefined,
        opts: { description?: string; dir?: string },
      ) => {
        if (!name) {
          console.error(fail("Name the skill: `skillet create <name>`"));
          console.error(
            dim("  To build one from what you already do, run `/skillet create` in your agent."),
          );
          exitWith(ExitCode.USAGE);
          return;
        }
        if (!SLUG_RE.test(name)) {
          console.error(
            fail(`"${name}" is not a valid skill name. Use lowercase letters, numbers, and hyphens.`),
          );
          exitWith(ExitCode.USAGE);
          return;
        }

        const root = opts.dir ? resolve(opts.dir) : process.cwd();
        const dir = join(root, name);
        if (await pathExists(dir)) {
          console.error(fail(`${dir} already exists.`));
          exitWith(ExitCode.ERROR);
          return;
        }

        const description =
          opts.description?.trim() ||
          `TODO: what this does, then "Use when <specific situation>."`;

        try {
          await mkdir(join(dir, "evals"), { recursive: true });
          await writeFile(join(dir, "SKILL.md"), skillMd(name, description), "utf8");
          await writeFile(join(dir, "evals", "smoke.json"), smokeJson(name), "utf8");
        } catch (err) {
          console.error(fail(`Could not create ${dir}: ${(err as Error).message}`));
          exitWith(ExitCode.ERROR);
          return;
        }

        const rel = relative(process.cwd(), dir);
        const shown = rel && !rel.startsWith("..") && !isAbsolute(rel) ? `./${rel}` : dir;

        console.log(ok(`Created ${bold(shown)}`));
        console.log(dim(`  SKILL.md`));
        console.log(dim(`  evals/smoke.json`));
        console.log();

        // `skillet import` gates on pairing for every branch, so pointing an
        // unpaired user at it hands them a command that exits 3. Name the step
        // they can actually take instead.
        const paired = (await loadRegistryBearer()).kind !== "none";
        console.log("Edit SKILL.md, then:");
        if (paired) {
          console.log(
            `  ${cyan(`skillet import ${shown}`)}   ${dim("into your kit and your profile, private")}`,
          );
        } else {
          console.log(
            `  ${cyan("skillet connect <code>")}   ${dim("pair code from skillet.md/settings")}`,
          );
          console.log(
            `  ${cyan(`skillet import ${shown}`)}   ${dim("into your kit and your profile, private")}`,
          );
        }
        console.log(
          `  ${cyan(`skillet eval ${name}`)}   ${dim("checks the body covers what evals/smoke.json claims")}`,
        );
        console.log();
        console.log(
          dim("To build one from work you have already done, run /skillet create in your agent."),
        );
      },
    );
}
