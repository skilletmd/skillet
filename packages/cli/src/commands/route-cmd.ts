import type { Command } from "commander";
import { stdin } from "node:process";
import {
  flushEvents,
  listRouteManifest,
  recordRouteInvocation,
  recordSkillRoute,
  resolveRouteBody,
  RouteSkillError,
  searchPublicSkills,
  summonHandle,
  canInjectContext,
} from "@skillet/core";
import { routeInstructions, RESPONSE_ENVELOPE_RESERVE } from "../route-instructions.js";
import { bold, cyan, dim, green } from "../cli-colors.js";
import { webBaseUrl } from "../cli-command-tier.js";
import { ExitCode } from "../exit-codes.js";

const PHASE_SEARCHING = "Searching";
const PHASE_PICKED = "Picked";
const PHASE_USING = "Using";

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    stdin.setEncoding("utf8");
    stdin.on("data", (chunk: string) => {
      body += chunk;
    });
    stdin.on("end", () => resolve(body));
    stdin.on("error", () => resolve(""));
  });
}

function objectValues(value: unknown): unknown[] {
  if (!value || typeof value !== "object") return [];
  return Object.values(value as Record<string, unknown>);
}

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
    return out;
  }
  for (const item of objectValues(value)) collectStrings(item, out);
  return out;
}

/** The `/skillet ...` line in a hook payload, or null when there isn't one. */
function skilletInvocation(raw: string): string | null {
  if (!raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    for (const text of collectStrings(parsed)) {
      const trimmed = text.trimStart();
      if (trimmed.startsWith("/skillet")) return trimmed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Whether pre-injecting the local kit would be wasted on this invocation.
 *
 * A handle summons someone else's kit and a `create` invocation loads the
 * authoring playbook: neither reads the local manifest, so injecting it would
 * spend context on a list the agent will not look at.
 */
function skipsLocalKit(invocation: string): boolean {
  const first = invocation.replace(/^\/skillet\b/, "").trim().split(/\s+/)[0] ?? "";
  if (!first) return false;
  // Only the unambiguous cases. A bare first word may be a handle or the first
  // word of a task ("prep an RPG session"), and the router resolves that by
  // judgment, not by a rule the hook can reproduce. Guessing wrong in this
  // direction costs a turn on an ordinary route, which is the exact thing
  // injection exists to save; guessing wrong the other way costs some context
  // on a summon. Take the cheaper error.
  return first === "create" || first.startsWith("@");
}

function printPhases(skillRef: string, opts: { json?: boolean }): void {
  const phases = [PHASE_SEARCHING, PHASE_PICKED, PHASE_USING];
  if (opts.json) {
    process.stdout.write(
      JSON.stringify({ ok: true, skillRef, phases }) + "\n",
    );
    return;
  }
  if (process.stdout.isTTY) {
    console.log(dim(`  ${PHASE_SEARCHING}… kit skills`));
    console.log(cyan(`  ${PHASE_PICKED}  ${skillRef}`));
    console.log(green(`  ${PHASE_USING}  ${skillRef}`));
    return;
  }
  console.log(`${PHASE_SEARCHING}`);
  console.log(`${PHASE_PICKED} ${skillRef}`);
  console.log(`${PHASE_USING} ${skillRef}`);
}

function emptyKitMessage(): string {
  return (
    `No skills in your kit. Run \`skillet sync\`, \`skillet add @author/skill\`, ` +
    `or add skills on ${webBaseUrl()}.`
  );
}

export function registerRouteCommand(program: Command): void {
  const route = program
    .command("route")
    .description("The /skillet router: picks the right skill for a task");

  route
    .command("manifest")
    .description("List kit skills for agent routing (metadata only, no SKILL.md bodies)")
    .option("--json", "Emit machine-readable manifest")
    .action(async (opts: { json?: boolean }) => {
      const skills = await listRouteManifest();
      if (skills.length === 0) {
        if (opts.json) {
          process.stdout.write(JSON.stringify({ skills: [], error: "kit_empty" }) + "\n");
        } else {
          console.error(emptyKitMessage());
        }
        process.exitCode = ExitCode.ERROR;
        return;
      }

      if (opts.json) {
        process.stdout.write(JSON.stringify({ skills }) + "\n");
        return;
      }

      const refWidth = Math.max(
        8,
        ...skills.map((s) => s.skillRef.length),
      );
      console.log(bold(`${"REF".padEnd(refWidth)}  NAME`));
      for (const s of skills) {
        console.log(`${s.skillRef.padEnd(refWidth)}  ${s.name}`);
      }
    });

  route
    .command("begin")
    .description("Record a /skillet invocation (metadata only)")
    .option("--runtime <runtime>", "Agent name, e.g. cursor")
    .option("--source <source>", "Recorder source, e.g. cursor-hook")
    .option("--surface <surface>", "Invocation surface, e.g. user-prompt-submit")
    .option("--json", "Emit machine-readable result")
    .action(
      async (opts: {
        runtime?: string;
        source?: string;
        surface?: string;
        json?: boolean;
      }) => {
        const result = recordRouteInvocation({
          runtime: opts.runtime,
          source: opts.source,
          surface: opts.surface,
        });
        await flushEvents();
        if (opts.json) {
          process.stdout.write(JSON.stringify({ ok: true, ...result }) + "\n");
        }
      },
    );

  route
    .command("hook")
    .description("Agent hook entrypoint for /skillet")
    .option("--runtime <runtime>", "Agent name, e.g. cursor, claude-code, codex")
    .action(async (opts: { runtime?: string }) => {
      // The hook detects a /skillet prompt but does NOT record it. The use verb
      // is the single recorder: it fires on every runtime and on every path,
      // while this hook exists on three, so recording in both places counted
      // one invocation twice on exactly the runtimes that have a hook.
      const raw = await readStdin();
      const invocation = skilletInvocation(raw);
      if (!invocation) return;

      // Pre-injection is the whole turn saving: the agent gets candidates
      // before its first turn and can skip the start verb entirely. Only where
      // the runtime can actually add to the prompt, and only where the local
      // kit is what this invocation will route against.
      const runtime = opts.runtime?.trim() ?? "";
      if (!canInjectContext(runtime) || skipsLocalKit(invocation)) return;

      const skills = await listRouteManifest();
      if (skills.length === 0) return;
      const candidates = skills.map((s) => ({ ref: s.skillRef, description: s.description }));
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "UserPromptSubmit",
            additionalContext: [
              "Skillet kit candidates for this /skillet invocation:",
              JSON.stringify({ candidates }),
              routeInstructions("pick"),
            ].join("\n\n"),
          },
        }) + "\n",
      );
    });

  // ── The stub's three verbs ────────────────────────────────────────────────
  // Each returns its data AND the instruction block for that path, so the
  // router skill body stays a stub. Moving those instructions into a
  // `references/` file instead would save the same tokens and cost a turn to
  // read them — and turns, not tokens, are what makes /skillet feel slow.

  route
    .command("start")
    .description("Begin a local-kit route: candidates plus the rules for picking one")
    .action(async () => {
      const skills = await listRouteManifest();
      if (skills.length === 0) {
        process.stdout.write(
          JSON.stringify({ ok: false, error: "kit_empty", message: emptyKitMessage() }) + "\n",
        );
        process.exitCode = ExitCode.ERROR;
        return;
      }
      // Only what picking needs. `path`, `slug`, and `owner` are all derivable
      // from `ref`, and the use verb resolves the path itself, so carrying them
      // spends context on fields the agent never reads while choosing.
      const candidates = skills.map((s) => ({ ref: s.skillRef, description: s.description }));
      process.stdout.write(
        JSON.stringify({
          ok: true,
          candidates,
          instructions: routeInstructions("pick"),
        }) + "\n",
      );
    });

  route
    .command("summon <handle>")
    .description("Route against a handle's public kit, fetched live. No install, no account")
    .action(async (handle: string) => {
      const result = await summonHandle(handle);
      if (result.kind === "unreachable") {
        process.stdout.write(
          JSON.stringify({
            ok: false,
            error: "registry_unreachable",
            handle: result.handle,
            message: result.reason,
          }) + "\n",
        );
        process.exitCode = ExitCode.ERROR;
        return;
      }
      if (result.kind === "no-kit") {
        // Not an error. A handle with nothing public is a normal answer, and
        // the instructions tell the agent to look across authors rather than
        // stop, so this still carries them.
        process.stdout.write(
          JSON.stringify({
            ok: true,
            handle: result.handle,
            candidates: [],
            instructions: routeInstructions("summon"),
          }) + "\n",
        );
        return;
      }
      process.stdout.write(
        JSON.stringify({
          ok: true,
          handle: result.handle,
          candidates: result.candidates.map((c) => ({
            ref: c.ref,
            description: c.description,
            hash: c.latestHash,
            via: c.via,
          })),
          instructions: routeInstructions("summon"),
        }) + "\n",
      );
    });

  route
    .command("search <keyword...>")
    .description("Search every author's public skills, for the summon fall-through")
    .action(async (keywords: string[]) => {
      const results = await searchPublicSkills(keywords);
      process.stdout.write(
        JSON.stringify({
          ok: true,
          keywords,
          results: results.map((c) => ({
            ref: c.ref,
            description: c.description,
            hash: c.latestHash,
          })),
        }) + "\n",
      );
    });

  route
    .command("use <skill-ref>")
    .description("Load a picked skill and record the route")
    .option("--runtime <runtime>", "Agent name, e.g. cursor, claude-code, codex")
    .option("--hash <hash>", "Summon candidate version; loads from the registry when not local")
    .option("--via <handle>", "The handle that surfaced this skill, when not its author")
    .action(async (skillRef: string, opts: { runtime?: string; hash?: string; via?: string }) => {
      const instructions = routeInstructions("apply");
      const resolved = await resolveRouteBody(skillRef, {
        reserveBytes: Buffer.byteLength(instructions, "utf8") + RESPONSE_ENVELOPE_RESERVE,
        ...(opts.hash
          ? { summon: { hash: opts.hash, via: opts.via ?? null, runtime: opts.runtime ?? null } }
          : {}),
      });
      if (!resolved) {
        process.stdout.write(
          JSON.stringify({
            ok: false,
            error: "skill_not_in_kit",
            message: `No skill on this machine for ${skillRef}.`,
          }) + "\n",
        );
        process.exitCode = ExitCode.ERROR;
        return;
      }

      // The single recorder. This verb is the one call EVERY path makes, so it
      // still fires when a prompt hook pre-injects candidates and the agent
      // skips `start` entirely — recording on `start` would zero the event on
      // exactly the runtimes that got faster.
      recordRouteInvocation({
        runtime: opts.runtime,
        source: "route-verb",
        surface: "route-verb",
      });
      // The pick, too: recordSkillRoute is the only writer of local route
      // history, and that history is what ranks candidates by usage. With no
      // caller, ordering silently decays to alphabetical.
      try {
        await recordSkillRoute(resolved.ref, { runtime: opts.runtime });
      } catch (err) {
        if (!(err instanceof RouteSkillError)) throw err;
        // A store skill with no kit-state entry cannot be recorded yet; routing
        // to it still works, so this must not fail the load.
      }
      await flushEvents();

      process.stdout.write(
        JSON.stringify({
          ok: true,
          ref: resolved.ref,
          path: resolved.path,
          body: resolved.body,
          instructions,
        }) + "\n",
      );
    });

  route
    .command("record <skill-ref>")
    .description("Record a routed skill pick")
    .option("--runtime <runtime>", "Agent name, e.g. cursor, claude-code, codex")
    .option("--json", "Emit machine-readable result")
    .action(
      async (skillRef: string, opts: { runtime?: string; json?: boolean }) => {
        try {
          const result = await recordSkillRoute(skillRef, { runtime: opts.runtime });
          printPhases(result.skillRef, { json: opts.json });
        } catch (err) {
          if (err instanceof RouteSkillError) {
            if (!opts.json) console.error(err.message);
            else {
              process.stdout.write(
                JSON.stringify({ ok: false, error: err.code, message: err.message }) + "\n",
              );
            }
            process.exitCode = ExitCode.ERROR;
            return;
          }
          throw err;
        }
      },
    );
}
