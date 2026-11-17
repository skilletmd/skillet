/**
 * Usage marks for the kit map (plan U4, KTD4; R8 R11 R15, AE2).
 *
 * Marks every scan entry used, unused or unknown from records already on the
 * computer, and says for each AI tool how much of its history Skillet could
 * read, for the map's header (R15):
 *
 * - Claude Code: the `skillUsage` record in its config file (`~/.claude.json`,
 *   or `.claude.json` inside CLAUDE_CONFIG_DIR). Keys are folder names,
 *   `<plugin>:<name>` or `<org>:<name>`, each with `lastUsedAt` in ms. The
 *   record starts at `firstStartTime` and seems to stop at 100 keys, so while
 *   it holds 100 a skill missing from it stays unknown. Transcripts are never
 *   read.
 * - Codex: its session logs (`sessions/` and `archived_sessions/`), newest
 *   first by last write, for at most three seconds. Its history starts at its
 *   oldest session. Only a command-running call (`exec`) that names an
 *   entry's SKILL.md and a user message naming `$<name>` count as runs. Every
 *   session's preamble lists every skill's path, so preamble records are
 *   skipped. Any other record that names an entry's SKILL.md leaves that
 *   entry unknown, so a log format this reader doesn't know never turns a
 *   used skill unused.
 * - Skillet: `/skillet` routes in the local route history.
 *
 * The other tools keep no history Skillet can read.
 *
 * Used: any source shows a run in the last 30 days. Unused: every tool that
 * loads the skill kept 30 days of records and none shows a run. Otherwise
 * unknown, naming the tools that couldn't tell.
 *
 * Read-only and local (KTD4): files are only opened for reading, nothing is
 * written or sent, and each record is dropped as soon as it is classified. A
 * line is decoded and parsed only when a byte check finds `SKILL.md` in it,
 * or `$` in what may be a user message. The result holds states, short codes,
 * tool ids, day counts and times, never a path or a word from a record.
 */
import type { Dirent } from "node:fs";
import { open, readFile, readdir, stat, type FileHandle } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { SKILL_ENTRYPOINT } from "@skillet/protocol";
import { readRouteHistory, type RouteHistory } from "../kit/route-history.js";
import { CLAUDE_ENV_ROOT } from "../util/pathsafe.js";
import { isMissingError } from "./plugin-sources.js";
import type { MapScanEntry, MapScanLocation } from "./scan.js";

/** A skill with no run in this many days is unused (R11). */
export const MAP_USAGE_WINDOW_DAYS = 30;
/** How long Codex's session logs are read, newest first. */
export const CODEX_READ_BUDGET_MS = 3_000;
/** Claude Code's `skillUsage` seems to keep this many skills at most. */
export const CLAUDE_SKILL_USAGE_CAP = 100;

export type MapUsageState = "used" | "unused" | "unknown";

/** Why a tool that loads a skill can't tell whether it ran, as a short code. */
export type MapUsageGapReason =
  /** The tool keeps no history Skillet can read. */
  | "no-history"
  /** The tool records nothing for skills in this folder (an app's folder). */
  | "untracked"
  /** It holds fewer than 30 days of records. */
  | "short-history"
  /** Skillet couldn't read every Codex session in the window, most often for lack of time. */
  | "not-all-read"
  /** Claude Code's record is full and doesn't list the skill. */
  | "capped"
  /** A Codex record named the skill's SKILL.md in a way this reader doesn't know. */
  | "unrecognized";

/** The kit map's `usage.reason`: `no-recent-run` for an unused skill, else the main gap. */
export type MapUsageReason = "no-recent-run" | MapUsageGapReason;

/** How much of a tool's history Skillet read, as the kit map's `looked` list says it. */
export type MapUsageHistory = "read" | "short" | "none";

export interface MapUsageGap {
  tool: string;
  reason: MapUsageGapReason;
  /** For `short-history` and `not-all-read`: the days of records it holds, or Skillet read. */
  days?: number;
}

export interface MapUsageMark {
  state: MapUsageState;
  /** Null when used. */
  reason: MapUsageReason | null;
  /** Where a run in the window showed: `claude-code`, `codex` or `skillet`. */
  ranIn: string[];
  /** The newest run any record shows, in the window or before it (ms), or null. */
  lastRunAt: number | null;
  /** When unknown: each tool that loads the skill and couldn't tell, and why. */
  gaps: MapUsageGap[];
  /** One short line for the map, naming the tools it couldn't check. */
  text: string;
}

export interface MapUsageTool {
  tool: string;
  history: MapUsageHistory;
  /** When `short`: the days of records it holds, or Skillet read. */
  days?: number;
  /** What Skillet couldn't check, most important first. Empty when it read everything. */
  reasons: MapUsageGapReason[];
  /** One line for the map's header (R15). */
  text: string;
}

export interface MapUsageResult {
  /** One mark per scan entry, by entry key. */
  marks: Record<string, MapUsageMark>;
  /** Every tool the scan looked at or an entry loads, and how much of its history Skillet read. */
  tools: MapUsageTool[];
  /** The window the marks cover, in ms: 30 days up to `until`. */
  since: number;
  until: number;
}

export interface MapUsageOptions {
  /** The scan to mark: its entries, and the tools it looked at. */
  scan: { entries: readonly MapScanEntry[]; tools?: readonly string[] };
  /** Defaults to the current home directory. */
  home?: string;
  /**
   * CLAUDE_CONFIG_DIR, or null when it isn't set. Claude Code keeps its
   * config in `.claude.json` inside that folder, else in the home directory.
   * Defaults to the validated environment value the claude-code adapter reads.
   */
  claudeConfigDir?: string | null;
  /** Codex's home. Defaults to `~/.codex`. */
  codexDir?: string;
  /** Skillet's own route history. Defaults to the local store. */
  routeHistory?: RouteHistory;
  /**
   * The time in ms. The Codex budget is measured on it: it is read when the
   * Codex pass starts, before each session file, and between chunks of a
   * long file. Defaults to Date.now.
   */
  clock?: () => number;
  /** The end of the window. Defaults to the clock when the pass starts. */
  now?: number;
  /** How long Codex's session logs may be read. */
  codexBudgetMs?: number;
}

const CLAUDE = "claude-code";
const CODEX = "codex";
const SKILLET = "skillet";

const DAY_MS = 86_400_000;
const WINDOW_MS = MAP_USAGE_WINDOW_DAYS * DAY_MS;

const TOOL_LABELS: Readonly<Record<string, string>> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  opencode: "opencode",
  cursor: "Cursor",
  // The adapter id stays `windsurf`; the app has been Devin Desktop since its 2026 rebrand.
  windsurf: "Devin Desktop",
  devin: "Devin",
  openclaw: "OpenClaw",
  hermes: "Hermes",
};

const GAP_ORDER: readonly MapUsageGapReason[] = [
  "no-history",
  "untracked",
  "short-history",
  "not-all-read",
  "capped",
  "unrecognized",
];

interface Window {
  since: number;
  until: number;
}

type Fields = Record<string, unknown>;

function isFields(value: unknown): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unique<T>(items: Iterable<T>): T[] {
  return [...new Set(items)];
}

/** A time in ms, from ms or a date string; null when it is neither. */
function timeOf(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function daysBetween(from: number, to: number): number {
  return Math.max(0, Math.floor((to - from) / DAY_MS));
}

function label(tool: string): string {
  return TOOL_LABELS[tool] ?? tool;
}

// ---------------------------------------------------------------------------
// Claude Code
// ---------------------------------------------------------------------------

interface ClaudeRecord {
  since: number;
  /** Lowercased key to its last run in ms, or null when the time can't be read. */
  lastUsed: Map<string, number | null>;
  /** It holds as many skills as Claude Code seems to keep, so a missing one may have been dropped. */
  capped: boolean;
}

/** Claude Code's usage record, or null when the file is missing or either field is missing or malformed. */
async function readClaudeRecord(file: string): Promise<ClaudeRecord | null> {
  let root: unknown;
  try {
    root = JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
  if (!isFields(root)) return null;
  const since = timeOf(root["firstStartTime"]);
  const usage = root["skillUsage"];
  if (since === null || !isFields(usage)) return null;
  const keys = Object.keys(usage);
  const lastUsed = new Map<string, number | null>();
  for (const key of keys) {
    const row = usage[key];
    const at = isFields(row) ? timeOf(row["lastUsedAt"]) : null;
    const k = key.toLowerCase();
    const prior = lastUsed.get(k);
    lastUsed.set(k, prior === undefined ? at : prior === null || at === null ? null : Math.max(prior, at));
  }
  return { since, lastUsed, capped: keys.length >= CLAUDE_SKILL_USAGE_CAP };
}

/** The keys Claude Code records this copy's runs under, or null when it records none (an app's folder). */
function claudeKeys(entry: MapScanEntry, location: MapScanLocation): string[] | null {
  const folder = basename(location.path);
  const owner = location.owner;
  const spaced = (space: string): string[] =>
    unique([`${space}:${folder}`, `${space}:${entry.name}`].map((key) => key.toLowerCase()));
  switch (location.source) {
    case "app":
      return null;
    case "plugin":
      return owner?.kind === "plugin" ? spaced(owner.name) : null;
    case "synced":
      return owner?.kind === "organization" ? spaced(owner.name) : null;
    default:
      return [folder.toLowerCase()];
  }
}

interface ToolEvidence {
  /** The newest run its records show, in the window or not. */
  lastRun: number | null;
  /** Why it can't vouch for the whole window, or null when it can. */
  gap: MapUsageGap | null;
}

function claudeEvidence(entry: MapScanEntry, record: ClaudeRecord | null, window: Window): ToolEvidence {
  if (record === null) return { lastRun: null, gap: { tool: CLAUDE, reason: "no-history" } };
  const keys: string[] = [];
  let untracked = false;
  for (const location of entry.locations) {
    if (!location.tools.includes(CLAUDE)) continue;
    const found = claudeKeys(entry, location);
    if (found === null) untracked = true;
    else keys.push(...found);
  }
  // No key to look up is no way to see a run.
  if (keys.length === 0) untracked = true;
  let lastRun: number | null = null;
  let listed = false;
  let unreadable = false;
  for (const key of unique(keys)) {
    const at = record.lastUsed.get(key);
    if (at === undefined) continue;
    listed = true;
    if (at === null) unreadable = true;
    else lastRun = lastRun === null ? at : Math.max(lastRun, at);
  }
  let gap: MapUsageGap | null = null;
  if (unreadable) gap = { tool: CLAUDE, reason: "no-history" };
  else if (untracked) gap = { tool: CLAUDE, reason: "untracked" };
  else if (record.since > window.since) {
    gap = { tool: CLAUDE, reason: "short-history", days: daysBetween(record.since, window.until) };
  } else if (!listed && record.capped) gap = { tool: CLAUDE, reason: "capped" };
  return { lastRun, gap };
}

// ---------------------------------------------------------------------------
// Codex: what to look for
// ---------------------------------------------------------------------------

interface CodexTargets {
  /** A lowercased skill folder name, to the entries Codex loads from a folder of that name. */
  folders: Map<string, number[]>;
  /** A lowercased `$<name>`, to its entries. */
  names: Map<string, number[]>;
  /** Whether a raw line may hold a mention, before it is parsed. */
  mentionInLine: RegExp | null;
  /** Each mention in a person's own text. */
  mentionInText: RegExp | null;
}

function addTarget(map: Map<string, number[]>, key: string, index: number): void {
  const k = key.trim().toLowerCase();
  if (k === "") return;
  const list = map.get(k);
  if (!list) map.set(k, [index]);
  else if (!list.includes(index)) list.push(index);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function codexTargets(entries: readonly MapScanEntry[]): CodexTargets {
  const folders = new Map<string, number[]>();
  const names = new Map<string, number[]>();
  entries.forEach((entry, index) => {
    for (const location of entry.locations) {
      // An app's folder has no usage key (the folder rules), so Codex can't vouch for it.
      if (!location.tools.includes(CODEX) || location.source === "app") continue;
      const folder = basename(location.path);
      addTarget(folders, folder, index);
      addTarget(names, folder, index);
      addTarget(names, entry.name, index);
      if (location.source === "plugin" && location.owner?.kind === "plugin") {
        addTarget(names, `${location.owner.name}:${entry.name}`, index);
        addTarget(names, `${location.owner.name}:${folder}`, index);
      }
    }
  });
  // Longest first, so `$deploy-check` is never read as `$deploy`.
  const alternatives = [...names.keys()]
    .sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0))
    .map(escapeRegExp)
    .join("|");
  return {
    folders,
    names,
    mentionInLine: alternatives ? new RegExp(`\\$(?:${alternatives})(?![A-Za-z0-9_-])`, "i") : null,
    mentionInText: alternatives
      ? new RegExp(`(?<![A-Za-z0-9_$])\\$(${alternatives})(?![A-Za-z0-9_-])`, "gi")
      : null,
  };
}

function isSeparator(ch: string | undefined): boolean {
  return ch === "/" || ch === "\\";
}

const SEGMENT_CHAR = /[A-Za-z0-9_.-]/;

/**
 * The entries a command reads: it names a SKILL.md, and the entry's folder
 * sits in it as a whole path segment, so `cat /x/tidy/SKILL.md` and
 * `cd /x/tidy && cat SKILL.md` both count.
 */
function readsIn(command: string, targets: CodexTargets): number[] {
  if (!command.includes(SKILL_ENTRYPOINT)) return [];
  const text = command.toLowerCase();
  const found = new Set<number>();
  for (const [folder, indices] of targets.folders) {
    for (let at = text.indexOf(folder); at !== -1; at = text.indexOf(folder, at + 1)) {
      const after = text[at + folder.length];
      if (isSeparator(text[at - 1]) && (after === undefined || !SEGMENT_CHAR.test(after))) {
        for (const index of indices) found.add(index);
        break;
      }
    }
  }
  return [...found];
}

/**
 * The entries a text names by path: each `<folder>/SKILL.md` in it, whatever
 * the separators (`\\` in escaped JSON, `\/`), plus a bare relative
 * `folder/SKILL.md` after a space or quote.
 */
function namedIn(text: string, targets: CodexTargets): number[] {
  const found = new Set<number>();
  for (let at = text.indexOf(SKILL_ENTRYPOINT); at !== -1; at = text.indexOf(SKILL_ENTRYPOINT, at + 1)) {
    let end = at;
    while (end > 0 && isSeparator(text[end - 1])) end--;
    if (end === at) continue;
    let begin = end;
    while (begin > 0 && end - begin < 255 && !isSeparator(text[begin - 1])) begin--;
    const segment = text.slice(begin, end).toLowerCase();
    for (const candidate of [segment, segment.split(/[\s"'`=(]/).pop() ?? ""]) {
      for (const index of targets.folders.get(candidate) ?? []) found.add(index);
    }
  }
  return [...found];
}

function mentionsIn(text: string, targets: CodexTargets): number[] {
  if (targets.mentionInText === null || !text.includes("$")) return [];
  const found = new Set<number>();
  for (const match of text.matchAll(targets.mentionInText)) {
    for (const index of targets.names.get(match[1]!.toLowerCase()) ?? []) found.add(index);
  }
  return [...found];
}

// ---------------------------------------------------------------------------
// Codex: what a record is
// ---------------------------------------------------------------------------

type CodexItem =
  /** Sets the session up; lists skills, never runs one. */
  | { kind: "preamble" }
  /** Runs a command. */
  | { kind: "exec"; command: string }
  /** What the person typed. */
  | { kind: "user"; texts: string[] }
  /** Anything else: if it names an entry's SKILL.md, that entry stays unknown. */
  | { kind: "other"; value: unknown };

const PREAMBLE: CodexItem = { kind: "preamble" };
const PREAMBLE_RECORDS: ReadonlySet<string> = new Set(["session_meta", "turn_context", "world_state"]);
const PREAMBLE_ROLES: ReadonlySet<string> = new Set(["developer", "system"]);
/** User-role messages Codex writes itself before the person types anything. */
const PREAMBLE_TEXTS: readonly string[] = [
  "<environment_context>",
  "<user_instructions>",
  "<skills_instructions>",
  "<INSTRUCTIONS>",
  "# AGENTS.md instructions",
];
/** Tools that run a command: `exec` today, and the shell tools of older Codex logs. */
const EXEC_CUSTOM_TOOLS: ReadonlySet<string> = new Set(["exec"]);
const EXEC_FUNCTION_TOOLS: ReadonlySet<string> = new Set(["exec", "exec_command", "shell", "shell_command"]);

function textsOf(content: unknown): string[] {
  if (typeof content === "string") return [content];
  if (!Array.isArray(content)) return [];
  const texts: string[] = [];
  for (const part of content) if (isFields(part) && typeof part["text"] === "string") texts.push(part["text"]);
  return texts;
}

function userItem(texts: string[]): CodexItem {
  const own = texts.filter((text) => {
    const start = text.trimStart();
    return !PREAMBLE_TEXTS.some((mark) => start.startsWith(mark));
  });
  return own.length > 0 ? { kind: "user", texts: own } : PREAMBLE;
}

function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((part) => typeof part === "string");
}

/** A shell tool's command and working folder, from its JSON arguments. */
function commandOf(args: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(args);
  } catch {
    return null;
  }
  if (!isFields(parsed)) return null;
  const command = parsed["command"] ?? parsed["cmd"];
  const text = typeof command === "string" ? command : isStrings(command) ? command.join(" ") : null;
  if (text === null) return null;
  const workdir = parsed["workdir"];
  return typeof workdir === "string" ? `${workdir}\n${text}` : text;
}

function responseItem(item: unknown): CodexItem {
  if (!isFields(item)) return { kind: "other", value: item };
  const type = item["type"];
  if (type === "message") {
    const role = item["role"];
    if (typeof role === "string" && PREAMBLE_ROLES.has(role)) return PREAMBLE;
    if (role === "user") {
      const texts = textsOf(item["content"]);
      if (texts.length > 0) return userItem(texts);
    }
  } else if (type === "custom_tool_call") {
    const { name, input } = item;
    if (typeof name === "string" && EXEC_CUSTOM_TOOLS.has(name) && typeof input === "string") {
      return { kind: "exec", command: input };
    }
  } else if (type === "function_call") {
    const { name, arguments: args } = item;
    if (typeof name === "string" && EXEC_FUNCTION_TOOLS.has(name) && typeof args === "string") {
      const command = commandOf(args);
      if (command !== null) return { kind: "exec", command };
    }
  } else if (type === "local_shell_call") {
    const action = item["action"];
    if (isFields(action) && isStrings(action["command"])) {
      const workdir = action["working_directory"];
      const command = action["command"].join(" ");
      return { kind: "exec", command: typeof workdir === "string" ? `${workdir}\n${command}` : command };
    }
  }
  return { kind: "other", value: item };
}

function itemsOf(record: unknown): CodexItem[] {
  if (!isFields(record)) return [{ kind: "other", value: record }];
  const type = record["type"];
  const payload = record["payload"];
  if (typeof type === "string" && PREAMBLE_RECORDS.has(type)) return [PREAMBLE];
  if (type === "response_item") return [responseItem(payload)];
  if (type === "event_msg" && isFields(payload) && payload["type"] === "user_message") {
    const message = payload["message"];
    if (typeof message === "string") return [userItem([message])];
  }
  if (type === "compacted" && isFields(payload)) {
    // A compaction can carry the history that replaces the old one, preamble
    // included; its items read like the log's own.
    const { replacement_history: history, ...rest } = payload;
    const items: CodexItem[] = [{ kind: "other", value: rest }];
    if (Array.isArray(history)) items.push(...history.map(responseItem));
    else items.push({ kind: "other", value: history });
    return items;
  }
  return [{ kind: "other", value: record }];
}

function eachString(value: unknown, visit: (text: string) => void): void {
  if (typeof value === "string") visit(value);
  else if (Array.isArray(value)) for (const part of value) eachString(part, visit);
  else if (isFields(value)) for (const part of Object.values(value)) eachString(part, visit);
}

// ---------------------------------------------------------------------------
// Codex: reading the logs
// ---------------------------------------------------------------------------

interface SessionFile {
  path: string;
  mtime: number;
  size: number;
  /** When its session started: from the name, or the last write if earlier. */
  started: number;
}

interface Listing {
  files: SessionFile[];
  /** A folder or file in the listing couldn't be read. */
  missed: boolean;
}

/** `sessions/YYYY/MM/DD/<file>` sits four levels down; one more is allowed. */
const SESSION_DEPTH = 4;
const ROLLOUT_TIME = /(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/;

/** When a rollout's session started, from its name (local time), or null when the name doesn't say. */
function startedFromName(path: string): number | null {
  const match = ROLLOUT_TIME.exec(basename(path));
  if (!match) return null;
  const [y, mo, d, h, mi, s] = match.slice(1).map(Number) as [number, number, number, number, number, number];
  const ms = new Date(y, mo - 1, d, h, mi, s).getTime();
  return Number.isFinite(ms) ? ms : null;
}

async function listSessions(dir: string, depth: number, listing: Listing): Promise<void> {
  let names: Dirent[];
  try {
    names = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (!isMissingError(err)) listing.missed = true;
    return;
  }
  const files: string[] = [];
  const folders: string[] = [];
  const links: string[] = [];
  for (const name of names) {
    if (name.name.startsWith(".")) continue;
    const path = join(dir, name.name);
    if (name.isDirectory()) folders.push(path);
    else if (name.isSymbolicLink()) links.push(path);
    else if (name.isFile() && name.name.endsWith(".jsonl")) files.push(path);
  }
  // A link can lead to a folder of sessions moved elsewhere, or to one file.
  for (const path of links) {
    try {
      const info = await stat(path);
      if (info.isDirectory()) folders.push(path);
      else if (path.endsWith(".jsonl")) files.push(path);
    } catch (err) {
      if (!isMissingError(err)) listing.missed = true;
    }
  }
  await Promise.all(
    files.map(async (path) => {
      try {
        const info = await stat(path);
        if (!info.isFile()) return;
        const mtime = info.mtimeMs;
        listing.files.push({ path, mtime, size: info.size, started: Math.min(mtime, startedFromName(path) ?? mtime) });
      } catch (err) {
        if (!isMissingError(err)) listing.missed = true;
      }
    }),
  );
  if (depth >= SESSION_DEPTH) {
    if (folders.length > 0) listing.missed = true;
    return;
  }
  for (const folder of folders) await listSessions(folder, depth + 1, listing);
}

const CHUNK_BYTES = 1 << 20;
/** A longer line is skipped, and then no Codex entry can be vouched for. */
const MAX_LINE_BYTES = 64 << 20;
const NEWLINE = 0x0a;
const DOLLAR = 0x24;
const SKILL_MD_BYTES = Buffer.from(SKILL_ENTRYPOINT);
const USER_BYTES = Buffer.from('"user');

type ReadOutcome = "read" | "expired" | "failed" | "oversized";

/** Stream a file's lines, handing on the ones `wants` keeps. Checks the budget between chunks. */
async function readLines(
  file: SessionFile,
  wants: (line: Buffer) => boolean,
  take: (text: string) => void,
  expired: () => boolean,
): Promise<ReadOutcome> {
  let handle: FileHandle;
  try {
    handle = await open(file.path, "r");
  } catch {
    return "failed";
  }
  let oversized = false;
  try {
    const finish = (line: Buffer): void => {
      if (line.length > 0 && wants(line)) take(line.toString("utf8"));
    };
    let offset = 0;
    let carry: Buffer[] = [];
    let carried = 0;
    let skipping = false;
    while (offset < file.size) {
      if (offset > 0 && expired()) return "expired";
      const length = Math.min(CHUNK_BYTES, file.size - offset);
      const chunk = Buffer.allocUnsafe(length);
      const { bytesRead } = await handle.read(chunk, 0, length, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
      const data = bytesRead < length ? chunk.subarray(0, bytesRead) : chunk;
      let start = 0;
      for (let nl = data.indexOf(NEWLINE); nl !== -1; nl = data.indexOf(NEWLINE, start)) {
        if (skipping) skipping = false;
        else if (carried > 0) {
          carry.push(data.subarray(start, nl));
          finish(Buffer.concat(carry, carried + nl - start));
          carry = [];
          carried = 0;
        } else finish(data.subarray(start, nl));
        start = nl + 1;
      }
      if (start < data.length && !skipping) {
        const rest = data.subarray(start);
        if (carried + rest.length > MAX_LINE_BYTES) {
          carry = [];
          carried = 0;
          skipping = true;
          oversized = true;
        } else {
          carry.push(rest);
          carried += rest.length;
        }
      }
    }
    if (carried > 0 && !skipping) finish(Buffer.concat(carry, carried));
  } catch {
    return "failed";
  } finally {
    await handle.close().catch(() => undefined);
  }
  return oversized ? "oversized" : "read";
}

interface CodexPass {
  /** `none`: no session logs on the computer, or none Skillet can list. */
  status: "read" | "none";
  /** When the oldest session started. */
  historyStart: number;
  /** Every session file in the window was read to its end. */
  complete: boolean;
  /** When not complete: how many days back every record was read. */
  readDays: number;
  /** The budget ran out, rather than a file failing. */
  timedOut: boolean;
  /** Entry index to its newest run in the window. */
  lastRun: Map<number, number>;
  /** Entries a record named in a way this reader doesn't know. */
  unrecognized: Set<number>;
  /** A line too long to read was skipped, so no entry can be vouched for. */
  oversized: boolean;
}

function emptyPass(window: Window): CodexPass {
  return {
    status: "none",
    historyStart: window.until,
    complete: false,
    readDays: 0,
    timedOut: false,
    lastRun: new Map(),
    unrecognized: new Set(),
    oversized: false,
  };
}

async function readCodex(
  codexDir: string,
  targets: CodexTargets,
  window: Window,
  clock: () => number,
  budgetMs: number,
): Promise<CodexPass> {
  const started = clock();
  const expired = (): boolean => clock() - started >= budgetMs;
  const pass = emptyPass(window);

  const listing: Listing = { files: [], missed: false };
  await listSessions(join(codexDir, "sessions"), 0, listing);
  await listSessions(join(codexDir, "archived_sessions"), 0, listing);
  if (listing.files.length === 0) return pass;
  pass.status = "read";
  pass.historyStart = listing.files.reduce((min, file) => Math.min(min, file.started), Number.POSITIVE_INFINITY);

  const ran = (index: number, at: number | null): void => {
    if (at === null) {
      // A run Skillet can't date can't vouch for anything.
      pass.unrecognized.add(index);
      return;
    }
    if (at < window.since) return;
    pass.lastRun.set(index, Math.max(pass.lastRun.get(index) ?? at, at));
  };
  const unknown = (index: number, at: number | null): void => {
    if (at === null || at >= window.since) pass.unrecognized.add(index);
  };
  const apply = (item: CodexItem, at: number | null): void => {
    switch (item.kind) {
      case "preamble":
        return;
      case "exec":
        for (const index of readsIn(item.command, targets)) ran(index, at);
        return;
      case "user":
        for (const text of item.texts) {
          for (const index of mentionsIn(text, targets)) ran(index, at);
          if (text.includes(SKILL_ENTRYPOINT)) for (const index of namedIn(text, targets)) unknown(index, at);
        }
        return;
      case "other":
        eachString(item.value, (text) => {
          if (text.includes(SKILL_ENTRYPOINT)) for (const index of namedIn(text, targets)) unknown(index, at);
        });
        return;
    }
  };
  const wants = (line: Buffer): boolean =>
    line.indexOf(SKILL_MD_BYTES) !== -1 ||
    (targets.mentionInLine !== null && line.indexOf(DOLLAR) !== -1 && line.indexOf(USER_BYTES) !== -1);
  const take = (text: string): void => {
    if (!text.includes(SKILL_ENTRYPOINT) && !(targets.mentionInLine?.test(text) ?? false)) return;
    let record: unknown;
    try {
      record = JSON.parse(text);
    } catch {
      // Not a record, such as a line still being written: whatever it names stays unknown.
      for (const index of namedIn(text, targets)) pass.unrecognized.add(index);
      return;
    }
    const at = isFields(record) ? timeOf(record["timestamp"]) : null;
    for (const item of itemsOf(record)) apply(item, at);
  };

  // Every record written after `coveredFrom` has been read; null while nothing is missing.
  let coveredFrom: number | null = listing.missed ? window.until : null;
  if (targets.folders.size > 0) {
    const inWindow = listing.files
      .filter((file) => file.mtime >= window.since)
      .sort((a, b) => b.mtime - a.mtime || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    for (const file of inWindow) {
      const outcome = expired() ? "expired" : await readLines(file, wants, take, expired);
      if (outcome === "expired") {
        pass.timedOut = true;
        coveredFrom ??= file.mtime;
        break;
      }
      if (outcome === "failed") coveredFrom ??= file.mtime;
      if (outcome === "oversized") pass.oversized = true;
    }
  }
  pass.complete = coveredFrom === null;
  if (coveredFrom !== null) pass.readDays = daysBetween(Math.max(coveredFrom, pass.historyStart), window.until);
  return pass;
}

function codexEvidence(index: number, entry: MapScanEntry, pass: CodexPass, window: Window): ToolEvidence {
  const lastRun = pass.lastRun.get(index) ?? null;
  const copies = entry.locations.filter((l) => l.tools.includes(CODEX));
  const untracked = copies.length === 0 || copies.some((l) => l.source === "app");
  let gap: MapUsageGap | null = null;
  if (pass.status === "none") gap = { tool: CODEX, reason: "no-history" };
  else if (untracked) gap = { tool: CODEX, reason: "untracked" };
  else if (!pass.complete) gap = { tool: CODEX, reason: "not-all-read", days: pass.readDays };
  else if (pass.historyStart > window.since) {
    gap = { tool: CODEX, reason: "short-history", days: daysBetween(pass.historyStart, window.until) };
  } else if (pass.oversized || pass.unrecognized.has(index)) gap = { tool: CODEX, reason: "unrecognized" };
  return { lastRun, gap };
}

// ---------------------------------------------------------------------------
// Skillet
// ---------------------------------------------------------------------------

function routeTimes(history: RouteHistory): Map<string, number> {
  const times = new Map<string, number>();
  const skills: unknown = history?.skills;
  if (!isFields(skills)) return times;
  for (const [ref, row] of Object.entries(skills)) {
    const at = isFields(row) ? timeOf(row["lastUsed"]) : null;
    if (at === null) continue;
    const key = ref.trim().toLowerCase();
    times.set(key, Math.max(times.get(key) ?? at, at));
  }
  return times;
}

/** The refs `/skillet` records a Skillet-managed copy under: `@maker/slug`, or the slug of an import. */
function skilletRefs(entry: MapScanEntry): string[] {
  const refs: string[] = [];
  for (const { skillet } of entry.locations) {
    if (skillet) refs.push((skillet.maker ? `@${skillet.maker}/${skillet.slug}` : skillet.slug).toLowerCase());
  }
  return unique(refs);
}

// ---------------------------------------------------------------------------
// Marks and words
// ---------------------------------------------------------------------------

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function listOf(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function gapText(gaps: readonly MapUsageGap[]): string {
  const sentences: string[] = [];
  for (const reason of GAP_ORDER) {
    const these = gaps.filter((gap) => gap.reason === reason);
    if (these.length === 0) continue;
    const names = listOf(these.map((gap) => label(gap.tool)));
    const keeps = these.length === 1 ? "keeps" : "keep";
    switch (reason) {
      case "no-history":
        sentences.push(`${names} ${keeps} no history Skillet can read.`);
        break;
      case "untracked":
        sentences.push(`${names} ${keeps} no record of skills in this folder.`);
        break;
      case "short-history":
        for (const gap of these) sentences.push(`${label(gap.tool)} has ${plural(gap.days ?? 0, "day")} of records.`);
        break;
      case "not-all-read":
        for (const gap of these) {
          sentences.push(
            gap.days
              ? `Skillet read only the last ${plural(gap.days, "day")} of ${label(gap.tool)} records.`
              : `Skillet couldn't read ${label(gap.tool)} records.`,
          );
        }
        break;
      case "capped":
        sentences.push(`${names}'s record is full and doesn't list this skill.`);
        break;
      case "unrecognized":
        sentences.push(`${names}'s records for this skill weren't recognized.`);
        break;
    }
  }
  return sentences.join(" ");
}

function ranText(at: number, until: number): string {
  const days = daysBetween(at, until);
  return days === 0 ? "Ran today." : days === 1 ? "Ran yesterday." : `Ran ${days} days ago.`;
}

interface Sources {
  window: Window;
  claude: ClaudeRecord | null;
  codex: CodexPass;
  routes: Map<string, number>;
}

function markEntry(entry: MapScanEntry, index: number, sources: Sources): MapUsageMark {
  const { window } = sources;
  const runs: { source: string; at: number }[] = [];
  const gaps: MapUsageGap[] = [];
  const loaders = unique(entry.tools);
  for (const tool of loaders) {
    let evidence: ToolEvidence;
    if (tool === CLAUDE) evidence = claudeEvidence(entry, sources.claude, window);
    else if (tool === CODEX) evidence = codexEvidence(index, entry, sources.codex, window);
    else evidence = { lastRun: null, gap: { tool, reason: "no-history" } };
    if (evidence.lastRun !== null) runs.push({ source: tool, at: evidence.lastRun });
    if (evidence.gap !== null) gaps.push(evidence.gap);
  }
  for (const ref of skilletRefs(entry)) {
    const at = sources.routes.get(ref);
    if (at !== undefined) runs.push({ source: SKILLET, at });
  }

  const lastRunAt = runs.reduce<number | null>((max, run) => (max === null || run.at > max ? run.at : max), null);
  const recent = runs.filter((run) => run.at >= window.since);
  if (recent.length > 0) {
    const newest = Math.max(...recent.map((run) => run.at));
    return {
      state: "used",
      reason: null,
      ranIn: unique(recent.map((run) => run.source)),
      lastRunAt,
      gaps: [],
      text: ranText(newest, window.until),
    };
  }
  if (loaders.length > 0 && gaps.length === 0) {
    return {
      state: "unused",
      reason: "no-recent-run",
      ranIn: [],
      lastRunAt,
      gaps: [],
      text:
        lastRunAt === null
          ? `No run in ${MAP_USAGE_WINDOW_DAYS} days.`
          : `No run in ${MAP_USAGE_WINDOW_DAYS} days. Last ran ${plural(daysBetween(lastRunAt, window.until), "day")} ago.`,
    };
  }
  const lead = GAP_ORDER.find((reason) => gaps.some((gap) => gap.reason === reason)) ?? "no-history";
  return {
    state: "unknown",
    reason: lead,
    ranIn: [],
    lastRunAt,
    gaps,
    text: gaps.length > 0 ? gapText(gaps) : "No AI tool here loads this skill.",
  };
}

function claudeLine(record: ClaudeRecord | null, window: Window): MapUsageTool {
  if (record === null) {
    return { tool: CLAUDE, history: "none", reasons: ["no-history"], text: "Claude Code keeps no history Skillet can read." };
  }
  const full = " Its record is full, so skills missing from it stay unknown.";
  const reasons: MapUsageGapReason[] = [];
  let line: MapUsageTool;
  if (record.since > window.since) {
    const days = daysBetween(record.since, window.until);
    reasons.push("short-history");
    line = { tool: CLAUDE, history: "short", days, reasons, text: `Claude Code has ${plural(days, "day")} of records.` };
  } else {
    line = { tool: CLAUDE, history: "read", reasons, text: `Read ${MAP_USAGE_WINDOW_DAYS} days of Claude Code records.` };
  }
  if (record.capped) {
    reasons.push("capped");
    line.text += full;
  }
  return line;
}

function codexLine(pass: CodexPass, window: Window, unrecognized: number): MapUsageTool {
  if (pass.status === "none") {
    return { tool: CODEX, history: "none", reasons: ["no-history"], text: "Codex keeps no history Skillet can read." };
  }
  const reasons: MapUsageGapReason[] = [];
  let line: MapUsageTool;
  if (!pass.complete) {
    reasons.push("not-all-read");
    const days = pass.readDays;
    const text = pass.timedOut
      ? days > 0
        ? `Skillet read the last ${plural(days, "day")} of Codex records before its time ran out.`
        : "Skillet ran out of time before reading Codex records."
      : days > 0
        ? `Skillet could read only the last ${plural(days, "day")} of Codex records.`
        : "Skillet couldn't read every Codex record.";
    line = { tool: CODEX, history: "short", days, reasons, text };
  } else if (pass.historyStart > window.since) {
    const days = daysBetween(pass.historyStart, window.until);
    reasons.push("short-history");
    line = { tool: CODEX, history: "short", days, reasons, text: `Codex has ${plural(days, "day")} of records.` };
  } else {
    line = { tool: CODEX, history: "read", reasons, text: `Read ${MAP_USAGE_WINDOW_DAYS} days of Codex records.` };
  }
  if (unrecognized > 0) {
    reasons.push("unrecognized");
    line.text += ` Codex's records weren't recognized for ${plural(unrecognized, "skill")}.`;
  }
  return line;
}

/** Mark every entry of a scan used, unused or unknown, from records on this computer (see the module comment). */
export async function readMapUsage(opts: MapUsageOptions): Promise<MapUsageResult> {
  const clock = opts.clock ?? (() => Date.now());
  const until = opts.now ?? clock();
  const window: Window = { since: until - WINDOW_MS, until };
  const home = opts.home ?? homedir();
  const entries = opts.scan.entries;
  const tools = unique([...(opts.scan.tools ?? []), ...entries.flatMap((entry) => entry.tools)]);

  const claudeDir =
    opts.claudeConfigDir !== undefined
      ? opts.claudeConfigDir
      : CLAUDE_ENV_ROOT !== null
        ? dirname(CLAUDE_ENV_ROOT)
        : null;
  const claude = tools.includes(CLAUDE) ? await readClaudeRecord(join(claudeDir ?? home, ".claude.json")) : null;

  let codex = emptyPass(window);
  if (tools.includes(CODEX)) {
    try {
      codex = await readCodex(
        opts.codexDir ?? join(home, ".codex"),
        codexTargets(entries),
        window,
        clock,
        opts.codexBudgetMs ?? CODEX_READ_BUDGET_MS,
      );
    } catch {
      codex = emptyPass(window);
    }
  }

  let routes = new Map<string, number>();
  try {
    routes = routeTimes(opts.routeHistory ?? (await readRouteHistory()));
  } catch {
    // No route history: Skillet adds no runs.
  }

  const sources: Sources = { window, claude, codex, routes };
  const marks: Record<string, MapUsageMark> = {};
  let unrecognized = 0;
  entries.forEach((entry, index) => {
    const mark = markEntry(entry, index, sources);
    marks[entry.key] = mark;
    if (mark.state === "unknown" && mark.gaps.some((gap) => gap.tool === CODEX && gap.reason === "unrecognized")) {
      unrecognized++;
    }
  });

  const lines = tools.map((tool): MapUsageTool => {
    if (tool === CLAUDE) return claudeLine(claude, window);
    if (tool === CODEX) return codexLine(codex, window, unrecognized);
    return { tool, history: "none", reasons: ["no-history"], text: `${label(tool)} keeps no history Skillet can read.` };
  });
  return { marks, tools: lines, since: window.since, until };
}
