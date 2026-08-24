/**
 * `skillet edits` — the ungated surface for customized skills (R5, R6, R8, R9,
 * R10). When you (or your agent) edit a synced skill, it becomes YOUR version:
 * the edit stays live, the author's updates are held, and you reconcile on
 * demand. ALWAYS registered, like `restore` — a customized skill must never
 * need SKILLET_LEGACY_CLI to be listed, diffed, or reconciled.
 *
 *   list           — your customized skills, flagging which have a held update
 *   diff <skill>   — your live version vs the current upstream
 *   take <skill>   — replace your edit with the author's version (backs yours up)
 *   restore <skill>— replace your edit with the current signed original
 *   keep <skill>   — acknowledge a held update so it stops nudging
 *   propose <skill>— send your edit upstream to the author
 *
 * Registry refusals on propose are honest outcomes, not dead-ends: 403 and 409
 * print friendly copy pointing at `skillet edits keep`, and NEITHER un-customizes
 * the skill — the edit stays live and private.
 */
import type { Command } from "commander";
import {
  listCustomized,
  listLiveEdits,
  takeUpstream,
  restoreOriginal,
  keepMine,
  proposeCustomized,
  setTccInvocation,
  lineageRef,
  readBundleFromSkillStore,
  readLiveCustomizedTree,
  ReconcileError,
  ProposeError,
  type CustomizedSkill,
  type ProposeCustomizedResult,
} from "@skillet/core";
import { toWireRef } from "@skillet/protocol/skill-id";
import { ExitCode, exitWith, type ExitCodeValue } from "../exit-codes.js";
import { resolveSyncAdapters } from "../adapter-tiers.js";
import { stripControlChars, formatScanFinding } from "../sanitize-output.js";

// ── ref resolution ────────────────────────────────────────────────────────────

/**
 * Canonicalize a ref to its wireRef (`@owner/slug`) for comparison, tolerating
 * all three input forms (`@a/b`, `a/b`, `a:b`) via the shared skill-id module —
 * so a user typing any of them resolves the same local entry (R2 crossing
 * consistency). Unparseable input (a local-only lineage's bare slug, or a
 * malformed arg) falls back to the raw string, preserving the old exact-match
 * behavior and letting a bad ref simply fail to match rather than throw.
 */
function canonicalRef(ref: string): string {
  try {
    return toWireRef(ref);
  } catch {
    return ref;
  }
}

/**
 * Pure ref → customized-skill match. Customized skills key on their original
 * `@author/slug` ref, so a match on the state key OR on `lineageRef(lineage)`
 * both resolve. Both sides are run through {@link canonicalRef} so the local
 * store's canonical key matches whichever of `@a/b` / `a/b` / `a:b` the user
 * typed. Exported for unit testing without a live edits store.
 */
export function findCustomizedByRef(
  all: CustomizedSkill[],
  ref: string,
): CustomizedSkill | null {
  const target = canonicalRef(ref);
  return (
    all.find(
      (c) =>
        canonicalRef(c.slug) === target ||
        canonicalRef(lineageRef(c.lineage)) === target,
    ) ?? null
  );
}

/**
 * Resolve a `<skill>` arg to its customized-skill entry against the live edits
 * store, tolerant of the input ref form.
 */
async function resolveCustomized(ref: string): Promise<CustomizedSkill | null> {
  return findCustomizedByRef(await listCustomized(), ref);
}

// ── diff rendering ──────────────────────────────────────────────────────────

export type FileStatus = "added" | "removed" | "changed" | "unchanged";

export interface FileDiff {
  path: string;
  status: FileStatus;
}

/** A structured hunk line for the --json diff (consumed by the desktop viewer). */
export type DiffHunkLine = { kind: "add" | "del" | "ctx"; text: string };

export interface FileDiffJson extends FileDiff {
  /** True when the file is binary/non-text — content can't be shown as lines. */
  binary?: boolean;
  /** Line-level hunk for a changed text file (yours vs upstream). */
  hunks?: DiffHunkLine[];
}

/**
 * Structured line diff (same trim logic as lineDiff, emitted as {kind,text}
 * objects) so the desktop viewer can render real changed lines, not just which
 * file changed. old = upstream (theirs), new = live (yours): a removed line is
 * theirs, an added line is yours.
 */
export function diffHunks(oldStr: string, newStr: string): DiffHunkLine[] {
  const a = oldStr.split("\n");
  const b = newStr.split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const out: DiffHunkLine[] = [];
  for (let i = Math.max(0, start - 2); i < start; i++) out.push({ kind: "ctx", text: a[i]! });
  for (let i = start; i < endA; i++) out.push({ kind: "del", text: a[i]! });
  for (let i = start; i < endB; i++) out.push({ kind: "add", text: b[i]! });
  for (let i = endB; i < Math.min(b.length, endB + 2); i++) out.push({ kind: "ctx", text: b[i]! });
  return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Per-file status of the live edit vs the upstream bundle. */
export function diffTrees(
  live: Map<string, Uint8Array>,
  upstream: Map<string, Uint8Array>,
): FileDiff[] {
  const paths = new Set([...live.keys(), ...upstream.keys()]);
  const out: FileDiff[] = [];
  for (const path of [...paths].sort()) {
    const l = live.get(path);
    const u = upstream.get(path);
    let status: FileStatus;
    if (l && !u) status = "added";
    else if (!l && u) status = "removed";
    else if (l && u && bytesEqual(l, u)) status = "unchanged";
    else status = "changed";
    out.push({ path, status });
  }
  return out;
}

export function isText(buf: Uint8Array): boolean {
  return !buf.includes(0);
}

/**
 * A compact line diff: common prefix/suffix trimmed, the divergent middle shown
 * as removed-then-added with two lines of surrounding context. Not a minimal
 * Myers diff — clear and dependency-free, which is all a reconcile view needs.
 */
export function lineDiff(oldStr: string, newStr: string): string[] {
  // Same trim logic as diffHunks, rendered as prefixed strings for the terminal.
  return diffHunks(oldStr, newStr).map((h) =>
    h.kind === "del" ? `  -${h.text}` : h.kind === "add" ? `  +${h.text}` : `   ${h.text}`,
  );
}

// ── list ──────────────────────────────────────────────────────────────────────

interface CustomizedRow {
  /** State key (the lineage ref the skill is customized from). */
  slug: string;
  /** `@author/slug` lineage ref. */
  ref: string;
  /** Always true — every row in this list is a customized skill (R9 honesty). */
  customized: true;
  /** A held author update is waiting AND has not been acknowledged. */
  hasUpdate: boolean;
  /** The baseline version the edit was made against. */
  version: number;
  /** The held update itself, when one exists. */
  held?: { version: number; hash: string };
}

function toRow(c: CustomizedSkill): CustomizedRow {
  return {
    slug: c.slug,
    ref: lineageRef(c.lineage),
    customized: true,
    hasUpdate: c.hasUpdate,
    version: c.lineage.version,
    ...(c.held ? { held: c.held } : {}),
  };
}

// ── outcome mapping (propose) ──────────────────────────────────────────────────

/** What a propose outcome writes and how it exits — pure, so it's unit-testable. */
export interface ProposeOutcomeOutput {
  stdout: string[];
  stderr: string[];
  exitCode: ExitCodeValue;
}

/**
 * Outcome → output mapping for `edits propose`. Each of the three outcomes is
 * EXCLUSIVE — exactly one message set, one exit code — via an exhaustive switch
 * on `status` so `not_authorized` can never fall through into `base_stale` (the
 * old inline branches let it, and only process.exit saved them). With `json`,
 * all three are outcome-as-data: one JSON object on stdout, exit 0, so machine
 * callers (the desktop) parse status instead of regexing stderr prose.
 */
export function renderProposeOutcome(
  result: ProposeCustomizedResult,
  ref: string,
  json: boolean,
): ProposeOutcomeOutput {
  switch (result.status) {
    case "proposed":
      if (json) {
        return {
          stdout: [
            JSON.stringify({ status: "proposed", proposal_id: result.proposalId }),
          ],
          stderr: [],
          exitCode: ExitCode.OK,
        };
      }
      return {
        stdout: [
          `✓ Proposal submitted for ${stripControlChars(result.ref)}`,
          `  proposal: ${result.proposalId}`,
          `  hash:     ${result.hash}`,
          `  url:      ${result.proposalUrl}`,
        ],
        stderr: [],
        exitCode: ExitCode.OK,
      };
    // 403/409 are honest refusals, not errors — and NEVER un-customize the
    // skill: your edit stays live and the keep hint still has something to act on.
    case "not_authorized":
      if (json) {
        return { stdout: [JSON.stringify({ status: "not_authorized" })], stderr: [], exitCode: ExitCode.OK };
      }
      return {
        stdout: [],
        stderr: [
          `✗ You're not on this skill's team. Keep your version with \`skillet edits keep ${ref}\``,
        ],
        exitCode: ExitCode.AUTH,
      };
    case "base_stale":
      if (json) {
        return { stdout: [JSON.stringify({ status: "base_stale" })], stderr: [], exitCode: ExitCode.OK };
      }
      return {
        stdout: [],
        stderr: [
          `✗ This skill has moved on upstream since your edit. Keep yours with \`skillet edits keep ${ref}\``,
        ],
        exitCode: ExitCode.CONFLICT,
      };
  }
}

// ── command registration ───────────────────────────────────────────────────────

async function runEditsList(opts: { json?: boolean }): Promise<void> {
  const skills = await listCustomized();
  if (opts.json === true) {
    process.stdout.write(
      JSON.stringify({ ok: true, customized: skills.map(toRow) }, null, 2) + "\n",
    );
    return;
  }
  if (skills.length === 0) {
    console.log("No customized skills. Every synced skill matches its author's version.");
    return;
  }
  console.log(
    "Your customized skills (`skillet edits diff|take|restore|keep|propose <skill>`):\n",
  );
  for (const c of skills) {
    const ref = stripControlChars(lineageRef(c.lineage));
    const state = c.hasUpdate ? "update available" : "up to date";
    console.log(`  ${ref}  · customized · ${state}`);
  }
}

export function registerEditsCommand(program: Command): void {
  const edits = program
    .command("edits")
    .description("Skills you customized: your live edits, with author updates held");

  // Bare `skillet edits` lists — same contract as `skillet pending`: the noun
  // alone shows you the things, subcommands act on them.
  edits.action(async () => {
    await runEditsList({});
  });

  edits
    .command("list")
    .description("List your customized skills and which have a held update")
    .option("--json", "Emit machine-readable output")
    .action(async (opts: { json?: boolean }) => {
      await runEditsList(opts);
    });

  // Read-only live-edit scan for the desktop tray: surfaces edits that a full
  // sync has not yet reconciled, WITHOUT touching state or disk. Machine-only
  // (always --json in practice); prints nothing reconcilable.
  edits
    .command("check")
    .description("Detect unreconciled local edits (read-only; for the desktop tray)")
    .option("--json", "Emit machine-readable output")
    .option(
      "--background",
      "Mark this run as an automatic background check. Agent folders that still need macOS folder access stay parked",
    )
    .action(async (opts: { json?: boolean; background?: boolean }) => {
      // TCC initiation (U3): tray-open runs are never a TTY, so without an
      // explicit signal they classify fail-closed as unattended and even a
      // GRANTED protected root stays parked. --background lets the tray read
      // under its earned marker. Deliberately no --user-initiated here: a
      // read-only scan never earns or records a grant. Without the flag,
      // non-TTY runs remain unattended (fail closed).
      if (opts.background === true) setTccInvocation({ initiation: "background" });
      const { adapters } = await resolveSyncAdapters(process.cwd());
      const live = await listLiveEdits(adapters);
      if (opts.json === true) {
        process.stdout.write(
          JSON.stringify(
            { ok: true, edited: live.map((e) => ({ slug: e.slug, where: e.where })) },
            null,
            2,
          ) + "\n",
        );
        return;
      }
      if (live.length === 0) {
        console.log("No unreconciled local edits.");
        return;
      }
      for (const e of live) {
        console.log(`  ${stripControlChars(e.slug)}  · edited locally (${e.where}, not yet synced)`);
      }
    });

  edits
    .command("diff <skill>")
    .description("Show your version against the author's current one")
    .option("--json", "Emit machine-readable output")
    .action(async (skill: string, opts: { json?: boolean }) => {
      const asJson = opts.json === true;
      const customized = await resolveCustomized(skill);
      if (!customized) {
        const msg = `No customized skill "${skill}". Run \`skillet edits list\`.`;
        if (asJson) {
          process.stdout.write(JSON.stringify({ ok: false, error: msg }, null, 2) + "\n");
        } else {
          console.error(`✗ ${msg}`);
        }
        exitWith(ExitCode.ERROR);
        return;
      }

      const owner = customized.entry.owner ?? null;
      const { adapters } = await resolveSyncAdapters(process.cwd());
      const live =
        (await readLiveCustomizedTree(customized.slug, owner, adapters)) ??
        new Map<string, Uint8Array>();
      let upstream: Map<string, Uint8Array>;
      try {
        upstream = await readBundleFromSkillStore(customized.slug);
      } catch {
        upstream = new Map<string, Uint8Array>();
      }
      const files = diffTrees(live, upstream);

      if (asJson) {
        // Enrich each changed file with line-level hunks (or a binary flag) so
        // the desktop viewer shows the actual changed lines, not just filenames.
        const filesJson: FileDiffJson[] = files.map((f) => {
          if (f.status !== "changed") return f;
          const l = live.get(f.path);
          const u = upstream.get(f.path);
          if (!l || !u) return f;
          if (!isText(l) || !isText(u)) return { ...f, binary: true };
          const dec = new TextDecoder();
          // Hunk text is skill-body content (attacker-controlled); strip before
          // JSON leaves the process so tray/desktop consumers stay safe too.
          return {
            ...f,
            hunks: diffHunks(dec.decode(u), dec.decode(l)).map((h) => ({
              ...h,
              text: stripControlChars(h.text),
            })),
          };
        });
        process.stdout.write(
          JSON.stringify(
            {
              ok: true,
              skill: lineageRef(customized.lineage),
              customized: true,
              hasUpdate: customized.hasUpdate,
              ...(customized.held ? { held: customized.held } : {}),
              files: filesJson,
            },
            null,
            2,
          ) + "\n",
        );
        return;
      }

      const ref = stripControlChars(lineageRef(customized.lineage));
      console.log(`Diff: your "${ref}" vs the author's current version (yours is -, theirs is +):\n`);
      const changed = files.filter((f) => f.status !== "unchanged");
      if (changed.length === 0) {
        console.log("  (identical: your version matches the upstream bytes)");
        return;
      }
      for (const f of changed) {
        console.log(`  ${f.status.padEnd(9)} ${stripControlChars(f.path)}`);
        const l = live.get(f.path);
        const u = upstream.get(f.path);
        if (f.status === "changed" && l && u && isText(l) && isText(u)) {
          const upstreamText = Buffer.from(u).toString("utf8");
          const liveText = Buffer.from(l).toString("utf8");
          for (const line of lineDiff(upstreamText, liveText)) {
            // Body lines are skill content; strip CSI/OSC/BEL like propose diffs.
            console.log(`  ${stripControlChars(line)}`);
          }
        }
      }
    });

  edits
    .command("take <skill>")
    .description("Replace your edit with the author's version (backs yours up first)")
    .action(async (skill: string) => {
      try {
        const customized = await resolveCustomized(skill);
        if (!customized) {
          console.error(`✗ No customized skill "${skill}". Run \`skillet edits list\`.`);
          exitWith(ExitCode.ERROR);
          return;
        }
        const { adapters } = await resolveSyncAdapters(process.cwd());
        const result = await takeUpstream(customized.slug, adapters);
        console.log(`✓ Took the author's version of "${stripControlChars(lineageRef(customized.lineage))}"`);
        if (result.materialized.length > 0) {
          console.log(`  applied ${result.materialized.length} file(s) to your agents`);
        }
        if (result.backupId) {
          console.log(`  your version was backed up (${result.backupId}), recoverable`);
        }
      } catch (err) {
        console.error(`✗ ${(err as Error).message}`);
        exitWith(err instanceof ReconcileError && err.code === "integrity_failed" ? ExitCode.CONFLICT : ExitCode.ERROR);
      }
    });

  edits
    .command("restore <skill>")
    .description("Replace your edit with the author's original (backs yours up first)")
    .action(async (skill: string) => {
      try {
        const customized = await resolveCustomized(skill);
        if (!customized) {
          console.error(`✗ No customized skill "${skill}". Run \`skillet edits list\`.`);
          exitWith(ExitCode.ERROR);
          return;
        }
        const { adapters } = await resolveSyncAdapters(process.cwd());
        const result = await restoreOriginal(customized.slug, adapters);
        console.log(`✓ Restored the original version of "${stripControlChars(lineageRef(customized.lineage))}"`);
        if (result.materialized.length > 0) {
          console.log(`  applied ${result.materialized.length} file(s) to your agents`);
        }
        if (result.backupId) {
          console.log(`  your version was backed up (${result.backupId}), recoverable`);
        }
      } catch (err) {
        console.error(`✗ ${(err as Error).message}`);
        exitWith(err instanceof ReconcileError && err.code === "integrity_failed" ? ExitCode.CONFLICT : ExitCode.ERROR);
      }
    });

  edits
    .command("keep <skill>")
    .description("Acknowledge a held update so it stops nudging until the next one")
    .action(async (skill: string) => {
      try {
        const customized = await resolveCustomized(skill);
        if (!customized) {
          console.error(`✗ No customized skill "${skill}". Run \`skillet edits list\`.`);
          exitWith(ExitCode.ERROR);
          return;
        }
        await keepMine(customized.slug);
        console.log(
          `✓ Keeping your version of "${stripControlChars(lineageRef(customized.lineage))}". It won't nag again until the author ships a newer update.`,
        );
      } catch (err) {
        console.error(`✗ ${(err as Error).message}`);
        exitWith(ExitCode.ERROR);
      }
    });

  edits
    .command("propose <skill>")
    .description("Propose your edit upstream to the skill's author")
    .option("--registry <url>", "Registry base URL (overrides identity default)")
    .option("--token <token>", "Bearer token (overrides SKILLET_TOKEN env var)")
    .option("--json", "Emit machine-readable output (proposed/not_authorized/base_stale exit 0)")
    .action(async (skill: string, opts: { registry?: string; token?: string; json?: boolean }) => {
      const asJson = opts.json === true;
      const customized = await resolveCustomized(skill);
      if (!customized) {
        const msg = `No customized skill "${skill}". Run \`skillet edits list\`.`;
        if (asJson) {
          process.stdout.write(JSON.stringify({ status: "error", message: msg }) + "\n");
        }
        console.error(`✗ ${msg}`);
        exitWith(ExitCode.ERROR);
        return;
      }
      const ref = lineageRef(customized.lineage);
      try {
        const { adapters } = await resolveSyncAdapters(process.cwd());
        const result = await proposeCustomized(customized.slug, adapters, {
          ...(opts.registry ? { registryUrl: opts.registry } : {}),
          ...(opts.token ? { token: opts.token } : {}),
        });
        const out = renderProposeOutcome(result, ref, asJson);
        for (const line of out.stdout) console.log(line);
        for (const line of out.stderr) console.error(line);
        if (out.exitCode !== ExitCode.OK) exitWith(out.exitCode);
        return;
      } catch (err) {
        // Real failures (network, not customized, unknown skill) stay
        // nonzero-exit with stderr prose; --json additionally puts the outcome
        // on stdout as data.
        if (asJson) {
          process.stdout.write(
            JSON.stringify({ status: "error", message: (err as Error).message }) + "\n",
          );
        }
        if (err instanceof ProposeError) {
          console.error(`✗ ${err.message}`);
          if (err.code === "scan_blocked") {
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
}
