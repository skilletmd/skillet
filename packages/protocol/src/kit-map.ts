/**
 * The kit map's shapes: what a scan found, the fixes drafted on it, the saved
 * map, the changes that wait for a computer, and the messages between the
 * three windows that show it.
 *
 * `skillet map` serves a page on the person's computer (the loopback page),
 * which frames the map from skillet.md (the frame), and Save opens a
 * skillet.md tab of its own (the save tab). The loopback page sends `scan`,
 * `session` and `status`; the frame sends `ready`, `drafts` and `save`; the
 * save tab and the frame trade `proof-request` and `proof`. Every message
 * carries `v`, and a version this module doesn't know is rejected, so a newer
 * frame and an older CLI stop instead of guessing. `kitMapMessageVersion` tells
 * that apart from noise, so the side that rejects can ask for an update.
 *
 * Nothing here holds a path. An entry says where it came from by source, tool
 * and plugin or organization name, and applying a change finds its folders
 * through a fresh scan on that computer. The saved map (one document per
 * account) holds entries and their jobs, never usage or its reasons, which stay
 * on the computer. Pending changes are records of their own, and a kind this
 * client can't read parses as `unknown` so it can be skipped.
 *
 * Fixes are drafts until Save: an ordered list whose meaning comes from the
 * whole list and the scan it was drafted on (`deriveKitMapChanges`). The web
 * page and the CLI both call it, so the map shows what Save sends and the CLI
 * makes the same changes.
 *
 * Node-free, and exported as `@skillet/protocol/kit-map`, because the CLI, the
 * desktop webview and the browser all read these shapes.
 */

import { isJobId, type JobId } from './jobs.js';
import { tryToSkillId } from './skill-id.js';

/** The version every bridge message carries. */
export const KIT_MAP_VERSION = 1;
type Version = typeof KIT_MAP_VERSION;

/** A name longer than this is rejected; the scan shortens names before sending. */
export const KIT_MAP_NAME_MAX = 200;
/** The scan cuts descriptions to this (the Agent Skills limit for a description). */
export const KIT_MAP_DESCRIPTION_MAX = 1024;

const MAX_ENTRIES = 10_000;
const MAX_DRAFTS = 10_000;
const MAX_TOOLS = 64;
const MAX_COPIES = 1_000;
const MAX_FILE_NAME = 255;

// ---------------------------------------------------------------------------
// The scan
// ---------------------------------------------------------------------------

/**
 * Where a skill came from, which decides what Remove does and whether Save
 * backs it up (the plan's folder rules):
 * - `local`: a folder of the person's own. Remove moves it to the trash, and Save backs it up.
 * - `skillet-imported`: an import Skillet keeps (`_local--<slug>`). Remove takes it out of the kit store.
 * - `skillet-added`: another maker's skill, added from Skillet. Remove takes it out of the kit.
 * - `skillet-own`: the person's own published skill. Sync restores it, so the map names its page.
 * - `synced`: synced from an organization. The map names the organization.
 * - `app`: put there by another app. The map names its folder.
 * - `plugin`: came inside a plugin. Never changed: the map names the plugin to turn off.
 */
export type KitMapSource =
  | 'local'
  | 'skillet-imported'
  | 'skillet-added'
  | 'skillet-own'
  | 'synced'
  | 'app'
  | 'plugin';

export const KIT_MAP_SOURCES: readonly KitMapSource[] = Object.freeze([
  'local',
  'skillet-imported',
  'skillet-added',
  'skillet-own',
  'synced',
  'app',
  'plugin',
]);

const REMOVABLE: ReadonlySet<KitMapSource> = new Set<KitMapSource>(['local', 'skillet-imported', 'skillet-added']);
const SKILLET: ReadonlySet<KitMapSource> = new Set<KitMapSource>(['skillet-imported', 'skillet-added', 'skillet-own']);

export type KitMapFromKind = 'plugin' | 'organization' | 'app';

/** The sources that came with something the map names instead of changing, and what that is. */
const FROM_KIND: Partial<Record<KitMapSource, KitMapFromKind>> = {
  plugin: 'plugin',
  synced: 'organization',
  app: 'app',
};

/** Whether Remove acts on a skill from this source. For the rest, the map names what to turn off. */
export function isRemovableSource(source: KitMapSource): boolean {
  return REMOVABLE.has(source);
}

/** An AI tool that loads the skill, and how many identical copies of it that tool loads. */
export interface KitMapToolCopies {
  /** The tool's stable id, as the adapter table writes it (`claude-code`, `codex`), plus `opencode`. */
  tool: string;
  /** One, or more when the tool loads the same skill from more than one folder. */
  copies: number;
}

/** The plugin, organization or app a skill came with, and whether it is on. */
export interface KitMapFrom {
  kind: KitMapFromKind;
  /** As its tool names it: one name, never a folder path. */
  name: string;
  /** On or off in its tool's settings; null when they don't say. */
  on: boolean | null;
}

/** A Skillet-managed copy, as the kit state knows it. */
export interface KitMapSkillet {
  /** `@owner/slug`, which names its maker and its page on skillet.md. Null for an import with no owner. */
  ref: string | null;
  /** Its name on Skillet. */
  name: string;
}

export type KitMapUsageState = 'used' | 'unused' | 'unknown';
const USAGE_STATES: readonly KitMapUsageState[] = ['used', 'unused', 'unknown'];

/**
 * Whether the skill ran in the last 30 days, read on the computer and never
 * uploaded. `reason` is a short code the map turns into words, such as
 * `no-recent-run`, `short-history`, `no-history` or `capped`.
 */
export interface KitMapUsage {
  state: KitMapUsageState;
  reason: string | null;
}

/** Why a skill can't be backed up or merged, as a short code (`secret`, `links-outside`, `extra-files`). */
export interface KitMapFlag {
  reason: string;
  /** The one file to clean, by its name alone, when a single file is the reason. */
  file?: string;
}

/** One skill on the map, as this computer's scan found it. It never holds a path. */
export interface KitMapEntry {
  /** Its content hash (`sha256:<hex>`), which keys it everywhere. */
  key: string;
  name: string;
  /** Short: the scan cuts it to {@link KIT_MAP_DESCRIPTION_MAX}. */
  description: string;
  source: KitMapSource;
  /** Every AI tool that loads it. A skill two tools load is still one entry. Empty for a dropped folder. */
  tools: KitMapToolCopies[];
  /** Set for plugin, synced and app skills, and only for them. */
  from?: KitMapFrom;
  /** The job it sits in, or null for "Not sorted". */
  job: JobId | null;
  usage: KitMapUsage;
  noBackup?: KitMapFlag;
  noMerge?: KitMapFlag;
  /** Set only for Skillet-managed copies. */
  skillet?: KitMapSkillet;
}

export type KitMapHistory = 'read' | 'short' | 'none';
const HISTORIES: readonly KitMapHistory[] = ['read', 'short', 'none'];

/** An AI tool the scan looked at, and how much of its history it could read. */
export interface KitMapLooked {
  tool: string;
  /** `read`: 30 days or more. `short`: it keeps less, so its skills get no unused mark. `none`: nothing Skillet can read. */
  history: KitMapHistory;
}

/**
 * A place the scan couldn't check, so the map can say so. Never its path: the
 * reason, the tools that load what's there, and for a plugin its name.
 */
export interface KitMapUnchecked {
  /** A short code: `protected-folder`, `permission-denied`, `broken-link`, `project-plugin`, `plugin-missing`, `unparseable`, `unreadable`. */
  reason: string;
  tools: string[];
  /** For a plugin: its name as the tool lists it (`<name>@<marketplace>` in Claude Code). */
  plugin?: string;
}

/** What `scan` carries: every skill found, every tool looked at, and what it couldn't check. */
export interface KitMapScan {
  entries: KitMapEntry[];
  looked: KitMapLooked[];
  unchecked: KitMapUnchecked[];
  /**
   * Whether this computer already has a Skillet connection, read from its own
   * files with no network call. Absent means not connected. A connected Save
   * skips the map-session handshake and confirms the account in the frame.
   */
  connected?: boolean;
  /**
   * On a connected computer, the changes the account holds for this computer,
   * such as a merge picked on skillet.md or removes from a dropped-folder Save.
   * The map lists them and Save applies them with the new drafts. Like every
   * pending change, they name skills by content hash, never by path.
   */
  pending?: KitMapPendingChange[];
}

/** Whether Save backs this skill up: the person's own folders, unless the scan found a reason not to. */
export function backsUp(entry: KitMapEntry): boolean {
  return entry.source === 'local' && entry.noBackup === undefined;
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

/** Merge every skill in a job into one. */
export interface KitMapMergeDraft {
  kind: 'merge';
  job: JobId;
  keys: string[];
}

export interface KitMapRemoveDraft {
  kind: 'remove';
  key: string;
}

/** Add a Skillet skill (`@owner/slug`) to an empty job. */
export interface KitMapFillDraft {
  kind: 'fill';
  job: JobId;
  ref: string;
}

/** Put a skill in another job, or in "Not sorted" (null). Only the map changes. */
export interface KitMapMoveDraft {
  kind: 'move';
  key: string;
  job: JobId | null;
}

export type KitMapDraft = KitMapMergeDraft | KitMapRemoveDraft | KitMapFillDraft | KitMapMoveDraft;

/**
 * Why Save leaves a draft out:
 * - `too-few-sources`: a merge with fewer than two of its skills left in its job.
 * - `filled-by-move`: a Fill whose job holds a skill a Move put there.
 * - `not-empty`: a Fill whose job holds a skill the scan found there, as after Undo of the Move that emptied it.
 * - `filled-again`: a Fill a later Fill of the same job replaced.
 * - `removed`: a Move of a skill drafted for removal.
 * - `moved-again`: a Move a later Move of the same skill replaced.
 * - `repeat`: a Remove of a skill already drafted for removal.
 */
export type KitMapLeftOut =
  | 'too-few-sources'
  | 'filled-by-move'
  | 'not-empty'
  | 'filled-again'
  | 'removed'
  | 'moved-again'
  | 'repeat';

/** One draft as the whole list makes it. */
export interface KitMapDraftState {
  readonly draft: KitMapDraft;
  /** Save sends it. */
  readonly active: boolean;
  readonly reason?: KitMapLeftOut;
  /** For a merge: its keys that end up in its job and that no later active merge keeps. */
  readonly sources?: readonly string[];
}

/** What a `proof` shows, and what Save does: counts only. */
export interface KitMapSaveCounts {
  backups: number;
  removals: number;
  fills: number;
  merges: number;
}

export interface KitMapChanges {
  /** One per draft, in the order they were drafted. */
  readonly drafts: readonly KitMapDraftState[];
  /** What Save sends: the active drafts in order, each merge holding only its sources. */
  readonly changes: readonly KitMapDraft[];
  /** Every skill still on the map, in scan order, with the job it ends up in (null: "Not sorted"). */
  readonly jobs: ReadonlyMap<string, JobId | null>;
  readonly counts: KitMapSaveCounts;
}

/**
 * What an ordered draft list means, given the scan it was drafted on. Undo is
 * the list without that draft, derived again. A skill ends up where its last
 * Move put it, or where the scan found it, unless it is drafted for removal.
 * Then:
 * - a merge keeps those of its keys that end up in its job, minus any a later
 *   merge that stays active keeps, and is left out with fewer than two;
 * - a Fill is left out once its job holds a skill, or when a later Fill of the
 *   same job replaced it;
 * - a Remove counts once, and a Move counts only as the last for its skill and
 *   only while that skill isn't drafted for removal.
 * Pass drafts that {@link parseKitMapDrafts} accepted against these entries: a
 * key the scan didn't find is never on the map, so it is never a source.
 */
export function deriveKitMapChanges(drafts: readonly KitMapDraft[], entries: readonly KitMapEntry[]): KitMapChanges {
  const firstRemove = new Map<string, number>();
  const lastMove = new Map<string, number>();
  const lastFill = new Map<JobId, number>();
  drafts.forEach((draft, i) => {
    if (draft.kind === 'remove') {
      if (!firstRemove.has(draft.key)) firstRemove.set(draft.key, i);
    } else if (draft.kind === 'move') lastMove.set(draft.key, i);
    else if (draft.kind === 'fill') lastFill.set(draft.job, i);
  });

  const scanned = new Map(entries.map((entry) => [entry.key, entry.job]));
  /** Where a skill on the map ends up; undefined once it is drafted for removal, or if the scan never found it. */
  const jobOf = (key: string): JobId | null | undefined => {
    if (!scanned.has(key) || firstRemove.has(key)) return undefined;
    const i = lastMove.get(key);
    return i === undefined ? scanned.get(key) : (drafts[i] as KitMapMoveDraft).job;
  };

  // Every job that holds a skill once the drafts are made, so a Fill there is left out.
  const jobs = new Map<string, JobId | null>();
  const held = new Map<JobId, 'filled-by-move' | 'not-empty'>();
  for (const { key } of entries) {
    const job = jobOf(key);
    if (job === undefined) continue;
    jobs.set(key, job);
    if (job !== null && held.get(job) !== 'filled-by-move') held.set(job, lastMove.has(key) ? 'filled-by-move' : 'not-empty');
  }

  // Latest merge first, so a later merge that stays active keeps the keys it shares with an earlier one.
  const sources = new Map<number, string[]>();
  const claimed = new Set<string>();
  for (let i = drafts.length - 1; i >= 0; i--) {
    const draft = drafts[i];
    if (draft.kind !== 'merge') continue;
    const kept = [...new Set(draft.keys)].filter((key) => !claimed.has(key) && jobOf(key) === draft.job);
    sources.set(i, kept);
    if (kept.length >= 2) for (const key of kept) claimed.add(key);
  }

  const leftOut = (draft: KitMapDraft, i: number): KitMapLeftOut | undefined => {
    switch (draft.kind) {
      case 'merge':
        return (sources.get(i)?.length ?? 0) < 2 ? 'too-few-sources' : undefined;
      case 'remove':
        return firstRemove.get(draft.key) === i ? undefined : 'repeat';
      case 'fill':
        return held.get(draft.job) ?? (lastFill.get(draft.job) === i ? undefined : 'filled-again');
      case 'move':
        if (firstRemove.has(draft.key)) return 'removed';
        return lastMove.get(draft.key) === i ? undefined : 'moved-again';
    }
  };

  const states: KitMapDraftState[] = [];
  const changes: KitMapDraft[] = [];
  drafts.forEach((draft, i) => {
    const reason = leftOut(draft, i);
    const kept = sources.get(i);
    states.push({ draft, active: reason === undefined, ...(reason && { reason }), ...(kept && { sources: kept }) });
    if (reason !== undefined) return;
    changes.push(draft.kind === 'merge' ? { kind: 'merge', job: draft.job, keys: [...(kept ?? [])] } : draft);
  });

  const tally = (kind: KitMapDraft['kind']): number => changes.filter((change) => change.kind === kind).length;
  const counts: KitMapSaveCounts = {
    backups: entries.filter((entry) => backsUp(entry) && !firstRemove.has(entry.key)).length,
    removals: tally('remove'),
    fills: tally('fill'),
    merges: tally('merge'),
  };
  return { drafts: states, changes, jobs, counts };
}

// ---------------------------------------------------------------------------
// The saved map and pending changes
// ---------------------------------------------------------------------------

/** An entry as the saved map keeps it: who it is and where it came from. No usage, tools, flags or paths. */
export interface KitMapSavedEntry {
  key: string;
  name: string;
  description: string;
  source: KitMapSource;
  from?: { kind: KitMapFromKind; name: string };
  skillet?: KitMapSkillet;
}

/** The saved map: one per account. */
export interface KitMapDocument {
  /** Which write this is. A write sends the version it read, and a conflict re-reads. */
  version: number;
  entries: KitMapSavedEntry[];
  /** Jobs by entry key, null for "Not sorted". A computer's scan places anything not listed here. */
  assignments: Record<string, JobId | null>;
}

/** The saved form of a scanned entry, dropping everything that stays on the computer. */
export function toSavedEntry(entry: KitMapEntry): KitMapSavedEntry {
  const saved: KitMapSavedEntry = {
    key: entry.key,
    name: entry.name,
    description: entry.description,
    source: entry.source,
  };
  if (entry.from) saved.from = { kind: entry.from.kind, name: entry.from.name };
  if (entry.skillet) saved.skillet = { ref: entry.skillet.ref, name: entry.skillet.name };
  return saved;
}

export interface KitMapPendingRecord {
  id: string;
  /** The device it targets. Null after a Save from a dropped folder: the first computer whose scan holds its keys claims it. */
  device: string | null;
  /** Its own version, apart from the saved map's. */
  version: number;
}

export interface KitMapPendingRemove extends KitMapPendingRecord {
  kind: 'remove';
  key: string;
}

export interface KitMapPendingMerge extends KitMapPendingRecord {
  kind: 'merge';
  job: JobId;
  keys: string[];
}

/** Put a merged skill in place of its sources. `merged` must be a bundle this computer wrote itself. */
export interface KitMapPendingReplace extends KitMapPendingRecord {
  kind: 'replace';
  merged: string;
  keys: string[];
}

/** A change this client can't read: skip it, never apply part of it. */
export interface KitMapPendingUnknown extends KitMapPendingRecord {
  kind: 'unknown';
  rawKind: string;
}

export type KitMapPendingChange = KitMapPendingRemove | KitMapPendingMerge | KitMapPendingReplace | KitMapPendingUnknown;

// ---------------------------------------------------------------------------
// Bridge messages
// ---------------------------------------------------------------------------

/**
 * Where Save is, as the loopback page reports it. `ended` means its server
 * stopped. `confirm` comes only on a connected computer: the CLI looked up the
 * computer's account after Save was pressed, and the frame asks the person to
 * confirm saving to it (the status carries `handle`).
 */
export type KitMapStatusState =
  | 'waiting'
  | 'signing-in'
  | 'confirm'
  | 'saving'
  | 'applying'
  | 'done'
  | 'expired'
  | 'failed'
  | 'ended';
const STATUS_STATES: readonly KitMapStatusState[] = [
  'waiting',
  'signing-in',
  'confirm',
  'saving',
  'applying',
  'done',
  'expired',
  'failed',
  'ended',
];

/** Loopback page to frame: the scan to draw. */
export interface KitMapScanMessage {
  type: 'scan';
  v: Version;
  scan: KitMapScan;
}

/**
 * Loopback page to frame: the map session Save opened, for the save tab.
 * `proof` is the one-time secret whose hash the CLI registered with the
 * session. It crosses only by postMessage, never a URL, and the save tab trades
 * it for its binding before any sign-in.
 */
export interface KitMapSessionMessage {
  type: 'session';
  v: Version;
  session: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  proof: string;
}

/**
 * Loopback page to frame. `reason` is a short code, mostly for `failed`.
 * `handle` comes with `confirm` and only then.
 */
export interface KitMapStatusMessage {
  type: 'status';
  v: Version;
  state: KitMapStatusState;
  reason?: string;
  handle?: string;
}

/** Frame to loopback page: loaded, send the scan. */
export interface KitMapReadyMessage {
  type: 'ready';
  v: Version;
}

/** Frame to loopback page: the draft list, whenever it changes. */
export interface KitMapDraftsMessage {
  type: 'drafts';
  v: Version;
  drafts: KitMapDraft[];
}

/** Frame to loopback page: the person pressed Save on these drafts. */
export interface KitMapSaveMessage {
  type: 'save';
  v: Version;
  drafts: KitMapDraft[];
}

/** Frame to loopback page, on a connected computer: the person confirmed saving to the account `confirm` named. */
export interface KitMapConfirmMessage {
  type: 'confirm';
  v: Version;
}

/** Save tab to frame. */
export interface KitMapProofRequestMessage {
  type: 'proof-request';
  v: Version;
  session: string;
}

/** Frame to save tab: the session's one-time proof and counts only, never a skill name. */
export interface KitMapProofMessage {
  type: 'proof';
  v: Version;
  session: string;
  proof: string;
  counts: KitMapSaveCounts;
}

export type KitMapMessage =
  | KitMapScanMessage
  | KitMapSessionMessage
  | KitMapStatusMessage
  | KitMapReadyMessage
  | KitMapDraftsMessage
  | KitMapSaveMessage
  | KitMapConfirmMessage
  | KitMapProofRequestMessage
  | KitMapProofMessage;

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

type Fields = Record<string, unknown>;

const HASH_RE = /^sha256:[0-9a-f]{64}$/;
const TOOL_RE = /^[a-z][a-z0-9-]{0,31}$/;
const CODE_RE = /^[a-z][a-z0-9-]{0,47}$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
/** The map session's proof, binding and poll secret share the registry's shape. */
const PROOF_RE = /^[A-Za-z0-9_-]{32,256}$/;
const HANDLE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,38}$/;

/** Thrown inside a read and caught at the top of each parse; it never leaves this module. */
const INVALID = Symbol('kit-map invalid');

function invalid(): never {
  throw INVALID;
}

function attempt<T>(read: () => T): T | null {
  try {
    return read();
  } catch (err) {
    if (err === INVALID) return null;
    throw err;
  }
}

function isObject(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * An object holding no fields but these. A field set to undefined holds
 * nothing (postMessage clones keep such fields), so it doesn't count.
 */
function fields(value: unknown, allowed: readonly string[]): Fields {
  if (!isObject(value)) invalid();
  for (const [name, field] of Object.entries(value)) {
    if (field !== undefined && !allowed.includes(name)) invalid();
  }
  return value;
}

function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) invalid();
  return value;
}

function matching(value: unknown, re: RegExp): string {
  if (typeof value !== 'string' || !re.test(value)) invalid();
  return value;
}

function count(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) invalid();
  return value;
}

function bool(value: unknown): boolean {
  if (typeof value !== 'boolean') invalid();
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (!allowed.includes(value as T)) invalid();
  return value as T;
}

function hasControl(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** A name to show: one line, not blank. */
function displayName(value: unknown): string {
  if (typeof value !== 'string' || value.length > KIT_MAP_NAME_MAX || value.trim() === '' || hasControl(value)) invalid();
  return value;
}

function description(value: unknown): string {
  if (typeof value !== 'string' || value.length > KIT_MAP_DESCRIPTION_MAX) invalid();
  return value;
}

/** One name with no folder in it: a plugin, an organization, a folder or a file. */
function singleName(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max || value.trim() === '' || hasControl(value)) invalid();
  if (value.includes('/') || value.includes('\\') || value === '.' || value === '..') invalid();
  return value;
}

function jobId(value: unknown): JobId {
  if (typeof value !== 'string' || !isJobId(value)) invalid();
  return value;
}

function jobOrNull(value: unknown): JobId | null {
  return value === null ? null : jobId(value);
}

/** A ref in its canonical `@owner/slug` form. */
function wireRef(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('@')) invalid();
  const id = tryToSkillId(value);
  if (id === null || `@${id.replace(':', '/')}` !== value) invalid();
  return value;
}

function distinctHashes(value: unknown, min: number): string[] {
  const keys = list(value, MAX_ENTRIES).map((key) => matching(key, HASH_RE));
  if (keys.length < min || new Set(keys).size !== keys.length) invalid();
  return keys;
}

function readFrom(value: unknown, source: KitMapSource): KitMapFrom {
  const rec = fields(value, ['kind', 'name', 'on']);
  if (rec.kind !== FROM_KIND[source]) invalid();
  return { kind: rec.kind as KitMapFromKind, name: singleName(rec.name, KIT_MAP_NAME_MAX), on: rec.on === null ? null : bool(rec.on) };
}

function readSavedFrom(value: unknown, source: KitMapSource): { kind: KitMapFromKind; name: string } {
  const rec = fields(value, ['kind', 'name']);
  if (rec.kind !== FROM_KIND[source]) invalid();
  return { kind: rec.kind as KitMapFromKind, name: singleName(rec.name, KIT_MAP_NAME_MAX) };
}

function readSkillet(value: unknown, source: KitMapSource): KitMapSkillet {
  if (!SKILLET.has(source)) invalid();
  const rec = fields(value, ['ref', 'name']);
  return { ref: rec.ref === null ? null : wireRef(rec.ref), name: displayName(rec.name) };
}

function readFlag(value: unknown): KitMapFlag {
  const rec = fields(value, ['reason', 'file']);
  const flag: KitMapFlag = { reason: matching(rec.reason, CODE_RE) };
  if (rec.file !== undefined) flag.file = singleName(rec.file, MAX_FILE_NAME);
  return flag;
}

function toolIds(value: unknown): string[] {
  const tools = list(value, MAX_TOOLS).map((tool) => matching(tool, TOOL_RE));
  if (new Set(tools).size !== tools.length) invalid();
  return tools;
}

function readUnchecked(value: unknown): KitMapUnchecked {
  const rec = fields(value, ['reason', 'tools', 'plugin']);
  const place: KitMapUnchecked = { reason: matching(rec.reason, CODE_RE), tools: toolIds(rec.tools) };
  if (rec.plugin !== undefined) place.plugin = singleName(rec.plugin, KIT_MAP_NAME_MAX);
  return place;
}

function readTools(value: unknown): KitMapToolCopies[] {
  const tools = list(value, MAX_TOOLS).map((item) => {
    const rec = fields(item, ['tool', 'copies']);
    return { tool: matching(rec.tool, TOOL_RE), copies: count(rec.copies, 1, MAX_COPIES) };
  });
  if (new Set(tools.map((t) => t.tool)).size !== tools.length) invalid();
  return tools;
}

function readUsage(value: unknown): KitMapUsage {
  const rec = fields(value, ['state', 'reason']);
  return {
    state: oneOf(rec.state, USAGE_STATES),
    reason: rec.reason === null ? null : matching(rec.reason, CODE_RE),
  };
}

function readEntry(value: unknown): KitMapEntry {
  const rec = fields(value, ['key', 'name', 'description', 'source', 'tools', 'from', 'job', 'usage', 'noBackup', 'noMerge', 'skillet']);
  const source = oneOf(rec.source, KIT_MAP_SOURCES);
  const entry: KitMapEntry = {
    key: matching(rec.key, HASH_RE),
    name: displayName(rec.name),
    description: description(rec.description),
    source,
    tools: readTools(rec.tools),
    job: jobOrNull(rec.job),
    usage: readUsage(rec.usage),
  };
  if (FROM_KIND[source]) entry.from = readFrom(rec.from, source);
  else if (rec.from !== undefined) invalid();
  if (rec.noBackup !== undefined) entry.noBackup = readFlag(rec.noBackup);
  if (rec.noMerge !== undefined) entry.noMerge = readFlag(rec.noMerge);
  if (rec.skillet !== undefined) entry.skillet = readSkillet(rec.skillet, source);
  return entry;
}

function uniqueKeys(entries: readonly { key: string }[]): Set<string> {
  const keys = new Set(entries.map((entry) => entry.key));
  if (keys.size !== entries.length) invalid();
  return keys;
}

function readScan(value: unknown): KitMapScan {
  const rec = fields(value, ['entries', 'looked', 'unchecked', 'connected', 'pending']);
  if (rec.connected !== undefined && typeof rec.connected !== 'boolean') invalid();
  const entries = list(rec.entries, MAX_ENTRIES).map(readEntry);
  uniqueKeys(entries);
  const looked = list(rec.looked, MAX_TOOLS).map((item) => {
    const tool = fields(item, ['tool', 'history']);
    return { tool: matching(tool.tool, TOOL_RE), history: oneOf(tool.history, HISTORIES) };
  });
  if (new Set(looked.map((l) => l.tool)).size !== looked.length) invalid();
  const unchecked = list(rec.unchecked, MAX_ENTRIES).map(readUnchecked);
  const scan: KitMapScan = { entries, looked, unchecked };
  if (rec.connected !== undefined) scan.connected = rec.connected as boolean;
  if (rec.pending !== undefined) {
    // Waiting changes come only to a connected computer.
    if (scan.connected !== true) invalid();
    scan.pending = list(rec.pending, MAX_DRAFTS).map((item) => parseKitMapPendingChange(item) ?? invalid());
  }
  return scan;
}

/** A scan payload, or null when anything in it is malformed or holds a field it shouldn't. */
export function parseKitMapScan(value: unknown): KitMapScan | null {
  return attempt(() => readScan(value));
}

function readDraft(value: unknown, byKey: ReadonlyMap<string, KitMapEntry>): KitMapDraft {
  const known = (key: unknown): KitMapEntry => {
    const entry = byKey.get(matching(key, HASH_RE));
    if (!entry) invalid();
    return entry;
  };
  switch (isObject(value) ? value.kind : undefined) {
    case 'merge': {
      const rec = fields(value, ['kind', 'job', 'keys']);
      const merged = distinctHashes(rec.keys, 2).map(known);
      if (merged.some((entry) => entry.noMerge !== undefined)) invalid();
      return { kind: 'merge', job: jobId(rec.job), keys: merged.map((entry) => entry.key) };
    }
    case 'remove': {
      const rec = fields(value, ['kind', 'key']);
      const entry = known(rec.key);
      if (!isRemovableSource(entry.source)) invalid();
      return { kind: 'remove', key: entry.key };
    }
    case 'fill': {
      const rec = fields(value, ['kind', 'job', 'ref']);
      return { kind: 'fill', job: jobId(rec.job), ref: wireRef(rec.ref) };
    }
    case 'move': {
      const rec = fields(value, ['kind', 'key', 'job']);
      return { kind: 'move', key: known(rec.key).key, job: jobOrNull(rec.job) };
    }
    default:
      return invalid();
  }
}

function readDrafts(value: unknown, entries: readonly KitMapEntry[]): KitMapDraft[] {
  const byKey = new Map(entries.map((entry) => [entry.key, entry]));
  return list(value, MAX_DRAFTS).map((draft) => readDraft(draft, byKey));
}

/**
 * A draft list checked against the scan it was drafted on, or null. Rejected
 * when any draft names a key the scan didn't find, removes a skill Remove
 * can't act on, or merges one flagged unable to merge.
 */
export function parseKitMapDrafts(value: unknown, entries: readonly KitMapEntry[]): KitMapDraft[] | null {
  return attempt(() => readDrafts(value, entries));
}

function readSavedEntry(value: unknown): KitMapSavedEntry {
  const rec = fields(value, ['key', 'name', 'description', 'source', 'from', 'skillet']);
  const source = oneOf(rec.source, KIT_MAP_SOURCES);
  const entry: KitMapSavedEntry = {
    key: matching(rec.key, HASH_RE),
    name: displayName(rec.name),
    description: description(rec.description),
    source,
  };
  if (FROM_KIND[source]) entry.from = readSavedFrom(rec.from, source);
  else if (rec.from !== undefined) invalid();
  if (rec.skillet !== undefined) entry.skillet = readSkillet(rec.skillet, source);
  return entry;
}

function readDocument(value: unknown): KitMapDocument {
  const rec = fields(value, ['version', 'entries', 'assignments']);
  const entries = list(rec.entries, MAX_ENTRIES).map(readSavedEntry);
  const keys = uniqueKeys(entries);
  if (!isObject(rec.assignments)) invalid();
  const assignments: Record<string, JobId | null> = {};
  for (const [key, job] of Object.entries(rec.assignments)) {
    if (job === undefined) continue;
    if (!keys.has(key)) invalid();
    assignments[key] = jobOrNull(job);
  }
  return { version: count(rec.version), entries, assignments };
}

/**
 * The saved map, or null. Its entries hold no field but key, name,
 * description, source, from and skillet, so a path, a usage state or its
 * reason anywhere in one rejects the whole document.
 */
export function parseKitMapDocument(value: unknown): KitMapDocument | null {
  return attempt(() => readDocument(value));
}

const RECORD_FIELDS = ['id', 'kind', 'device', 'version'] as const;

function readPendingBody(rec: Fields, record: KitMapPendingRecord): KitMapPendingChange {
  switch (rec.kind) {
    case 'remove':
      fields(rec, [...RECORD_FIELDS, 'key']);
      return { ...record, kind: 'remove', key: matching(rec.key, HASH_RE) };
    case 'merge':
      fields(rec, [...RECORD_FIELDS, 'job', 'keys']);
      return { ...record, kind: 'merge', job: jobId(rec.job), keys: distinctHashes(rec.keys, 2) };
    case 'replace': {
      fields(rec, [...RECORD_FIELDS, 'merged', 'keys']);
      const merged = matching(rec.merged, HASH_RE);
      const keys = distinctHashes(rec.keys, 1);
      if (keys.includes(merged)) invalid();
      return { ...record, kind: 'replace', merged, keys };
    }
    default:
      return invalid();
  }
}

/**
 * A pending change, or null when the record itself (id, device, version) is
 * malformed. A kind this client doesn't know, or a known kind holding more
 * than it can read, comes back as `unknown`, so an older client skips it
 * rather than applying part of it.
 */
export function parseKitMapPendingChange(value: unknown): KitMapPendingChange | null {
  return attempt((): KitMapPendingChange => {
    if (!isObject(value)) invalid();
    const rec = value;
    const kind = rec.kind;
    if (typeof kind !== 'string' || kind === '' || kind.length > 64) invalid();
    const record: KitMapPendingRecord = {
      id: matching(rec.id, ID_RE),
      device: rec.device === null ? null : matching(rec.device, ID_RE),
      version: count(rec.version),
    };
    return attempt(() => readPendingBody(rec, record)) ?? { ...record, kind: 'unknown', rawKind: kind };
  });
}

function readCounts(value: unknown): KitMapSaveCounts {
  const rec = fields(value, ['backups', 'removals', 'fills', 'merges']);
  return { backups: count(rec.backups), removals: count(rec.removals), fills: count(rec.fills), merges: count(rec.merges) };
}

function readMessage(value: unknown, entries: readonly KitMapEntry[] | undefined): KitMapMessage {
  if (!isObject(value) || value.v !== KIT_MAP_VERSION) invalid();
  const v = KIT_MAP_VERSION;
  switch (value.type) {
    case 'scan':
      return { type: 'scan', v, scan: readScan(fields(value, ['type', 'v', 'scan']).scan) };
    case 'session': {
      const rec = fields(value, ['type', 'v', 'session', 'expiresAt', 'proof']);
      return {
        type: 'session',
        v,
        session: matching(rec.session, ID_RE),
        expiresAt: count(rec.expiresAt),
        proof: matching(rec.proof, PROOF_RE),
      };
    }
    case 'status': {
      const rec = fields(value, ['type', 'v', 'state', 'reason', 'handle']);
      const status: KitMapStatusMessage = { type: 'status', v, state: oneOf(rec.state, STATUS_STATES) };
      if (rec.reason !== undefined) status.reason = matching(rec.reason, CODE_RE);
      // The account handle travels with `confirm` and with nothing else.
      if (status.state === 'confirm') status.handle = matching(rec.handle, HANDLE_RE);
      else if (rec.handle !== undefined) invalid();
      return status;
    }
    case 'confirm':
      fields(value, ['type', 'v']);
      return { type: 'confirm', v };
    case 'ready':
      fields(value, ['type', 'v']);
      return { type: 'ready', v };
    case 'drafts':
    case 'save': {
      // Drafts are only good against the scan they were drafted on.
      if (!entries) invalid();
      const drafts = readDrafts(fields(value, ['type', 'v', 'drafts']).drafts, entries);
      return value.type === 'save' ? { type: 'save', v, drafts } : { type: 'drafts', v, drafts };
    }
    case 'proof-request':
      return { type: 'proof-request', v, session: matching(fields(value, ['type', 'v', 'session']).session, ID_RE) };
    case 'proof': {
      const rec = fields(value, ['type', 'v', 'session', 'proof', 'counts']);
      return {
        type: 'proof',
        v,
        session: matching(rec.session, ID_RE),
        proof: matching(rec.proof, PROOF_RE),
        counts: readCounts(rec.counts),
      };
    }
    default:
      return invalid();
  }
}

/**
 * A bridge message, or null when it's malformed, carries a field it shouldn't,
 * or carries a version this module doesn't know. `drafts` and `save` need the
 * scan's entries to check their keys against, and are rejected without them.
 */
export function parseKitMapMessage(value: unknown, entries?: readonly KitMapEntry[]): KitMapMessage | null {
  return attempt(() => readMessage(value, entries));
}

/**
 * The version a message-shaped value carries, valid or not, so a side that
 * rejects a message from a newer Skillet can say to update instead of
 * ignoring it.
 */
export function kitMapMessageVersion(value: unknown): number | null {
  if (!isObject(value) || typeof value.type !== 'string') return null;
  return typeof value.v === 'number' && Number.isSafeInteger(value.v) ? value.v : null;
}
