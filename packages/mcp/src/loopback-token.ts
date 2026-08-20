/**
 * Per-session loopback bearer for the MCP HTTP transport.
 *
 * Minted on server start and written to ~/.skillet/mcp-loopback-token (mode 0600).
 * Loopback HTTP clients must present this token (prefix `skillet_loop_`) or a
 * registry-validated skillet bearer — prefix-only skillet_* strings are not
 * accepted.
 */

import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SKILLET_DIR } from "@skillet/core";

export const LOOPBACK_TOKEN_PREFIX = "skillet_loop_";
const TOKEN_FILE = "mcp-loopback-token";

export function loopbackTokenPath(): string {
  return join(SKILLET_DIR, TOKEN_FILE);
}

/** True when `token` is our loopback-only bearer shape. */
export function isLoopbackSecretToken(token: string): boolean {
  return token.startsWith(LOOPBACK_TOKEN_PREFIX);
}

/** Mint (or reuse) the loopback secret for this MCP HTTP session. */
export async function ensureLoopbackToken(): Promise<string> {
  const existing = await readLoopbackToken();
  if (existing) return existing;

  const token = LOOPBACK_TOKEN_PREFIX + randomBytes(24).toString("base64url");
  await mkdir(SKILLET_DIR, { recursive: true });
  await writeFile(loopbackTokenPath(), `${token}\n`, { mode: 0o600 });
  return token;
}

export async function readLoopbackToken(): Promise<string | null> {
  try {
    const raw = await readFile(loopbackTokenPath(), "utf8");
    const token = raw.trim();
    return isLoopbackSecretToken(token) ? token : null;
  } catch {
    return null;
  }
}
