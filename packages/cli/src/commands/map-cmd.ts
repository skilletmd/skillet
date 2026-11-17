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
 * the scan by postMessage. The payload holds no path. `connected` says this
 * machine holds a device token its account still takes, and then `pending`
 * lists the changes the account holds for it: one read of this machine's own
 * waiting changes, sending nothing about its skills. A machine with no device
 * token calls no one.
 *
 * Save is ../map/save-flow.ts (U11): it connects the machine if it needs to,
 * then backs up, makes the drafted fixes and saves the map. Ctrl+C, or 30
 * minutes with nothing done in the map, tells the frame `ended`, closes the
 * server and says whether anything changed. `--apply` makes this machine's
 * waiting changes with no map at all: what the app's sync runs.
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { sep } from "node:path";
import type { Command } from "commander";
import {
  MAP_USAGE_WINDOW_DAYS,
  REGISTRY_API,
  deviceFilePath,
  readDeviceFile,
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
  parseKitMapPendingChange,
  parseKitMapScan,
  type KitMapEntry,
  type KitMapFlag,
  type KitMapFrom,
  type KitMapLooked,
  type KitMapPendingChange,
  type KitMapScan,
  type KitMapSkillet,
  type KitMapSource,
  type KitMapToolCopies,
  type KitMapUnchecked,
} from "@skillet/protocol/kit-map";
import { tryToSkillId } from "@skillet/protocol/skill-id";
import { ALL_ADAPTERS, BASELINE_READER_ADAPTERS, REGISTRY_DEFAULT } from "../cli-context.js";
import { webBaseUrl } from "../cli-command-tier.js";
import { dim, fail, ok } from "../cli-colors.js";
import { failAuthRequired } from "../auth-required.js";
import { ExitCode } from "../exit-codes.js";
import { openBrowserUrl } from "../open-browser-url.js";
import { startMapServer, type MapSaveHandler } from "../map/loopback-server.js";
import {
  createMapSaveFlow,
  mapLeftText,
  requestSignal,
  runMapApplyOnly,
  saveSummary,
  type MapSaveFlow,
} from "../map/save-flow.js";

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
/** How long opening the map waits on the account for this machine's waiting changes. */
const ACCOUNT_WAIT_MS = 5_000;
const MAX_PENDING = 10_000;
/** No usage at all: what a saved map or a backup is built from, since usage never leaves the machine. */
const NO_USAGE: MapUsageResult = { marks: {}, tools: [], since: 0, until: 0 };

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
 * protocol's limits, and `connected` only when this machine has a connection,
 * with the account's waiting changes for it when there are any. An entry the
 * protocol would still refuse is left out rather than blanking the whole map.
 */
export function toKitMapScan(
  scan: MapScanResult,
  usage: MapUsageResult,
  connected: boolean,
  pending: readonly KitMapPendingChange[] = [],
): KitMapScan {
  const payload: KitMapScan = {
    entries: scan.entries
      .slice(0, MAX_ENTRIES)
      .map((entry) => toWireEntry(entry, usage))
      .filter(oneEntry),
    looked: lookedOf(usage),
    unchecked: scan.unreadable.slice(0, MAX_ENTRIES).map(uncheckedOf),
  };
  if (connected) {
    payload.connected = true;
    if (pending.length > 0) payload.pending = pending.slice(0, MAX_PENDING);
  }
  if (parseKitMapScan(payload) === null) throw new Error("The scan couldn't be turned into a map.");
  return payload;
}

/** The entries as the map shows them, with no usage: what Save backs up and saves from. */
export function wireEntries(scan: MapScanResult): KitMapEntry[] {
  return toKitMapScan(scan, NO_USAGE, false).entries;
}

/** Scan this machine with the adapter set the desktop app uses (see the module comment). */
export function scanThisMachine(): Promise<MapScanResult> {
  return scanMap({ adapters: [...ALL_ADAPTERS, ...BASELINE_READER_ADAPTERS], home: homedir() });
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

export interface AccountConnection {
  connected: boolean;
  /** The changes the account holds for this machine; absent when it couldn't be asked. */
  pending?: KitMapPendingChange[];
}

/**
 * Whether this machine can save as itself: a device token on disk that its
 * account still takes. Session-only or anonymous files count as not
 * connected, so Save connects the machine through the map session. When it
 * is connected, the same read brings the changes waiting for it. The request
 * carries the token and nothing about the skills; a machine with no token
 * makes no request at all. An account that can't be reached leaves the
 * machine connected with nothing listed.
 */
export async function readConnection(
  opts: { registryUrl?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<AccountConnection> {
  if (!(await hasLocalConnection())) return { connected: false };
  const device = await readDeviceFile();
  if (!device?.device_token || device.label === "anonymous") return { connected: false };
  const registryUrl = (opts.registryUrl ?? REGISTRY_DEFAULT).replace(/\/+$/, "");
  const request = requestSignal(undefined, opts.timeoutMs ?? ACCOUNT_WAIT_MS);
  try {
    const res = await (opts.fetchImpl ?? globalThis.fetch)(`${registryUrl}${REGISTRY_API}/kit-map/changes`, {
      headers: { accept: "application/json", authorization: `Bearer ${device.device_token}` },
      signal: request.signal,
    });
    if (res.status === 401 || res.status === 403) return { connected: false };
    if (!res.ok) return { connected: true };
    const body = (await res.json().catch(() => null)) as { changes?: unknown } | null;
    const list = Array.isArray(body?.changes) ? (body.changes as unknown[]) : [];
    const pending = list
      .slice(0, MAX_PENDING)
      .map((item) => parseKitMapPendingChange(item))
      .filter((change): change is KitMapPendingChange => change !== null);
    return { connected: true, pending };
  } catch {
    return { connected: true };
  } finally {
    request.done();
  }
}

/** Scan this machine and read its usage records, both local and read-only, and ask the account about it if it's connected. */
export async function readMap(opts: { registryUrl?: string; fetchImpl?: typeof fetch } = {}): Promise<MapReading> {
  const home = homedir();
  const scan = await scanThisMachine();
  const usage = await readMapUsage({ scan, home });
  const account = await readConnection(opts);
  return {
    payload: toKitMapScan(scan, usage, account.connected, account.pending),
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
  /** What Save does. Defaults to Save itself (../map/save-flow.ts), against `registryUrl`. */
  onSave?: MapSaveHandler;
  /** With an injected `onSave`: whether it changed anything, so closing doesn't say nothing changed. */
  saveChanged?: () => boolean;
  /** The registry Save talks to. Defaults to `SKILLET_REGISTRY_URL`, else https://registry.skillet.md. */
  registryUrl?: string;
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
  /** The Save this run made itself; null when `onSave` was injected. */
  readonly save: MapSaveFlow | null;
  stop(reason?: MapStopReason): Promise<void>;
}

/** Serve the map, open it, and wait (see the module comment). */
export async function startMap(opts: StartMapOptions = {}): Promise<MapRun> {
  const print = opts.print ?? ((line: string) => console.log(line));
  const registryUrl = opts.registryUrl ?? REGISTRY_DEFAULT;
  const reading = opts.reading ?? (await readMap({ registryUrl }));
  const idleMs = opts.idleMs ?? MAP_IDLE_MS;
  const handleSignals = opts.handleSignals ?? true;
  const save =
    opts.onSave === undefined
      ? createMapSaveFlow({
          registryUrl,
          entries: reading.payload.entries,
          connected: reading.payload.connected === true,
          rescan: scanThisMachine,
          wire: wireEntries,
          print,
        })
      : null;
  const saveChanged = save ? save.changed : (opts.saveChanged ?? (() => false));

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
    onSave: opts.onSave ?? save!.handler,
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
      // A Save that changed things says what it did and what's left itself.
      const changed = saveChanged();
      if (reason === "interrupted") print(changed ? "Map closed." : "Map closed. Nothing changed.");
      if (reason === "idle") {
        print(changed ? `Map closed after ${duration(idleMs)}.` : `Map closed after ${duration(idleMs)} with no Save. Nothing changed.`);
      }
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
  return { url: server.url, origin: server.origin, token: server.token, done, save, stop: (reason) => stop(reason) };
}

/**
 * `skillet map --apply` (see the module comment). Exits non-zero unless
 * everything waiting is done. `--json` is how the app's sync tick runs it
 * (U13): a live Save lock answers `locked` at once, so the app skips that
 * tick and tries again instead of waiting the Save out (KTD10). A person at
 * the terminal waits for the Save.
 */
async function applyCommand(json: boolean): Promise<void> {
  const print = (line: string) => console.log(line);
  const result = await runMapApplyOnly({
    registryUrl: REGISTRY_DEFAULT,
    rescan: scanThisMachine,
    wire: wireEntries,
    ...(json ? { lockWaitMs: 0 } : { print }),
  });
  if (result.result === "not-connected") failAuthRequired({ json });
  if (result.result === "locked") {
    const message = "Another Save is still running on this machine.";
    if (json) process.stdout.write(JSON.stringify({ ok: false, error: message, code: "locked" }, null, 2) + "\n");
    else console.error(fail(message));
    process.exitCode = ExitCode.ERROR;
    return;
  }
  const done = result.result === "applied";
  if (json) {
    const data = {
      result: result.result,
      ...(result.reason !== undefined ? { reason: result.reason } : {}),
      counts: result.counts,
      left: result.left,
      not_backed_up: result.notBackedUp,
      kept: result.kept,
      unremoved: result.unremoved,
      refused: result.refused,
      trash_run: result.trashRun,
      // Whether this computer or the account changed: the app rescans its map when it did.
      changed: result.changed,
    };
    process.stdout.write(JSON.stringify({ ok: done, data }, null, 2) + "\n");
  } else {
    for (const line of saveSummary(result)) print(line);
    const left = mapLeftText(result.left);
    if (done) print(result.changed ? ok("Made this machine's waiting changes.") : "Nothing is waiting for this machine.");
    else print(fail(`Stopped partway.${left ? ` Left to do: ${left}.` : ""} Run \`skillet map --apply\` again to finish.`));
  }
  if (!done) process.exitCode = ExitCode.ERROR;
}

export function registerMapCommand(program: Command): void {
  program
    .command("map")
    .description("See every skill on this machine sorted into jobs. No account needed")
    .option("--no-open", "Print the map's address without opening a browser")
    .option("--json", "Emit the scan as machine-readable JSON and exit")
    .option("--apply", "Make the changes waiting for this machine and exit (connected machines)")
    .action(async (opts: { open: boolean; json?: boolean; apply?: boolean }) => {
      if (opts.apply === true) {
        await applyCommand(opts.json === true);
        return;
      }
      if (opts.json === true) {
        const reading = await readMap();
        process.stdout.write(JSON.stringify({ ok: true, scan: reading.payload }, null, 2) + "\n");
        return;
      }
      const run = await startMap({ open: opts.open });
      await run.done;
      // Ctrl+C mid-Save: let it reach a safe stop before the process exits.
      await run.save?.settled();
      if (run.save?.failed()) process.exitCode = ExitCode.ERROR;
    });
}
