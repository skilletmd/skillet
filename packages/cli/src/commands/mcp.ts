import type { Command } from "commander";
import { loadRegistryBearer } from "@skillet/core";
import { CLI_VERSION } from "../cli-context.js";
import { ExitCode, exitWith } from "../exit-codes.js";

export function registerMcpCommand(program: Command): void {
  program
    .command("mcp")
    .description("Serve your kit to MCP agents (Claude Desktop, Cursor, Claude Code)")
    .option("--port <number>", "Start HTTP transport on this port instead of stdio")
    .option(
      "--token <token>",
      "Bearer token for stdio mode (defaults to this machine's paired device token)",
    )
    .action(async (opts: { port?: string; token?: string }) => {
      const { runStdio, startHttpTransport, loopbackTokenPath } = await import("@skillet/mcp");

      if (opts.port !== undefined) {
        // Strict digits: parseInt("8080x") truncates to 8080 — reject the typo
        // instead of silently binding a different port than the user typed.
        const port = /^\d+$/.test(opts.port.trim()) ? Number.parseInt(opts.port, 10) : NaN;
        if (!Number.isFinite(port) || port < 1 || port > 65535) {
          console.error(`✗ Invalid port: ${opts.port}`);
          exitWith(ExitCode.ERROR);
        }
        const stop = await startHttpTransport({ port, serverVersion: CLI_VERSION }).catch((e: Error) => {
          console.error(`✗ MCP HTTP server failed to start: ${e.message}`);
          exitWith(ExitCode.ERROR);
        });
        if (stop.loopbackToken) {
          console.error(
            `MCP loopback bearer (Authorization: Bearer …): saved to ${loopbackTokenPath()}`,
          );
        }
        await new Promise<void>((resolve) => {
          process.on("SIGINT", () => stop.stop().finally(resolve));
          process.on("SIGTERM", () => stop.stop().finally(resolve));
        });
      } else {
        // A human running this in a terminal sees a silent hang: stdio mode
        // waits for JSON-RPC on stdin and keeps stdout a clean JSON stream, so
        // there is nothing to print. Clients spawn us with piped stdin (no
        // TTY), so this hint only reaches a person and never pollutes stdout.
        if (process.stdin.isTTY) {
          process.stderr.write(
            "This is the LOCAL MCP server. It runs on this machine and is now\n" +
              "waiting for a client to connect over stdin. Nothing else prints here:\n" +
              "stdout is reserved for the JSON stream.\n\n" +
              "For a client on this machine (Claude Desktop, Cursor, Claude Code),\n" +
              "add this to its MCP config, then let the client launch skillet:\n" +
              '  { "mcpServers": { "skillet": { "command": "skillet", "args": ["mcp"] } } }\n\n' +
              "For a web agent (ChatGPT, Claude.ai) that can't reach your machine,\n" +
              "use your hosted MCP link instead. Turn it on and copy it with:\n" +
              "  skillet web settings\n\n" +
              "Full setup: skillet mcp --help. Press Ctrl+C to stop.\n\n",
          );
        }
        // stdio serves a local same-user client (the process could read
        // ~/.skillet/skills directly), so default to the machine's own
        // credentials: --token → device.json → session. Unpaired stays
        // fail-closed (empty list).
        const bearer = await loadRegistryBearer(opts.token);
        await runStdio({ token: bearer.token || null, serverVersion: CLI_VERSION });
      }
    });
}
