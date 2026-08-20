/**
 * Skillet MCP stdio transport.
 *
 * Reads newline-delimited JSON-RPC messages from stdin, writes responses to
 * stdout. Errors and diagnostic output go to stderr so stdout remains a clean
 * JSON stream for MCP clients.
 *
 * Each line on stdin is one complete JSON-RPC message. Empty lines are skipped.
 * The transport runs until stdin closes (EOF), then exits cleanly.
 */

import { createInterface } from "node:readline";
import { err, ERRC, type RpcResponse } from "../protocol.js";
import { handleMessage, parseMessage } from "../server.js";

export interface StdioTransportOptions {
  /** Pre-authenticated bearer token (e.g. passed via --token CLI flag). */
  token?: string | null;
  /** Readable stream (defaults to process.stdin). */
  input?: NodeJS.ReadableStream;
  /** Writable stream (defaults to process.stdout). */
  output?: NodeJS.WritableStream;
  /** Version reported in serverInfo (the host's release version). */
  serverVersion?: string;
}

/** Write a single JSON-RPC response to the output stream as a newline-terminated line. */
function writeLine(out: NodeJS.WritableStream, response: RpcResponse): void {
  out.write(JSON.stringify(response) + "\n");
}

/** Start the stdio MCP transport and block until stdin closes. */
export async function runStdio(opts: StdioTransportOptions = {}): Promise<void> {
  const input = opts.input ?? process.stdin;
  const output = opts.output ?? process.stdout;
  const token = opts.token ?? null;
  const serverVersion = opts.serverVersion;

  const rl = createInterface({ input, terminal: false });

  await new Promise<void>((resolve) => {
    rl.on("line", async (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      let msg;
      try {
        msg = parseMessage(trimmed);
      } catch (e) {
        const code = (e as { jsonrpcCode?: number }).jsonrpcCode ?? ERRC.PARSE_ERROR;
        writeLine(output, err(null, code, (e as Error).message));
        return;
      }

      const response = await handleMessage(msg, { token, serverVersion }).catch((e: unknown) =>
        err(
          "id" in msg ? (msg as { id: string | number }).id : null,
          ERRC.INTERNAL_ERROR,
          e instanceof Error ? e.message : "Internal error",
        ),
      );

      if (response !== null) {
        writeLine(output, response);
      }
    });

    rl.on("close", () => resolve());
    rl.on("error", (e) => {
      process.stderr.write(`Skillet MCP stdio error: ${e.message}\n`);
      resolve();
    });
  });
}
