/**
 * `skillet map`: every skill on this machine, sorted into jobs, in the browser
 * (plan U6, KTD1 KTD5; R2 R5 R15, AE4). The pasted line is
 * `npx -y skilletmd map`.
 *
 * Device tier with no pairing gate: the scan only reads, and nothing about the
 * person's skills is written to disk or sent anywhere before Save. The scan
 * and the usage pass run with the adapter set the desktop app uses, the global
 * adapters plus the baseline readers and no project adapter, so a repo's own
 * `.agents/skills` never joins.
 *
 * The map reaches the browser through a page served on 127.0.0.1
 * (../map/loopback-server.ts), which frames skillet.md/map/embed and hands it
 * the scan by postMessage. The payload holds no path, and `connected` says
 * only whether this machine already has a Skillet connection on disk, read
 * from its own files with no network call; never the account.
 *
 * Save runs an injected handler (U11 builds the real one). Until then Save
 * tells the frame it isn't ready, and nothing changes. Ctrl+C, or 30 minutes
 * with nothing done in the map, tells the frame `ended`, closes the server and
 * says nothing changed.
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { sep } from "node:path";
import type { Command } from "commander";
import {
  MAP_USAGE_WINDOW_DAYS,
  deviceFilePath,
  readMapUsage,
  readSessionFileToken,
  scanMap,
  type MapScanEntry,
  type MapScanResult,
  type MapUnreadable,
  type MapUnreadableReason,
  type MapUsageResult,
} from "@skillet/core";
import { JOBS, TOOLS_SECTION, type JobId } from "@skillet/protocol/jobs";
import {
  KIT_MAP_DESCRIPTION_MAX,
  KIT_MAP_NAME_MAX,
  parseKitMapScan,
  type KitMapEntry,
  type KitMapFlag,
  type KitMapFrom,
  type KitMapLooked,
  type KitMapScan,
  type KitMapSkillet,
  type KitMapSource,
  type KitMapToolCopies,
  type KitMapUnchecked,
} from "@skillet/protocol/kit-map";
import { tryToSkillId } from "@skillet/protocol/skill-id";
import { ALL_ADAPTERS, BASELINE_READER_ADAPTERS } from "../cli-context.js";
import { webBaseUrl } from "../cli-command-tier.js";
import { dim, fail } from "../cli-colors.js";
import { openBrowserUrl } from "../open-browser-url.js";
import { startMapServer, type MapSaveHandler } from "../map/loopback-server.js";

export type { MapFrameLink, MapSaveHandler } from "../map/loopback-server.js";

/** How long the map stays open with nothing done in it. */
export const MAP_IDLE_MS = 30 * 60_000;

// The protocol's own limits (kit-map.ts): a payload past them is rejected whole.
const MAX_ENTRIES = 10_000;
const MAX_COPIES = 1_000;
const TOOL_RE = /^[a-z][a-z0-9-]{0,31}$/;
/** The sources a merge is written from (KTD12); the rest never carry a merge flag. */
const MERGE_SOURCES: ReadonlySet<KitMapSource> = new Set<KitMapSource>(["local", "skillet-imported", "skillet-added"]);
const SKILLET_SOURCES: ReadonlySet<KitMapSource> = new Set<KitMapSource>([
  "skillet-imported",
  "skillet-added",
  "skillet-own",
]);
/** Names and places the text summary lists before it says how many more. */
const LIST_MAX = 5;

/** What one scan of this machine gives the map. */
export interface MapReading {
  /** What the frame draws. It holds no path. */
  payload: KitMapScan;
  /** One line per AI tool that loads a skill and whose history Skillet couldn't fully read. */
  usageNotes: string[];
  /** Every place the scan couldn't check, with its path, for the terminal only. */
  unreadable: MapUnreadable[];
  /** The home the scan read, to shorten paths in the terminal. */
  home: string;
}

// ---------------------------------------------------------------------------
// The scan payload
// ---------------------------------------------------------------------------

function hasControl(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** One line: control characters and runs of whitespace become one space. */
function oneLine(text: string): string {
  let out = "";
  for (const ch of text) out += hasControl(ch) ? " " : ch;
  return out.replace(/\s+/g, " ").trim();
}

/** At most `max` UTF-16 units, never splitting a surrogate pair. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const code = text.charCodeAt(max - 1);
  return text.slice(0, code >= 0xd800 && code <= 0xdbff ? max - 1 : max);
}

/** A name the frame shows: one line, at most {@link KIT_MAP_NAME_MAX}, never blank. */
function wireName(text: string, fallback: string): string {
  const name = cut(oneLine(text), KIT_MAP_NAME_MAX).trim();
  return name.length > 0 ? name : fallback;
}

/** A plugin, organization or folder name: one name with no folder in it. */
function wireSingleName(text: string, fallback: string): string {
  const name = cut(oneLine(text).replace(/[\\/]/g, "-"), KIT_MAP_NAME_MAX).trim();
  return name.length > 0 && name !== "." && name !== ".." ? name : fallback;
}

function fromOf(entry: MapScanEntry): KitMapFrom | undefined {
  const owner = entry.owner;
  switch (entry.source) {
    case "plugin":
      return {
        kind: "plugin",
        name: wireSingleName(owner?.kind === "plugin" ? owner.name : "", "a"),
        on: owner?.kind === "plugin" ? owner.enabled : null,
      };
    case "synced":
      // A skill straight inside `synced/` has no organization folder to name.
      return {
        kind: "organization",
        name: wireSingleName(owner?.kind === "organization" ? owner.name : "", "an organization"),
        on: null,
      };
    case "app":
      return { kind: "app", name: wireSingleName(owner?.kind === "app" ? owner.name : "", "app"), on: null };
    default:
      return undefined;
  }
}

/** `@maker/slug` in its canonical form, or null when the copy has no maker or the ref isn't canonical. */
function refOf(maker: string | null, slug: string): string | null {
  if (maker === null) return null;
  const ref = `@${maker}/${slug}`;
  const id = tryToSkillId(ref);
  return id !== null && `@${id.replace(":", "/")}` === ref ? ref : null;
}

function skilletOf(entry: MapScanEntry, name: string): KitMapSkillet | undefined {
  if (!SKILLET_SOURCES.has(entry.source)) return undefined;
  const copy =
    entry.locations.find((l) => l.source === entry.source && l.skillet !== null) ??
    entry.locations.find((l) => l.skillet !== null);
  const info = copy?.skillet ?? null;
  return { ref: info ? refOf(info.maker, info.slug) : null, name };
}

function toolsOf(entry: MapScanEntry): KitMapToolCopies[] {
  const tools: KitMapToolCopies[] = [];
  for (const tool of entry.tools) {
    if (!TOOL_RE.test(tool) || tools.some((t) => t.tool === tool)) continue;
    const copies = Math.min(Math.max(entry.copies[tool] ?? 1, 1), MAX_COPIES);
    tools.push({ tool, copies });
  }
  return tools;
}

function toWireEntry(entry: MapScanEntry, usage: MapUsageResult): KitMapEntry {
  const name = wireName(entry.name, "Unnamed skill");
  const mark = usage.marks[entry.key];
  const wire: KitMapEntry = {
    key: entry.key,
    name,
    description: cut(oneLine(entry.description), KIT_MAP_DESCRIPTION_MAX),
    source: entry.source,
    tools: toolsOf(entry),
    job: entry.jobId,
    usage: mark ? { state: mark.state, reason: mark.reason } : { state: "unknown", reason: "no-history" },
  };
  const from = fromOf(entry);
  if (from) wire.from = from;
  // Only the person's own folders back up, so only they say why one can't.
  const noBackup = entry.flags.cantBackUp[0];
  if (entry.source === "local" && noBackup !== undefined) wire.noBackup = { reason: noBackup } satisfies KitMapFlag;
  const noMerge = entry.flags.cantMerge[0];
  if (MERGE_SOURCES.has(entry.source) && noMerge !== undefined) wire.noMerge = { reason: noMerge } satisfies KitMapFlag;
  const skillet = skilletOf(entry, name);
  if (skillet) wire.skillet = skillet;
  return wire;
}

function lookedOf(usage: MapUsageResult): KitMapLooked[] {
  const looked: KitMapLooked[] = [];
  for (const tool of usage.tools) {
    if (!TOOL_RE.test(tool.tool) || looked.some((l) => l.tool === tool.tool)) continue;
    looked.push({ tool: tool.tool, history: tool.history });
  }
  return looked;
}

function uncheckedOf(row: MapUnreadable): KitMapUnchecked {
  const place: KitMapUnchecked = {
    reason: row.reason,
    tools: [...new Set(row.tools)].filter((tool) => TOOL_RE.test(tool)),
  };
  if (row.plugin !== undefined) place.plugin = wireSingleName(row.plugin, "plugin");
  return place;
}

const oneEntry = (entry: KitMapEntry): boolean =>
  parseKitMapScan({ entries: [entry], looked: [], unchecked: [] }) !== null;

/**
 * The scan as the frame takes it: no path, names and descriptions cut to the
 * protocol's limits, and `connected` only when this machine has a connection.
 * An entry the protocol would still refuse is left out rather than blanking
 * the whole map.
 */
export function toKitMapScan(scan: MapScanResult, usage: MapUsageResult, connected: boolean): KitMapScan {
  const payload: KitMapScan = {
    entries: scan.entries
      .slice(0, MAX_ENTRIES)
      .map((entry) => toWireEntry(entry, usage))
      .filter(oneEntry),
    looked: lookedOf(usage),
    unchecked: scan.unreadable.slice(0, MAX_ENTRIES).map(uncheckedOf),
  };
  if (connected) payload.connected = true;
  if (parseKitMapScan(payload) === null) throw new Error("The scan couldn't be turned into a map.");
  return payload;
}

/** Each AI tool that loads a skill and couldn't tell used from unused, in its own words. */
function usageNotes(usage: MapUsageResult, entries: readonly MapScanEntry[]): string[] {
  const loading = new Set(entries.flatMap((entry) => entry.tools));
  return usage.tools
    .filter((tool) => loading.has(tool.tool) && (tool.history !== "read" || tool.reasons.length > 0))
    .map((tool) => tool.text);
}

/**
 * Whether this machine already has a Skillet connection: a device token (not
 * the retired anonymous one) or a signed-in session, read from its own files.
 * No network call, and nothing is written: the core reader that cleans up an
 * anonymous device file is not used here.
 */
export async function hasLocalConnection(): Promise<boolean> {
  try {
    const raw = JSON.parse(await readFile(deviceFilePath(), "utf8")) as unknown;
    if (typeof raw === "object" && raw !== null) {
      const file = raw as { device_token?: unknown; label?: unknown };
      if (typeof file.device_token === "string" && file.device_token.length > 0 && file.label !== "anonymous") {
        return true;
      }
    }
  } catch {
    // No device file, or not one Skillet wrote: not paired by device.
  }
  return (await readSessionFileToken()).length > 0;
}

/** Scan this machine, read its usage records and its connection: all local, all read-only. */
export async function readMap(): Promise<MapReading> {
  const home = homedir();
  const scan = await scanMap({ adapters: [...ALL_ADAPTERS, ...BASELINE_READER_ADAPTERS], home });
  const usage = await readMapUsage({ scan, home });
  const connected = await hasLocalConnection();
  return {
    payload: toKitMapScan(scan, usage, connected),
    usageNotes: usageNotes(usage, scan.entries),
    unreadable: scan.unreadable,
    home,
  };
}

// ---------------------------------------------------------------------------
// Terminal copy
// ---------------------------------------------------------------------------

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** "Found 54 skills in 3 AI tools." */
export function countLine(payload: KitMapScan): string {
  const skills = payload.entries.length;
  if (skills === 0) return "Found no skills.";
  const tools = new Set(payload.entries.flatMap((entry) => entry.tools.map((t) => t.tool))).size;
  const found = `Found ${plural(skills, "skill")}`;
  return tools > 0 ? `${found} in ${plural(tools, "AI tool")}.` : `${found}.`;
}

function nameList(names: readonly string[]): string {
  if (names.length <= LIST_MAX) return names.join(", ");
  return `${names.slice(0, LIST_MAX).join(", ")} and ${names.length - LIST_MAX} more`;
}

const PLACE_WHY: Readonly<Record<MapUnreadableReason, string>> = {
  "protected-folder": "macOS asks before Skillet reads it",
  "permission-denied": "Skillet isn't allowed to read it",
  "broken-link": "it links to a folder that's gone",
  "project-plugin": "it's a plugin installed for one project",
  "plugin-missing": "the plugin's files are missing",
  unparseable: "Skillet couldn't make sense of it",
  unreadable: "Skillet couldn't read it",
};

function shortPath(path: string, home: string): string {
  if (path === home) return "~";
  return path.startsWith(home + sep) ? `~${path.slice(home.length)}` : path;
}

/**
 * The map's marks as text, for when the frame never loads: doubled jobs,
 * unused skills, empty jobs, what's not sorted, and what Skillet couldn't
 * check. Printed in the terminal only, so it may name local paths.
 */
export function textSummary(reading: MapReading): string[] {
  const { entries } = reading.payload;
  const lines = ["The map didn't load in the browser. What it found:"];
  if (entries.length === 0) {
    lines.push(`  No skills. All ${JOBS.length} jobs are empty.`);
  } else {
    const held = new Map<JobId, string[]>();
    const loose: string[] = [];
    for (const entry of entries) {
      if (entry.job === null) {
        loose.push(entry.name);
        continue;
      }
      const names = held.get(entry.job) ?? [];
      names.push(entry.name);
      held.set(entry.job, names);
    }
    for (const job of [...JOBS, ...TOOLS_SECTION.jobs]) {
      const names = held.get(job.id);
      // A job that holds one skill per platform or tool is never doubled.
      if (names && names.length > 1 && !job.many) lines.push(`  ${job.name} has ${names.length} skills: ${nameList(names)}`);
    }
    const unused = entries.filter((entry) => entry.usage.state === "unused").map((entry) => entry.name);
    if (unused.length > 0) lines.push(`  No run in ${MAP_USAGE_WINDOW_DAYS} days: ${nameList(unused)}`);
    const empty = JOBS.filter((job) => !held.has(job.id)).length;
    if (empty > 0) lines.push(`  ${empty} of ${JOBS.length} jobs have no skill.`);
    if (loose.length > 0) lines.push(`  Not sorted: ${nameList(loose)}`);
  }
  for (const note of reading.usageNotes) lines.push(`  ${note}`);
  const places = reading.unreadable.slice(0, LIST_MAX);
  for (const place of places) {
    const where = place.plugin ?? shortPath(place.path, reading.home);
    lines.push(`  Couldn't check ${where}: ${PLACE_WHY[place.reason] ?? PLACE_WHY.unreadable}.`);
  }
  const more = reading.unreadable.length - places.length;
  if (more > 0) lines.push(`  Skillet couldn't check ${plural(more, "more place")}.`);
  return lines;
}

function duration(ms: number): string {
  return ms >= 60_000 ? plural(Math.round(ms / 60_000), "minute") : plural(Math.max(1, Math.round(ms / 1000)), "second");
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/** Why a run ended: Ctrl+C, nothing done in the map for the idle wait, or a save handler finished it. */
export type MapStopReason = "interrupted" | "idle" | "finished";

export interface StartMapOptions {
  /** Open the address in the browser. The address is printed either way. Defaults to true. */
  open?: boolean;
  /** A scan to show instead of reading this machine. */
  reading?: MapReading;
  /** What Save does. Defaults to telling the frame Save isn't ready. */
  onSave?: MapSaveHandler;
  /** The site the frame comes from. Defaults to `SKILLET_WEB_URL`, else https://skillet.md. */
  webUrl?: string;
  openBrowser?: (url: string) => Promise<boolean>;
  print?: (line: string) => void;
  idleMs?: number;
  readyWaitMs?: number;
  /** Stop on SIGINT and SIGTERM. Defaults to true. */
  handleSignals?: boolean;
}

export interface MapRun {
  readonly url: string;
  readonly origin: string;
  readonly token: string;
  /** Resolves once the server has closed. */
  readonly done: Promise<MapStopReason>;
  stop(reason?: MapStopReason): Promise<void>;
}

/** Save before it's built (U11): the frame hears it isn't ready, and nothing changes. */
function notReadySave(print: (line: string) => void): MapSaveHandler {
  return (_drafts, link) => {
    link.status("failed", { reason: "not-ready" });
    print("Save isn't ready yet. Nothing changed.");
  };
}

/** Serve the map, open it, and wait (see the module comment). */
export async function startMap(opts: StartMapOptions = {}): Promise<MapRun> {
  const print = opts.print ?? ((line: string) => console.log(line));
  const reading = opts.reading ?? (await readMap());
  const idleMs = opts.idleMs ?? MAP_IDLE_MS;
  const handleSignals = opts.handleSignals ?? true;

  let resolveDone!: (reason: MapStopReason) => void;
  const done = new Promise<MapStopReason>((resolve) => {
    resolveDone = resolve;
  });
  let stopping: Promise<void> | null = null;
  let idleTimer: NodeJS.Timeout | null = null;
  let stop: (reason?: MapStopReason) => Promise<void> = async () => undefined;

  const server = await startMapServer({
    scan: reading.payload,
    webUrl: opts.webUrl ?? webBaseUrl(),
    onSave: opts.onSave ?? notReadySave(print),
    readyWaitMs: opts.readyWaitMs,
    onNoReady: () => {
      for (const line of textSummary(reading)) print(line);
    },
    onActivity: () => armIdle(),
    onFinish: () => void stop("finished"),
    onSaveError: (err) => print(fail(`Save stopped: ${err instanceof Error ? err.message : String(err)}`)),
  });

  const armIdle = (): void => {
    if (idleTimer) clearTimeout(idleTimer);
    if (stopping) return;
    idleTimer = setTimeout(() => {
      idleTimer = null;
      // A running Save re-arms the wait when it ends.
      if (!server.saving()) void stop("idle");
    }, idleMs);
  };

  const onSignal = (): void => {
    if (process.stdout.isTTY === true) print("");
    void stop("interrupted");
  };
  const detachSignals = (): void => {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  };

  stop = (reason: MapStopReason = "interrupted"): Promise<void> => {
    stopping ??= (async () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = null;
      detachSignals();
      // A finished Save leaves its last status on the frame; anything else tells it the map closed.
      await server.stop({ notify: reason !== "finished" });
      if (reason === "interrupted") print("Map closed. Nothing changed.");
      if (reason === "idle") print(`Map closed after ${duration(idleMs)} with no Save. Nothing changed.`);
      resolveDone(reason);
    })();
    return stopping;
  };

  print(countLine(reading.payload));
  let opened = false;
  if (opts.open ?? true) {
    try {
      opened = await (opts.openBrowser ?? openBrowserUrl)(server.url);
    } catch {
      opened = false;
    }
  }
  print(opened ? `Opened ${server.url}` : `Open ${server.url} to see your map.`);
  print(dim("Press Ctrl+C to close the map."));

  armIdle();
  if (handleSignals) {
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
  }
  return { url: server.url, origin: server.origin, token: server.token, done, stop: (reason) => stop(reason) };
}

export function registerMapCommand(program: Command): void {
  program
    .command("map")
    .description("See every skill on this machine sorted into jobs. No account needed")
    .option("--no-open", "Print the map's address without opening a browser")
    .option("--json", "Emit the scan as machine-readable JSON and exit")
    .action(async (opts: { open: boolean; json?: boolean }) => {
      if (opts.json === true) {
        const reading = await readMap();
        process.stdout.write(JSON.stringify({ ok: true, scan: reading.payload }, null, 2) + "\n");
        return;
      }
      const run = await startMap({ open: opts.open });
      await run.done;
    });
}
