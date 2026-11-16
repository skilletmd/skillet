/**
 * Where plugins keep their skills, for the map scan (plan U3 steps 7 and 8).
 *
 *  - Claude Code: user-scope entries in `<claude>/plugins/installed_plugins.json`,
 *    skills at `<installPath>/skills/<name>/SKILL.md`, on or off from
 *    `enabledPlugins` in `<claude>/settings.json`. Project-scope installs are
 *    named in the unreadable list, never opened.
 *  - Codex: each `[plugins."<name>@<marketplace>"]` table in
 *    `<codex>/config.toml` with its `enabled` flag, skills under the newest
 *    version folder of `<codex>/plugins/cache/<marketplace>/<name>/`.
 *
 * This module only finds the skills folders; `./scan.ts` reads the skills in
 * them. Everything here reads, nothing writes. Before reading a file or
 * listing a folder it asks the caller's gate, so a file in a macOS-protected
 * folder is named instead of read.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { MapPluginOwner, MapUnreadable, MapUnreadableReason } from "./folder-rules.js";

/** Says why a path can't be read without asking the person, or null when it can. */
export type ReadGate = (path: string) => MapUnreadableReason | null;

export interface PluginSkillsSource {
  tool: "claude-code" | "codex";
  owner: MapPluginOwner;
  /** The folder whose subfolders are the plugin's skills. It may not exist. */
  skillsDir: string;
  version: string | null;
}

export interface PluginSourcesResult {
  sources: PluginSkillsSource[];
  unreadable: MapUnreadable[];
}

const openGate: ReadGate = () => null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function errCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | undefined)?.code;
}

export function isMissingError(err: unknown): boolean {
  const code = errCode(err);
  return code === "ENOENT" || code === "ENOTDIR";
}

/** The unreadable reason for a failed read. */
export function reasonForError(err: unknown): MapUnreadableReason {
  const code = errCode(err);
  return code === "EACCES" || code === "EPERM" ? "permission-denied" : "unreadable";
}

/** `name@marketplace`, split at the last `@`. */
export function splitPluginId(id: string): { name: string; marketplace: string | null } {
  const at = id.lastIndexOf("@");
  if (at <= 0 || at === id.length - 1) return { name: id, marketplace: null };
  return { name: id.slice(0, at), marketplace: id.slice(at + 1) };
}

type TextRead =
  | { status: "ok"; text: string }
  | { status: "missing" }
  | { status: "unreadable"; reason: MapUnreadableReason; detail?: string };

async function readTextFile(path: string, gate: ReadGate): Promise<TextRead> {
  try {
    await stat(path);
  } catch (err) {
    if (isMissingError(err)) return { status: "missing" };
    return { status: "unreadable", reason: reasonForError(err), detail: errCode(err) };
  }
  const blocked = gate(path);
  if (blocked) return { status: "unreadable", reason: blocked };
  try {
    return { status: "ok", text: await readFile(path, "utf8") };
  } catch (err) {
    return { status: "unreadable", reason: reasonForError(err), detail: errCode(err) };
  }
}

function unreadableRow(
  path: string,
  reason: MapUnreadableReason,
  tool: string,
  extra: { plugin?: string; detail?: string | undefined } = {},
): MapUnreadable {
  return {
    path,
    reason,
    tools: [tool],
    ...(extra.plugin !== undefined ? { plugin: extra.plugin } : {}),
    ...(extra.detail !== undefined ? { detail: extra.detail } : {}),
  };
}

// ── Claude Code ─────────────────────────────────────────────────────────────

export interface ClaudeInstalledPlugin {
  id: string;
  name: string;
  marketplace: string | null;
  installPath: string;
  version: string | null;
}

export interface ClaudeScopedPlugin {
  id: string;
  name: string;
  marketplace: string | null;
  scope: string;
  projectPath: string | null;
  installPath: string | null;
}

/**
 * Parse `installed_plugins.json`. Version 2 keeps a list of installs per
 * plugin, each with a scope; version 1 kept one record per plugin with no
 * scope, which was always the user's. Records without an install path are
 * dropped: there is nowhere to look.
 */
export function parseClaudeInstalledPlugins(json: unknown): {
  user: ClaudeInstalledPlugin[];
  other: ClaudeScopedPlugin[];
} {
  const user: ClaudeInstalledPlugin[] = [];
  const other: ClaudeScopedPlugin[] = [];
  if (!isRecord(json) || !isRecord(json["plugins"])) return { user, other };
  for (const [id, value] of Object.entries(json["plugins"])) {
    const { name, marketplace } = splitPluginId(id);
    for (const record of Array.isArray(value) ? value : [value]) {
      if (!isRecord(record)) continue;
      const installPath =
        typeof record["installPath"] === "string" && record["installPath"].length > 0
          ? record["installPath"]
          : null;
      const scope = typeof record["scope"] === "string" ? record["scope"] : "user";
      if (scope === "user") {
        if (installPath === null) continue;
        const version = typeof record["version"] === "string" ? record["version"] : null;
        user.push({ id, name, marketplace, installPath, version });
      } else {
        const projectPath =
          typeof record["projectPath"] === "string" ? record["projectPath"] : null;
        other.push({ id, name, marketplace, scope, projectPath, installPath });
      }
    }
  }
  return { user, other };
}

/** `enabledPlugins` from Claude Code's settings: plugin id → on or off. */
export function parseClaudeEnabledPlugins(json: unknown): Map<string, boolean> {
  const enabled = new Map<string, boolean>();
  if (!isRecord(json) || !isRecord(json["enabledPlugins"])) return enabled;
  for (const [id, value] of Object.entries(json["enabledPlugins"])) {
    if (typeof value === "boolean") enabled.set(id, value);
  }
  return enabled;
}

async function readJson(
  path: string,
  gate: ReadGate,
): Promise<{ status: "ok"; value: unknown } | Exclude<TextRead, { status: "ok" }>> {
  const read = await readTextFile(path, gate);
  if (read.status !== "ok") return read;
  try {
    return { status: "ok", value: JSON.parse(read.text) as unknown };
  } catch {
    return { status: "unreadable", reason: "unparseable" };
  }
}

/**
 * Claude Code's plugin skills folders. User-scope installs come first, then
 * installs of any other scope (named, not opened), each in file order.
 */
export async function readClaudePluginSources(opts: {
  claudeDir: string;
  gate?: ReadGate;
}): Promise<PluginSourcesResult> {
  const gate = opts.gate ?? openGate;
  const tool = "claude-code";
  const result: PluginSourcesResult = { sources: [], unreadable: [] };

  const installedPath = join(opts.claudeDir, "plugins", "installed_plugins.json");
  const installed = await readJson(installedPath, gate);
  if (installed.status === "missing") return result;
  if (installed.status === "unreadable") {
    result.unreadable.push(
      unreadableRow(installedPath, installed.reason, tool, { detail: installed.detail }),
    );
    return result;
  }
  const { user, other } = parseClaudeInstalledPlugins(installed.value);

  let enabled = new Map<string, boolean>();
  if (user.length > 0) {
    const settingsPath = join(opts.claudeDir, "settings.json");
    const settings = await readJson(settingsPath, gate);
    if (settings.status === "ok") {
      enabled = parseClaudeEnabledPlugins(settings.value);
    } else if (settings.status === "unreadable") {
      result.unreadable.push(
        unreadableRow(settingsPath, settings.reason, tool, { detail: settings.detail }),
      );
    }
  }

  for (const plugin of user) {
    try {
      await stat(plugin.installPath);
    } catch (err) {
      if (isMissingError(err)) {
        result.unreadable.push(
          unreadableRow(plugin.installPath, "plugin-missing", tool, { plugin: plugin.id }),
        );
        continue;
      }
      // Anything else surfaces when the scan opens the skills folder.
    }
    result.sources.push({
      tool,
      owner: {
        kind: "plugin",
        name: plugin.name,
        marketplace: plugin.marketplace,
        enabled: enabled.get(plugin.id) ?? null,
      },
      skillsDir: join(plugin.installPath, "skills"),
      version: plugin.version,
    });
  }

  for (const plugin of other) {
    result.unreadable.push(
      unreadableRow(plugin.projectPath ?? plugin.installPath ?? installedPath, "project-plugin", tool, {
        plugin: plugin.id,
        detail: plugin.scope,
      }),
    );
  }
  return result;
}

// ── Codex ───────────────────────────────────────────────────────────────────

export interface CodexPluginConfig {
  id: string;
  name: string;
  marketplace: string | null;
  /** The table's `enabled` value; null when the table doesn't set one. */
  enabled: boolean | null;
}

// `[plugins."<id>"]`, `[plugins.'<id>']` or `[plugins.<bare-id>]`, nothing after.
const PLUGIN_TABLE_RE =
  /^\s*\[\s*plugins\s*\.\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|([A-Za-z0-9_-]+))\s*\]\s*(?:#.*)?$/;
const TABLE_RE = /^\s*\[/;
const ENABLED_RE = /^\s*enabled\s*=\s*(true|false)\s*(?:#.*)?$/;

/**
 * The plugin tables in Codex's `config.toml`, read line by line without a TOML
 * library: a `[plugins."<name>@<marketplace>"]` header starts a plugin, any
 * other header ends it, and `enabled = true|false` inside it sets its state.
 * Everything else in the file is ignored.
 */
export function parseCodexPluginConfig(toml: string): CodexPluginConfig[] {
  const plugins: CodexPluginConfig[] = [];
  let current: CodexPluginConfig | null = null;
  for (const line of toml.split(/\r?\n/)) {
    const header = PLUGIN_TABLE_RE.exec(line);
    if (header) {
      const id =
        header[1] !== undefined ? header[1].replace(/\\(["\\])/g, "$1") : (header[2] ?? header[3])!;
      current = { id, ...splitPluginId(id), enabled: null };
      plugins.push(current);
      continue;
    }
    if (TABLE_RE.test(line)) {
      current = null;
      continue;
    }
    if (current === null) continue;
    const enabled = ENABLED_RE.exec(line);
    if (enabled) current.enabled = enabled[1] === "true";
  }
  return plugins;
}

function parseVersion(name: string): { parts: number[]; prerelease: boolean } | null {
  const match = /^v?(\d+(?:\.\d+)*)([-+].*)?$/i.exec(name);
  if (!match) return null;
  return {
    parts: match[1]!.split(".").map(Number),
    prerelease: match[2]?.startsWith("-") ?? false,
  };
}

function compareVersionFolders(
  a: { name: string; mtimeMs: number },
  b: { name: string; mtimeMs: number },
): number {
  const va = parseVersion(a.name);
  const vb = parseVersion(b.name);
  if (va && !vb) return 1;
  if (!va && vb) return -1;
  if (va && vb) {
    for (let i = 0; i < Math.max(va.parts.length, vb.parts.length); i++) {
      const diff = (va.parts[i] ?? 0) - (vb.parts[i] ?? 0);
      if (diff !== 0) return diff;
    }
    if (va.prerelease !== vb.prerelease) return va.prerelease ? -1 : 1;
  }
  if (a.mtimeMs !== b.mtimeMs) return a.mtimeMs - b.mtimeMs;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/**
 * The newest of a plugin's version folders. Names that read as versions are
 * compared by number (1.10.0 is newer than 1.9.0) and beat names that don't
 * (a `latest` link, a commit hash); among those, the most recently changed
 * folder wins.
 */
export function newestVersionFolder(
  folders: ReadonlyArray<{ name: string; mtimeMs: number }>,
): string | null {
  let best: { name: string; mtimeMs: number } | null = null;
  for (const folder of folders) {
    if (best === null || compareVersionFolders(folder, best) > 0) best = folder;
  }
  return best?.name ?? null;
}

function isFolderName(segment: string): boolean {
  return (
    segment.length > 0 && segment !== "." && segment !== ".." && !/[/\\\0]/.test(segment)
  );
}

/** Codex's plugin skills folders, in config file order. */
export async function readCodexPluginSources(opts: {
  codexDir: string;
  gate?: ReadGate;
}): Promise<PluginSourcesResult> {
  const gate = opts.gate ?? openGate;
  const tool = "codex";
  const result: PluginSourcesResult = { sources: [], unreadable: [] };

  const configPath = join(opts.codexDir, "config.toml");
  const config = await readTextFile(configPath, gate);
  if (config.status === "missing") return result;
  if (config.status === "unreadable") {
    result.unreadable.push(unreadableRow(configPath, config.reason, tool, { detail: config.detail }));
    return result;
  }

  const cacheDir = join(opts.codexDir, "plugins", "cache");
  for (const plugin of parseCodexPluginConfig(config.text)) {
    if (plugin.marketplace === null || !isFolderName(plugin.name) || !isFolderName(plugin.marketplace)) {
      result.unreadable.push(unreadableRow(configPath, "unparseable", tool, { plugin: plugin.id }));
      continue;
    }
    const pluginDir = join(cacheDir, plugin.marketplace, plugin.name);
    const blocked = gate(pluginDir);
    if (blocked) {
      result.unreadable.push(unreadableRow(pluginDir, blocked, tool, { plugin: plugin.id }));
      continue;
    }
    let names: string[];
    try {
      names = await readdir(pluginDir);
    } catch (err) {
      if (!isMissingError(err)) {
        result.unreadable.push(
          unreadableRow(pluginDir, reasonForError(err), tool, { plugin: plugin.id, detail: errCode(err) }),
        );
        continue;
      }
      names = [];
    }
    const folders: Array<{ name: string; mtimeMs: number }> = [];
    for (const name of names) {
      if (name.startsWith(".")) continue;
      try {
        const info = await stat(join(pluginDir, name));
        if (info.isDirectory()) folders.push({ name, mtimeMs: info.mtimeMs });
      } catch {
        // A link to nowhere is not a version.
      }
    }
    const newest = newestVersionFolder(folders);
    if (newest === null) {
      result.unreadable.push(unreadableRow(pluginDir, "plugin-missing", tool, { plugin: plugin.id }));
      continue;
    }
    result.sources.push({
      tool,
      owner: { kind: "plugin", name: plugin.name, marketplace: plugin.marketplace, enabled: plugin.enabled },
      skillsDir: join(pluginDir, newest, "skills"),
      version: newest,
    });
  }
  return result;
}
