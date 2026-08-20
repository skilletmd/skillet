import type { Command } from "commander";
import { stdin } from "node:process";
import {
  flushEvents,
  listRouteManifest,
  recordRouteInvocation,
  recordSkillRoute,
  RouteSkillError,
  type RouteSurface,
} from "@skillet/core";
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

function hookPayloadInvokesSkillet(raw: string): boolean {
  if (!raw.trim()) return false;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return collectStrings(parsed).some((text) => text.trimStart().startsWith("/skillet"));
  } catch {
    return false;
  }
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
      const raw = await readStdin();
      if (!hookPayloadInvokesSkillet(raw)) return;
      const runtime = opts.runtime?.trim() || "unknown";
      recordRouteInvocation({
        runtime,
        source: `${runtime}-hook`,
        surface: "user-prompt-submit" satisfies RouteSurface,
      });
      await flushEvents();
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
