import { existsSync, readFileSync } from "node:fs";
import { lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Adapter, AdapterResult } from "@skillet/core";
import { loadIdentity, runtimeLabel } from "@skillet/core";
import { claudeCodeAdapter } from "@skillet/adapters-claude-code";
import { codexAdapter, codexProjectAdapter } from "@skillet/adapters-codex";
import { openclawAdapter } from "@skillet/adapters-openclaw";
import { hermesAdapter } from "@skillet/adapters-hermes";
import { cursorAdapter } from "@skillet/adapters-cursor";
import { windsurfAdapter } from "@skillet/adapters-windsurf";
import { devinAdapter } from "@skillet/adapters-devin";
import { opencodeAdapter } from "@skillet/adapters-opencode";
import { BUNDLED_ROUTE_SLUG } from "@skillet/core";

const __dirname = dirname(fileURLToPath(import.meta.url));

declare const __SKILLET_CLI_VERSION__: string | undefined;

/** Version from package.json in dev; injected at esbuild bundle time for pkg sidecars. */
export const CLI_VERSION =
  typeof __SKILLET_CLI_VERSION__ !== "undefined"
    ? __SKILLET_CLI_VERSION__
    : (JSON.parse(
        readFileSync(join(__dirname, "..", "package.json"), "utf8"),
      ) as { version: string }).version;

// Expose the client version to @skillet/core's RegistryClient (which sends it as
// X-Skillet-Client-Version for the min-supported-version gate) without core
// importing the CLI. Same process, so the env var reaches core's client.
if (!process.env["SKILLET_CLIENT_VERSION"]) {
  process.env["SKILLET_CLIENT_VERSION"] = CLI_VERSION;
}

/** Global universal baseline — always materializes to `~/.agents/skills`. */
export const BASELINE_GLOBAL_ADAPTERS: Adapter[] = [codexAdapter];

/** Re-export for tier resolution (repo `.agents/skills` when in a project). */
export { codexProjectAdapter };

/** Opt-in runtimes beyond the universal `.agents/skills` baseline. */
export const ADDITIONAL_ADAPTERS: Adapter[] = [
  claudeCodeAdapter,
  openclawAdapter,
  hermesAdapter,
  cursorAdapter,
  windsurfAdapter,
  devinAdapter,
];

/** Full runtime adapter set — order matches core/sync iteration and human output. */
export const ALL_ADAPTERS: Adapter[] = [
  ...BASELINE_GLOBAL_ADAPTERS,
  ...ADDITIONAL_ADAPTERS,
];

/**
 * Agents that READ the universal `~/.agents/skills` baseline rather than
 * materializing into their own directory. opencode reads that path (same as the
 * Codex baseline), so it must NOT join the materializing set — that would
 * double-write and double-count one materialization. Instead it is surfaced
 * here for detection/labeling in `skillet runtimes` (and the desktop tray
 * facepile) so users see opencode as a runtime whose skills live in the shared
 * baseline dir. Detection is opencode-specific (`~/.config/opencode`).
 */
export const BASELINE_READER_ADAPTERS: Adapter[] = [opencodeAdapter];

export function statusGlyph(status: AdapterResult["status"]): string {
  switch (status) {
    case "materialized":
      return "✓";
    case "skipped-not-detected":
      return "·";
    case "failed":
      return "✗";
  }
}

/**
 * Human display name for an adapter, from the same single source of truth as
 * `skillet runtimes` — so `windsurf` reads "Devin Desktop" (Cognition's June
 * 2026 rebrand of the Windsurf editor) and never gets mistaken for the separate
 * `devin` (Devin CLI/Local) row. Mirrors the runtimes codex special-case: the
 * universal `~/.agents/skills` baseline is only labeled "Codex" on direct
 * evidence (`~/.codex`), else the honest "Universal".
 */
export function adapterDisplayLabel(name: string): string {
  if (name === "codex" && existsSync(join(homedir(), ".codex"))) return "Codex";
  return runtimeLabel(name);
}

export function renderAdapterLine(r: AdapterResult): string {
  const glyph = statusGlyph(r.status);
  const label = adapterDisplayLabel(r.name);
  if (r.status === "materialized") {
    return `  ${glyph} ${label}: ${r.count} skill${r.count === 1 ? "" : "s"} → ${r.targetDir}`;
  }
  if (r.status === "skipped-not-detected") {
    return `  ${glyph} ${label}: not detected`;
  }
  return `  ${glyph} ${label}: failed (${r.error ?? "unknown error"})`;
}

/** commander `collect` accumulator for repeatable options. */
export function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await lstat(p);
    return true;
  } catch {
    return false;
  }
}

/** Skills a person manages: everything in state except Skillet's own bundled
 *  /skillet router, which is plumbing and never counts as "your skills". */
export function countUserSkills(state: { skills: Record<string, unknown> }): number {
  return Object.keys(state.skills).filter((slug) => slug !== BUNDLED_ROUTE_SLUG).length;
}

export const REGISTRY_DEFAULT =
  process.env["SKILLET_REGISTRY_URL"] ??
  process.env["SKILLET_REGISTRY"] ??
  "https://registry.skillet.md";

/** Resolve the registry base URL for a registry-scoped command: explicit
 *  override, then stored identity, then env, then the default — trailing slash
 *  stripped. Centralizes the coalesce so commands don't each re-implement it. */
export async function resolveRegistryUrl(opts: { registry?: string } = {}): Promise<string> {
  const identity = await loadIdentity();
  return (
    opts.registry ??
    identity?.registryUrl ??
    process.env["SKILLET_REGISTRY_URL"] ??
    REGISTRY_DEFAULT
  ).replace(/\/$/, "");
}

/** Registry URL for kit/team commands. */
export const REGISTRY_DEFAULT_TEAM =
  process.env["SKILLET_REGISTRY_URL"] ??
  process.env["SKILLET_REGISTRY"] ??
  "https://registry.skillet.md";
