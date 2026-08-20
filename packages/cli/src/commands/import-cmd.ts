import { readdir } from "node:fs/promises";
import { join } from "node:path";
import * as clack from "@clack/prompts";
import {
  importSkill,
  discoverGitHubSkills,
  importGitHubSkill,
  looksLikeGitHubSpec,
  discoverExistingSkills,
  importDiscoveredSkills,
  uploadLocalSkills,
  runtimePhrase,
  runtimesAcross,
  type DiscoveredGitHubSkill,
  type GitHubDiscovery,
  type DiscoveredSkill,
  type UploadProgressEvent,
} from "@skillet/core";
import { ok, fail, green, red, dim, bold } from "../cli-colors.js";
import type { Command } from "commander";
import { requirePaired } from "../auth-required.js";
import { ALL_ADAPTERS, collect, pathExists, REGISTRY_DEFAULT } from "../cli-context.js";
import { applyToAgents } from "../apply-to-agents.js";
import { configureAddPresent, printAddError, printStepInfo } from "../cli-add-present.js";
import { renderUploadProgress, summarizeUploadResult } from "./upload-present.js";
import { ExitCode, exitWith } from "../exit-codes.js";
import { printRenderedError } from "../render-error.js";
import { stripControlChars } from "../sanitize-output.js";

/** Options shared by every import branch that decide whether we also publish. */
interface UploadIntent {
  /** `--local`: import into the kit only, never publish to the account. */
  local?: boolean;
}

/**
 * Pick which discovered GitHub skills to import. `--all` and `--skill` bypass
 * the prompt entirely; a single discovered skill auto-selects. Only the
 * genuinely-ambiguous interactive case opens a readline picker, and a non-TTY
 * run with no selector is a clean error rather than a hang.
 */
export async function selectSkills(
  discovery: GitHubDiscovery,
  opts: { skill: string[]; all?: boolean; yes?: boolean },
): Promise<DiscoveredGitHubSkill[]> {
  const { skills } = discovery;
  // An explicit --skill filter outranks -y: -y promises "no prompting", and a
  // named pick already needs no prompt. Otherwise `add repo --skill x -y`
  // would take everything and trip add's single-install guard.
  if ((opts.all || opts.yes) && opts.skill.length === 0) return skills;

  if (opts.skill.length > 0) {
    const wanted = new Set(opts.skill.map((s) => s.toLowerCase()));
    const picked = skills.filter(
      (s) =>
        wanted.has(s.slug.toLowerCase()) || wanted.has(s.name.toLowerCase()),
    );
    const matchedKeys = new Set(
      picked.flatMap((s) => [s.slug.toLowerCase(), s.name.toLowerCase()]),
    );
    const missing = [...wanted].filter((w) => !matchedKeys.has(w));
    if (missing.length > 0) {
      throw new Error(
        `No skill named ${missing.map((m) => `"${m}"`).join(", ")} in ${discovery.owner}/${discovery.repo}. Available: ${skills.map((s) => s.slug).join(", ") || "(none)"}`,
      );
    }
    return picked;
  }

  if (skills.length === 1) return skills;

  if (!process.stdin.isTTY) {
    throw new Error(
      `${skills.length} skills found in ${discovery.owner}/${discovery.repo}. Re-run with --all or --skill <name> (non-interactive). Available: ${skills.map((s) => s.slug).join(", ")}`,
    );
  }

  const picked = await clack.multiselect({
    message: `Found ${skills.length} skills in ${discovery.owner}/${discovery.repo}@${discovery.ref}. Which to import?`,
    options: skills.map((s) => ({
      value: s.slug,
      // Repo-supplied text is a trust boundary: strip terminal escapes.
      label: stripControlChars(s.slug),
      hint: s.description || s.dir ? stripControlChars(s.description ?? s.dir ?? "") : undefined,
    })),
    required: false,
  });
  // Esc or empty: cancel quietly — a mistyped pick can never abort the run.
  if (clack.isCancel(picked) || !Array.isArray(picked) || picked.length === 0) return [];
  const wanted = new Set(picked as string[]);
  return skills.filter((s) => wanted.has(s.slug));
}

export async function runGitHubImport(
  source: string,
  opts: { ref?: string; skill: string[]; all?: boolean; yes?: boolean; force?: boolean; local?: boolean },
): Promise<void> {
  const discovery = await discoverGitHubSkills(
    source,
    opts.ref ? { ref: opts.ref } : {},
  );

  if (discovery.truncated) {
    console.log(
      "⚠  GitHub truncated the file listing for this repo. Some skills may be missing.",
    );
  }

  if (discovery.skills.length === 0) {
    console.log(
      `No SKILL.md bundles found in ${discovery.owner}/${discovery.repo}@${discovery.ref}.`,
    );
    return;
  }

  const chosen = await selectSkills(discovery, opts);
  if (chosen.length === 0) {
    console.log("Nothing selected. No skills imported.");
    return;
  }

  let failures = 0;
  const imported: string[] = [];
  for (const skill of chosen) {
    try {
      const entry = await importGitHubSkill(discovery, skill, { force: opts.force === true });
      imported.push(entry.slug);
      console.log(ok(stripControlChars(`Imported "${entry.name}" as ${entry.slug} (private to your kit)`)));
      console.log(`  hash: ${entry.hash}`);
    } catch (err) {
      failures++;
      console.error(fail(`${skill.slug}: ${(err as Error).message}`));
    }
  }
  console.log(
    `\nImported ${chosen.length - failures}/${chosen.length} skill(s) from ${discovery.owner}/${discovery.repo}.`,
  );
  await applyImported(imported);
  await uploadImported(imported, { local: opts.local === true });
  if (failures > 0) exitWith(ExitCode.ERROR);
}

/**
 * Ask a yes/no question on the terminal. Default is No; Esc cancels (also
 * No — callers treat this as "don't act", never as a recorded opt-out).
 * Non-TTY returns false, preserving the headless deny-by-default contract.
 */
export async function confirm(question: string): Promise<boolean> {
  if (process.stdout.isTTY !== true) return false;
  const answer = await clack.confirm({ message: question, initialValue: false });
  return !clack.isCancel(answer) && answer === true;
}

/**
 * A scannable list of what we'd import: grouped by where each skill runs, names
 * only. The full descriptions (often a paragraph each) are noise at the
 * import-decision moment — the user is choosing whether to bring skills they
 * already run into their kit, not reading the catalog. Names wrap into short
 * lines so a big list stays compact instead of scrolling off-screen.
 */
function renderDiscoveredGroups(skills: DiscoveredSkill[]): string {
  // Group by the combined runtime phrase (e.g. "Universal", "Claude Code",
  // "Universal + Claude Code"), preserving first-seen order.
  const groups = new Map<string, string[]>();
  for (const s of skills) {
    const where = runtimePhrase(s.runtimes);
    const names = groups.get(where) ?? [];
    names.push(s.name);
    groups.set(where, names);
  }

  const WIDTH = 64;
  const lines: string[] = [];
  for (const [where, names] of groups) {
    if (lines.length > 0) lines.push("");
    lines.push(`  ${bold(where)}`);
    let row = "";
    for (const name of names) {
      const next = row ? `${row}  ${name}` : name;
      if (row && next.length > WIDTH) {
        lines.push(`    ${row}`);
        row = name;
      } else {
        row = next;
      }
    }
    if (row) lines.push(`    ${row}`);
  }
  return lines.join("\n");
}

/**
 * Scan installed runtimes for skills the user already runs and offer to import.
 * Reuses the local-import path; interactive imports also back up to the account
 * as private (skip with `--local`).
 */
export async function runDiscovery(opts: { assumeYes: boolean; local?: boolean }): Promise<void> {
  const report = await discoverExistingSkills(ALL_ADAPTERS);

  if (report.scannedRuntimes.length === 0) {
    console.log(
      "No supported agents detected yet. Install Claude Code or Codex, or import a skill directly with `skillet import <path>`.",
    );
    return;
  }

  const scannedPhrase = runtimePhrase(report.scannedRuntimes);
  const skippedSkillet = report.skills.filter((s) => s.fromSkillet && !s.alreadyInKit).length;

  if (report.newSkills.length === 0) {
    if (report.skills.length > 0) {
      if (skippedSkillet > 0 && report.skills.every((s) => s.fromSkillet || s.alreadyInKit)) {
        const parts: string[] = [];
        const inKit = report.skills.filter((s) => s.alreadyInKit).length;
        if (inKit > 0) parts.push(`${inKit} already in your kit`);
        if (skippedSkillet > 0) parts.push(`${skippedSkillet} already synced from Skillet`);
        console.log(ok(`You're all set: ${parts.join(", ")} across ${scannedPhrase}.`));
      } else {
        console.log(
          ok(`You're all set: all ${report.skills.length} skill(s) across ${scannedPhrase} are already in your kit.`),
        );
      }
    } else {
      console.log(
        `No existing skills found in ${scannedPhrase}. Import one with \`skillet import <path>\` whenever you're ready.`,
      );
    }
    return;
  }

  const where = runtimePhrase(runtimesAcross(report.newSkills));
  const n = report.newSkills.length;
  if (skippedSkillet > 0) {
    console.log(
      `  (${skippedSkillet} skill${skippedSkillet === 1 ? "" : "s"} already synced from Skillet, skipping)`,
    );
  }
  console.log(
    `\nWe found ${n} skill${n === 1 ? "" : "s"} you already run across ${where}.\n`,
  );
  console.log(renderDiscoveredGroups(report.newSkills));

  // Pick which to import. Headless (`-y` or non-TTY — how the desktop's
  // background scan runs) takes all with no prompt and stays local, since
  // uploadImported no-ops off a TTY. Interactive opens a checkbox list with
  // everything pre-checked: "import all" is one Enter, narrowing is a few
  // spacebars.
  let selected: DiscoveredSkill[];
  if (opts.assumeYes) {
    selected = report.newSkills;
  } else if (process.stdin.isTTY !== true) {
    console.log(
      "\nNon-interactive terminal, skipping import. Re-run with `skillet import --yes` to import all, or `skillet import <path>` for one.",
    );
    return;
  } else {
    console.log(
      opts.local === true
        ? "\nSelected skills go into your kit only."
        : "\nSelected skills go into your kit and are backed up to your account, private.",
    );
    const picked = await clack.multiselect({
      message: "Which skills should we import?",
      options: report.newSkills.map((s, i) => ({
        value: String(i),
        label: stripControlChars(s.name),
        hint: stripControlChars(runtimePhrase(s.runtimes)),
      })),
      initialValues: report.newSkills.map((_, i) => String(i)),
      required: false,
    });
    if (clack.isCancel(picked) || !Array.isArray(picked) || picked.length === 0) {
      console.log("\nNothing selected. No skills imported.");
      return;
    }
    const wanted = new Set(picked as string[]);
    selected = report.newSkills.filter((_, i) => wanted.has(String(i)));
  }

  const result = await importDiscoveredSkills(selected);
  console.log("");
  for (const e of result.imported) {
    console.log(`  ${green("✓")} Imported "${e.name}" as ${e.slug}`);
  }
  for (const f of result.failed) {
    console.log(`  ${red("✗")} ${f.name}: ${f.error}`);
  }
  console.log(`\nImported ${result.imported.length} skill(s) into your kit.`);
  const importedSlugs = result.imported.map((e) => e.slug);
  await applyImported(importedSlugs);
  await uploadImported(importedSlugs, { local: opts.local === true });
  if (result.failed.length > 0) exitWith(ExitCode.ERROR);
}

/**
 * Imports finish their own job (no "now run skillet sync" homework): put the
 * just-imported skills into the agents on this machine with a scoped apply.
 * Quiet on skips; quarantined entries keep their gate (non-TTY: skip+reason).
 */
async function applyImported(slugs: string[]): Promise<void> {
  if (slugs.length === 0) return;
  try {
    const result = await applyToAgents(slugs, { skipPull: true });
    const agents = result.adapters.filter((a) => a.status === "materialized").length;
    console.log(dim(`  In your agents now (${agents} on this machine).`));
  } catch (err) {
    // The import itself succeeded — never let this read as "Import failed".
    printRenderedError(err as Error, (what) =>
      fail(`Imported, but couldn't put it into your agents: ${what}`),
    );
    console.error(dim("  Run `skillet sync` to retry."));
    exitWith(ExitCode.ERROR);
  }
}

/**
 * Publish the just-imported skills to the user's account as private, so they
 * sync to their other machines. Runs only in an interactive terminal: a
 * headless `import -y` (how the desktop's background scan invokes import) stays
 * local — the desktop publishes through its own "back up" action. `--local`
 * opts out entirely. Non-fatal: the import already landed in the kit, so a
 * publish failure is a warning with a retry hint, never "Import failed".
 */
async function uploadImported(slugs: string[], opts: UploadIntent): Promise<void> {
  if (opts.local === true) return;
  if (process.stdout.isTTY !== true) return;
  if (slugs.length === 0) return;

  configureAddPresent({ json: false, color: true });
  try {
    const result = await uploadLocalSkills({
      slugs,
      visibility: "private",
      registryUrl: REGISTRY_DEFAULT,
      sessionAuth: true,
      onProgress: (event: UploadProgressEvent) => {
        if (event.phase === "start" && event.index === 0) {
          printStepInfo(
            `Publishing ${event.total} skill${event.total === 1 ? "" : "s"} to your account (private)`,
          );
        }
        renderUploadProgress(event);
      },
    });
    if (result.empty) return;
    if (result.ok) {
      console.log(summarizeUploadResult(result, "private"));
    } else {
      printAddError("Some skills didn't publish. Retry with `skillet upload --all`.");
    }
  } catch (err) {
    printAddError(
      `Imported to your kit, but publishing to your account failed: ${(err as Error).message}`,
    );
    console.error(
      dim("  They're private on this machine. Retry with `skillet upload --all`."),
    );
  }
}

/**
 * Pick skill directories inside a local folder (immediate subdirectories with
 * a SKILL.md). Same selection contract as GitHub imports: --skill filters,
 * --all / -y take everything, a lone find auto-selects, non-TTY with no
 * selector errors cleanly, and only the ambiguous TTY case opens the picker.
 */
async function pickFolderSkillDirs(
  root: string,
  opts: { skill: string[]; all?: boolean; yes?: boolean },
): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const found: { name: string; dir: string }[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = join(root, e.name);
    if (await pathExists(join(dir, "SKILL.md"))) found.push({ name: e.name, dir });
  }
  if (found.length === 0) {
    throw new Error(
      `No skills in "${root}". Point at a skill directory (SKILL.md at its root) or a folder of skill directories.`,
    );
  }
  if (opts.skill.length > 0) {
    const wanted = new Set(opts.skill.map((s) => s.toLowerCase()));
    const picked = found.filter((f) => wanted.has(f.name.toLowerCase()));
    const matched = new Set(picked.map((f) => f.name.toLowerCase()));
    const missing = [...wanted].filter((w) => !matched.has(w));
    if (missing.length > 0) {
      throw new Error(
        `No skill named ${missing.map((m) => `"${m}"`).join(", ")} in ${root}. Available: ${found.map((f) => f.name).join(", ")}`,
      );
    }
    return picked.map((f) => f.dir);
  }
  if (opts.all || opts.yes) return found.map((f) => f.dir);
  if (found.length === 1) return [found[0]!.dir];
  if (!process.stdin.isTTY) {
    throw new Error(
      `${found.length} skills found in ${root}. Re-run with --all or --skill <name> (non-interactive). Available: ${found.map((f) => f.name).join(", ")}`,
    );
  }
  const picked = await clack.multiselect({
    message: `Import which skills from ${root}?`,
    options: found.map((f) => ({ value: f.dir, label: f.name })),
    required: true,
  });
  if (clack.isCancel(picked)) {
    exitWith(ExitCode.ERROR);
  }
  return picked as string[];
}

export function registerImportCommand(program: Command): void {
  program
    .command("import [source]")
    .description("Bring skills you already have (in your agents or a folder) into your kit")
    .option("-y, --yes", "Import every discovered skill without prompting")
    .option("--ref <ref>", "GitHub branch, tag, or commit to import from")
    .option(
      "--skill <name>",
      "Import only the named skill(s) from a repo; repeatable. Skips the picker.",
      collect,
      [] as string[],
    )
    .option("--all", "Import every skill found in the repo; skips the picker")
    .option("--force", "Overwrite an existing kit skill when the slug collides")
    .option("--local", "Import into your kit only; don't back up to your account")
    .action(
      async (
        source: string | undefined,
        opts: {
          yes?: boolean;
          ref?: string;
          skill: string[];
          all?: boolean;
          force?: boolean;
          local?: boolean;
        },
      ) => {
        // Pairing gate for every import branch (local path, GitHub, runtime
        // discovery): an unpaired machine never scans, prompts, or writes to
        // the kit. Core's importSkill/discoverExistingSkills stay auth-free
        // (KTD3); the gate lives here at the command layer. `import` has no
        // --json mode, so the desktop's `import -y` gets stderr + exit 3.
        await requirePaired();

        if (!source) {
          await runDiscovery({ assumeYes: opts.yes === true, local: opts.local === true });
          return;
        }
        try {
          if (await pathExists(source)) {
            // A dir with SKILL.md at its root is one skill; otherwise treat it
            // as a folder of skills and import the subdirectories that carry
            // a SKILL.md (the "or a folder" in this command's description).
            const dirs = (await pathExists(join(source, "SKILL.md")))
              ? [source]
              : await pickFolderSkillDirs(source, opts);
            const slugs: string[] = [];
            for (const dir of dirs) {
              const entry = await importSkill(dir, { force: opts.force === true });
              console.log(ok(`Imported "${entry.name}" as ${entry.slug}`));
              console.log(`  hash: ${entry.hash}`);
              slugs.push(entry.slug);
            }
            await applyImported(slugs);
            await uploadImported(slugs, { local: opts.local === true });
            return;
          }
          if (looksLikeGitHubSpec(source)) {
            await runGitHubImport(source, opts);
            return;
          }
          await importSkill(source, { force: opts.force === true });
        } catch (err) {
          console.error(fail(`Import failed: ${(err as Error).message}`));
          exitWith(ExitCode.ERROR);
        }
      },
    );
}
