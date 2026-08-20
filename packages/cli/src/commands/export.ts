import type { Command } from "commander";
import { writeFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import {
  readState,
  readBundleFromSkillStore,
  bundleToZip,
  bundlesToZip,
  bundleSlugDir,
  frontmatterCompatWarnings,
  skillStoreMatchesExpectedHash,
} from "@skillet/core";

type State = Awaited<ReturnType<typeof readState>>;
type SkillEntry = State["skills"][string];

/** Accept `@owner/slug`, `owner/slug`, or a bare `slug`; the local store is keyed by slug. */
function resolveSlug(ref: string): string {
  let s = ref.trim();
  if (s.startsWith("@")) s = s.slice(1);
  if (s.includes("/")) s = s.split("/").pop() ?? s;
  return s;
}

const stripAt = (s: string): string => (s.startsWith("@") ? s.slice(1) : s);

/** Bare kit name (last path segment, no `@`) — used for filenames. */
function kitNameOf(sourceKit: string | null | undefined): string | null {
  if (!sourceKit) return null;
  const bare = stripAt(sourceKit);
  return bare.includes("/") ? (bare.split("/").pop() ?? bare) : bare;
}

/**
 * Match a skill's `sourceKit` (`@owner/kitname`) against the user's `--kit`
 * input. An owner-qualified input (`@owner/kit` or `owner/kit`) matches exactly;
 * a bare name matches the kit name only. `sourceKit` is display-only and can
 * collide across owners (see SkillEntry), so a bare name may match two kits from
 * different owners — qualify with the owner to disambiguate.
 */
function kitMatches(sourceKit: string | null | undefined, input: string): boolean {
  if (!sourceKit) return false;
  const sk = stripAt(sourceKit);
  const want = stripAt(input.trim());
  if (want.includes("/")) return sk === want;
  const bare = sk.includes("/") ? (sk.split("/").pop() ?? sk) : sk;
  return bare === want;
}

function warnFrontmatter(entry: SkillEntry, extras: string[]): void {
  if (extras.length === 0) return;
  process.stderr.write(
    `warning: ${entry.slug} has SKILL.md frontmatter beyond name/description (${extras.join(
      ", ",
    )}). Codex and ChatGPT Skills ignore extra fields. Trim them for a clean import.\n`,
  );
}

/**
 * A safe `.zip` base name. Slugs/kit names are `[a-z0-9-]` at the registry, but
 * the export sink trusts local state — sanitize here too so a poisoned
 * `state.json` (or a hostile registry response) can't turn `<base>.zip` into a
 * path traversal when joined onto cwd.
 */
function safeFileBase(name: string): string {
  return name.replace(/[^a-z0-9-]/gi, "") || "skill";
}

function emit(zip: Uint8Array, fileName: string, toStdout: boolean): void {
  const buf = Buffer.from(zip);
  if (toStdout) {
    try {
      process.stdout.write(buf);
    } catch (err) {
      // EPIPE when the consumer (e.g. `head`) closed the pipe early.
      process.stderr.write(`Failed to write to stdout: ${(err as Error).message}\n`);
      process.exitCode = 1;
    }
    return;
  }
  const dest = resolve(process.cwd(), fileName);
  try {
    writeFileSync(dest, buf);
  } catch (err) {
    // Don't leave a truncated zip behind on ENOSPC/EACCES.
    try {
      unlinkSync(dest);
    } catch {
      /* best effort */
    }
    process.stderr.write(`Failed to write ${dest}: ${(err as Error).message}\n`);
    process.exitCode = 1;
    return;
  }
  process.stderr.write(`Wrote ${dest} (${zip.byteLength} bytes)\n`);
}

export function registerExportCommand(program: Command): void {
  program
    .command("export [ref]")
    .description(
      "Export a skill or kit as a .zip for anywhere Skillet cannot sync",
    )
    .option("--kit <name>", "Export every skill in a kit as one archive")
    .option("--stdout", "Write the zip to stdout instead of a file")
    .action(
      async (
        ref: string | undefined,
        opts: { kit?: string; stdout?: boolean },
      ) => {
        const state = await readState();
        const toStdout = opts.stdout === true;

        if (opts.kit) {
          const inKit = Object.values(state.skills).filter((e) =>
            kitMatches(e.sourceKit, opts.kit!),
          );
          if (inKit.length === 0) {
            process.stderr.write(
              `No kit "${opts.kit}" found in your installed skills. Run \`skillet list\` to see your kits.\n`,
            );
            process.exitCode = 1;
            return;
          }
          // Filename from the bare kit name of the first match (sanitized),
          // since the user's input may be owner-qualified (`@owner/kit`).
          const fileBase = safeFileBase(kitNameOf(inKit[0]?.sourceKit) ?? resolveSlug(opts.kit));
          const entries: Array<{ prefix: string; bundle: Awaited<ReturnType<typeof readBundleFromSkillStore>> }> = [];
          for (const entry of inKit) {
            if (entry.scan?.status === "quarantined") {
              process.stderr.write(
                `Skipping ${entry.slug}: quarantined by harm scan, not exported.\n`,
              );
              continue;
            }
            let bundle: Awaited<ReturnType<typeof readBundleFromSkillStore>>;
            try {
              bundle = await readBundleFromSkillStore(entry.slug);
            } catch (err) {
              // Store drift (bytes pruned out-of-band, corrupt SKILL.md) — skip
              // the broken skill, flag failure, keep exporting the rest.
              process.stderr.write(`Skipping ${entry.slug}: ${(err as Error).message}\n`);
              process.exitCode = 1;
              continue;
            }
            // Readable but tampered counts as drift too: never ship bytes that
            // no longer match the recorded content hash (sync refuses the same).
            if (entry.hash && !(await skillStoreMatchesExpectedHash(entry.slug, entry.hash))) {
              process.stderr.write(
                `Skipping ${entry.slug}: store content drifted from the recorded hash. Re-add or re-sync it.\n`,
              );
              process.exitCode = 1;
              continue;
            }
            warnFrontmatter(entry, frontmatterCompatWarnings(bundle));
            entries.push({
              prefix: bundleSlugDir(entry.slug, entry.owner ?? null),
              bundle,
            });
          }
          if (entries.length === 0) {
            process.stderr.write(
              `Nothing to export in kit "${opts.kit}". Every skill was quarantined or unreadable.\n`,
            );
            process.exitCode = 1;
            return;
          }
          emit(bundlesToZip(entries), `${fileBase}.zip`, toStdout);
          return;
        }

        if (!ref) {
          process.stderr.write(
            "Usage: skillet export <@owner/slug> [--stdout]  |  skillet export --kit <name>\n",
          );
          process.exitCode = 1;
          return;
        }

        const slug = resolveSlug(ref);
        const entry = state.skills[slug];
        if (!entry) {
          process.stderr.write(
            `No skill "${ref}" in your kit. Run \`skillet list\` to see installed skills.\n`,
          );
          process.exitCode = 1;
          return;
        }
        if (entry.scan?.status === "quarantined") {
          process.stderr.write(
            `Refusing to export ${entry.slug}: quarantined by harm scan. Resolve it first or re-sync a clean version.\n`,
          );
          process.exitCode = 1;
          return;
        }

        let bundle: Awaited<ReturnType<typeof readBundleFromSkillStore>>;
        try {
          bundle = await readBundleFromSkillStore(entry.slug);
        } catch (err) {
          // Store drift (bytes pruned, corrupt SKILL.md) — fail cleanly rather
          // than crashing with an unhandled rejection + stack trace.
          process.stderr.write(`Cannot export ${entry.slug}: ${(err as Error).message}\n`);
          process.exitCode = 1;
          return;
        }
        if (entry.hash && !(await skillStoreMatchesExpectedHash(entry.slug, entry.hash))) {
          process.stderr.write(
            `Cannot export ${entry.slug}: store content drifted from the recorded hash. Re-add or re-sync it.\n`,
          );
          process.exitCode = 1;
          return;
        }
        warnFrontmatter(entry, frontmatterCompatWarnings(bundle));
        emit(bundleToZip(bundle), `${safeFileBase(entry.slug)}.zip`, toStdout);
      },
    );
}
