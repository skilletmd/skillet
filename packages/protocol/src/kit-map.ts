/**
 * The kit map's shapes: what a scan found, the fixes drafted on it, the saved
 * map, the changes that wait for a computer, the merges a computer writes for
 * the blind pick, and the messages between the three windows that show it.
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
import { isWireRef } from './skill-id.js';

/** The version every bridge message carries. */
export const KIT_MAP_VERSION = 1;
type Version = typeof KIT_MAP_VERSION;

/** A name longer than this is rejected; the scan shortens names before sending. */
export const KIT_MAP_NAME_MAX = 200;
/** The scan cuts descriptions to this (the Agent Skills limit for a description). */
export const KIT_MAP_DESCRIPTION_MAX = 1024;

/** The longest list a kit map payload holds: its entries, keys or unchecked places. */
export const KIT_MAP_MAX_ENTRIES = 10_000;
/** The most identical copies of one skill a single tool is counted as loading. */
export const KIT_MAP_MAX_COPIES = 1_000;
/** A file's name, as a flag names the one file to clean. */
export const KIT_MAP_FILE_NAME_MAX = 255;

const MAX_DRAFTS = 10_000;
const MAX_TOOLS = 64;

/** A skill's content hash, the key of every entry: `sha256:<64 hex>`. */
export const KIT_MAP_HASH_RE = /^sha256:[0-9a-f]{64}$/;
/** An AI tool's id, as the adapter table writes it. */
export const KIT_MAP_TOOL_RE = /^[a-z][a-z0-9-]{0,31}$/;
/** A short reason or outcome code (`no-recent-run`, `links-outside`, `applied`). */
export const KIT_MAP_CODE_RE = /^[a-z][a-z0-9-]{0,47}$/;
/** A record's id: a pending change, a merge, a device, or a session in a bridge message. */
export const KIT_MAP_RECORD_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
/** The map session's proof, binding and poll secret share the registry's shape. */
export const KIT_MAP_SECRET_RE = /^[A-Za-z0-9_-]{32,256}$/;
/** The account handle a connected Save confirms. */
export const KIT_MAP_HANDLE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,38}$/;
/** The registry's map session id: 128 bits of hex. */
export const KIT_MAP_SESSION_ID_RE = /^[0-9a-f]{32}$/;

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
const MERGEABLE: ReadonlySet<KitMapSource> = new Set<KitMapSource>(['local', 'skillet-imported', 'skillet-added']);
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

/**
 * Whether a merge may be written from a skill from this source (KTD12): the
 * person's own folders and Skillet-managed copies. Their own published skills
 * stay out because sync writes them back, and plugin, synced and app-managed
 * skills because they're never changed (R7).
 */
export function isMergeableSource(source: KitMapSource): boolean {
  return MERGEABLE.has(source);
}

/** Whether a skill from this source is a copy Skillet manages, so the entry carries `skillet`. */
export function isSkilletSource(source: KitMapSource): boolean {
  return SKILLET.has(source);
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
   * Whether this computer has a Skillet connection its account still accepts.
   * The CLI checks with one request that carries the device token and no skill
   * data, only when a token is on disk, so an unconnected computer makes no
   * request before Save. Absent means not connected. A connected Save skips the
   * map-session handshake and confirms the account in the frame.
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
// Merges
// ---------------------------------------------------------------------------

/**
 * Where a drafted merge is. The computer that holds the merge change writes it
 * with the person's own AI tool and stores it privately with its blind rounds;
 * the person picks on skillet.md; a replace puts it in place.
 * - `waiting`: saved, and waiting for the computer to write it.
 * - `writing`: the computer is writing it.
 * - `ready`: written, with one blind round per original: ready to pick.
 * - `failed`: couldn't be written, and `reason` says why. Nothing was stored.
 * - `picked`: the person picked it; waiting for the computer to put it in place.
 * - `applied`: in place of its originals.
 * - `out-of-date`: an original changed after the merge was drafted or written.
 */
export type KitMapMergeStatus = 'waiting' | 'writing' | 'ready' | 'failed' | 'picked' | 'applied' | 'out-of-date';

export const KIT_MAP_MERGE_STATUSES: readonly KitMapMergeStatus[] = Object.freeze([
  'waiting',
  'writing',
  'ready',
  'failed',
  'picked',
  'applied',
  'out-of-date',
]);

/** The most skills one merge is written from: each is one blind round. */
export const KIT_MAP_MERGE_MAX_SOURCES = 12;
/** The brief every round runs, a request as a person would type it. */
export const KIT_MAP_MERGE_BRIEF_MAX = 1_000;
/** One sample's text. */
export const KIT_MAP_MERGE_SAMPLE_MAX = 64 * 1024;

/** A source a merged skill credits: a public skill by its ref and name, or a private one, counted and never shown. */
export type KitMapMergeSource = { key: string; ref: string; name: string } | { key: string; private: true };

/** One blind round: the brief, written once by the merged skill (fresh for this round) and once by one original. */
export interface KitMapMergeRound {
  /** The original this round compares, by content hash. */
  key: string;
  /** What the merged skill wrote. */
  merged: string;
  /** What the original wrote. */
  original: string;
}

/** A merge as the account keeps it. Like every kit map record, it never holds a path. */
export interface KitMapMerge {
  /** The merge change's id. */
  id: string;
  /** The computer that writes it, or null until a computer claims it. */
  device: string | null;
  job: JobId;
  /** The originals, by the content hashes the merge was drafted on. */
  keys: string[];
  status: KitMapMergeStatus;
  /** A short code: why it couldn't be written, or why it's out of date. */
  reason?: string;
  /** The merged skill's content hash, once written. Its private backup holds the skill. */
  merged?: string;
  /** The one brief every round ran. */
  brief?: string;
  /** One round per original. */
  rounds?: KitMapMergeRound[];
  /** Who the merged skill credits, one per original, from its backup. */
  sources?: KitMapMergeSource[];
  /** The public skill (`@owner/slug`) the person published from the merged one, once they have. */
  published?: string;
  /** When it last changed, in epoch seconds. */
  updatedAt: number;
}

/** What the person keeps after the blind rounds: the merged skill, or the originals. */
export type KitMapMergeChoice = 'merged' | 'originals';

/**
 * The pick, as skillet.md sends it: the side kept, and the originals the
 * merged skill beat, one per round it won. "Use merged" is offered only when
 * it won more than half the rounds ({@link kitMapMergeWins}).
 */
export interface KitMapMergePick {
  use: KitMapMergeChoice;
  won: string[];
}

/**
 * Whether the merged skill won more than half its rounds (KTD13). A tie keeps
 * the originals (AE1), and so does a merge with no rounds.
 */
export function kitMapMergeWins(won: number, rounds: number): boolean {
  return rounds > 0 && won * 2 > rounds;
}

/** What the computer writing a merge reports. A pick, and putting a merge in place, are never a computer's to report. */
export type KitMapMergeReport =
  | { status: 'writing' }
  | { status: 'ready'; merged: string; brief: string; rounds: KitMapMergeRound[] }
  | { status: 'failed'; reason: string }
  | { status: 'out-of-date'; reason?: string };

export interface KitMapMergeCredits {
  /** The public sources, to name with their makers and links. */
  linked: Array<{ key: string; ref: string; name: string }>;
  privateCount: number;
  /** "1 private skill", "2 private skills", or null when every source is public. */
  privateLabel: string | null;
}

/** How a merged skill counts the sources it never names (R23): "1 private skill", "2 private skills", or null for none. */
export function kitMapPrivateLabel(privateCount: number): string | null {
  return privateCount === 0 ? null : `${privateCount} private skill${privateCount === 1 ? '' : 's'}`;
}

/** How a merged skill lists its sources (R23): the public ones by name, the private ones as a count. */
export function kitMapMergeCredits(sources: readonly KitMapMergeSource[]): KitMapMergeCredits {
  const linked: KitMapMergeCredits['linked'] = [];
  let privateCount = 0;
  for (const source of sources) {
    if ('private' in source) privateCount++;
    else linked.push(source);
  }
  return { linked, privateCount, privateLabel: kitMapPrivateLabel(privateCount) };
}

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

/** A name to show: one line, not blank, at most {@link KIT_MAP_NAME_MAX}. */
export function isKitMapDisplayName(value: unknown): value is string {
  return typeof value === 'string' && value.length <= KIT_MAP_NAME_MAX && value.trim() !== '' && !hasControl(value);
}

function displayName(value: unknown): string {
  if (!isKitMapDisplayName(value)) invalid();
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
  if (!isWireRef(value)) invalid();
  return value;
}

function distinctHashes(value: unknown, min: number): string[] {
  const keys = list(value, KIT_MAP_MAX_ENTRIES).map((key) => matching(key, KIT_MAP_HASH_RE));
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
  if (!isSkilletSource(source)) invalid();
  const rec = fields(value, ['ref', 'name']);
  return { ref: rec.ref === null ? null : wireRef(rec.ref), name: displayName(rec.name) };
}

function readFlag(value: unknown): KitMapFlag {
  const rec = fields(value, ['reason', 'file']);
  const flag: KitMapFlag = { reason: matching(rec.reason, KIT_MAP_CODE_RE) };
  if (rec.file !== undefined) flag.file = singleName(rec.file, KIT_MAP_FILE_NAME_MAX);
  return flag;
}

function toolIds(value: unknown): string[] {
  const tools = list(value, MAX_TOOLS).map((tool) => matching(tool, KIT_MAP_TOOL_RE));
  if (new Set(tools).size !== tools.length) invalid();
  return tools;
}

function readUnchecked(value: unknown): KitMapUnchecked {
  const rec = fields(value, ['reason', 'tools', 'plugin']);
  const place: KitMapUnchecked = { reason: matching(rec.reason, KIT_MAP_CODE_RE), tools: toolIds(rec.tools) };
  if (rec.plugin !== undefined) place.plugin = singleName(rec.plugin, KIT_MAP_NAME_MAX);
  return place;
}

function readTools(value: unknown): KitMapToolCopies[] {
  const tools = list(value, MAX_TOOLS).map((item) => {
    const rec = fields(item, ['tool', 'copies']);
    return { tool: matching(rec.tool, KIT_MAP_TOOL_RE), copies: count(rec.copies, 1, KIT_MAP_MAX_COPIES) };
  });
  if (new Set(tools.map((t) => t.tool)).size !== tools.length) invalid();
  return tools;
}

function readUsage(value: unknown): KitMapUsage {
  const rec = fields(value, ['state', 'reason']);
  return {
    state: oneOf(rec.state, USAGE_STATES),
    reason: rec.reason === null ? null : matching(rec.reason, KIT_MAP_CODE_RE),
  };
}

function readEntry(value: unknown): KitMapEntry {
  const rec = fields(value, ['key', 'name', 'description', 'source', 'tools', 'from', 'job', 'usage', 'noBackup', 'noMerge', 'skillet']);
  const source = oneOf(rec.source, KIT_MAP_SOURCES);
  const entry: KitMapEntry = {
    key: matching(rec.key, KIT_MAP_HASH_RE),
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
  const entries = list(rec.entries, KIT_MAP_MAX_ENTRIES).map(readEntry);
  uniqueKeys(entries);
  const looked = list(rec.looked, MAX_TOOLS).map((item) => {
    const tool = fields(item, ['tool', 'history']);
    return { tool: matching(tool.tool, KIT_MAP_TOOL_RE), history: oneOf(tool.history, HISTORIES) };
  });
  if (new Set(looked.map((l) => l.tool)).size !== looked.length) invalid();
  const unchecked = list(rec.unchecked, KIT_MAP_MAX_ENTRIES).map(readUnchecked);
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
    const entry = byKey.get(matching(key, KIT_MAP_HASH_RE));
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
    key: matching(rec.key, KIT_MAP_HASH_RE),
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
  const entries = list(rec.entries, KIT_MAP_MAX_ENTRIES).map(readSavedEntry);
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
      return { ...record, kind: 'remove', key: matching(rec.key, KIT_MAP_HASH_RE) };
    case 'merge':
      fields(rec, [...RECORD_FIELDS, 'job', 'keys']);
      return { ...record, kind: 'merge', job: jobId(rec.job), keys: distinctHashes(rec.keys, 2) };
    case 'replace': {
      fields(rec, [...RECORD_FIELDS, 'merged', 'keys']);
      const merged = matching(rec.merged, KIT_MAP_HASH_RE);
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
      id: matching(rec.id, KIT_MAP_RECORD_ID_RE),
      device: rec.device === null ? null : matching(rec.device, KIT_MAP_RECORD_ID_RE),
      version: count(rec.version),
    };
    return attempt(() => readPendingBody(rec, record)) ?? { ...record, kind: 'unknown', rawKind: kind };
  });
}

/** Free text a model wrote: not blank, within `max`, and no control character but tab and line breaks. */
function writtenText(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max || value.trim() === '') invalid();
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if ((code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) || code === 0x7f) invalid();
  }
  return value;
}

function mergeKeys(value: unknown): string[] {
  const keys = distinctHashes(value, 2);
  if (keys.length > KIT_MAP_MERGE_MAX_SOURCES) invalid();
  return keys;
}

/** Exactly one item per original, naming each original once. */
function onePerKey<T extends { key: string }>(items: readonly T[], keys: readonly string[]): T[] {
  if (items.length !== keys.length) invalid();
  const seen = new Set<string>();
  for (const item of items) {
    if (!keys.includes(item.key) || seen.has(item.key)) invalid();
    seen.add(item.key);
  }
  return [...items];
}

function readRounds(value: unknown, keys: readonly string[]): KitMapMergeRound[] {
  const rounds = list(value, KIT_MAP_MERGE_MAX_SOURCES).map((item) => {
    const rec = fields(item, ['key', 'merged', 'original']);
    return {
      key: matching(rec.key, KIT_MAP_HASH_RE),
      merged: writtenText(rec.merged, KIT_MAP_MERGE_SAMPLE_MAX),
      original: writtenText(rec.original, KIT_MAP_MERGE_SAMPLE_MAX),
    };
  });
  return onePerKey(rounds, keys);
}

function readMergeSource(value: unknown): KitMapMergeSource {
  if (isObject(value) && value.private === true) {
    return { key: matching(fields(value, ['key', 'private']).key, KIT_MAP_HASH_RE), private: true };
  }
  const rec = fields(value, ['key', 'ref', 'name']);
  return { key: matching(rec.key, KIT_MAP_HASH_RE), ref: wireRef(rec.ref), name: displayName(rec.name) };
}

/**
 * One source a merged skill credits, or null: `{ key, ref, name }` for a
 * public one, `{ key, private: true }` for a private one, with no other field.
 */
export function parseKitMapMergeSource(value: unknown): KitMapMergeSource | null {
  return attempt(() => readMergeSource(value));
}

function mergedHash(value: unknown, keys: readonly string[]): string {
  const merged = matching(value, KIT_MAP_HASH_RE);
  if (keys.includes(merged)) invalid();
  return merged;
}

/** Statuses a written merge is in, and the ones it can be in once it's out of date. */
const WRITTEN: ReadonlySet<KitMapMergeStatus> = new Set<KitMapMergeStatus>(['ready', 'picked', 'applied']);

function readMerge(value: unknown): KitMapMerge {
  const rec = fields(value, [
    'id',
    'device',
    'job',
    'keys',
    'status',
    'reason',
    'merged',
    'brief',
    'rounds',
    'sources',
    'published',
    'updatedAt',
  ]);
  const keys = mergeKeys(rec.keys);
  const status = oneOf(rec.status, KIT_MAP_MERGE_STATUSES);
  const merge: KitMapMerge = {
    id: matching(rec.id, KIT_MAP_RECORD_ID_RE),
    device: rec.device === null ? null : matching(rec.device, KIT_MAP_RECORD_ID_RE),
    job: jobId(rec.job),
    keys,
    status,
    updatedAt: count(rec.updatedAt),
  };
  // Why it failed, or why it's out of date; a failure always says.
  if (status === 'failed' || status === 'out-of-date') {
    if (rec.reason !== undefined || status === 'failed') merge.reason = matching(rec.reason, KIT_MAP_CODE_RE);
  } else if (rec.reason !== undefined) invalid();
  // A merged skill exists once written, and may outlive its originals' change.
  if (WRITTEN.has(status) || (status === 'out-of-date' && rec.merged !== undefined)) {
    merge.merged = mergedHash(rec.merged, keys);
  } else if (rec.merged !== undefined) invalid();
  const hasRounds = rec.rounds !== undefined || rec.brief !== undefined;
  if (hasRounds) {
    if (merge.merged === undefined) invalid();
    merge.brief = writtenText(rec.brief, KIT_MAP_MERGE_BRIEF_MAX);
    merge.rounds = readRounds(rec.rounds, keys);
  }
  if (rec.sources !== undefined) {
    if (merge.merged === undefined) invalid();
    merge.sources = onePerKey(list(rec.sources, KIT_MAP_MERGE_MAX_SOURCES).map(readMergeSource), keys);
  }
  if (rec.published !== undefined) {
    if (merge.merged === undefined) invalid();
    merge.published = wireRef(rec.published);
  }
  return merge;
}

function readMergePick(value: unknown, keys: readonly string[]): KitMapMergePick {
  const rec = fields(value, ['use', 'won']);
  const use = oneOf(rec.use, ['merged', 'originals'] as const);
  const won = list(rec.won, KIT_MAP_MERGE_MAX_SOURCES).map((key) => matching(key, KIT_MAP_HASH_RE));
  if (new Set(won).size !== won.length || !won.every((key) => keys.includes(key))) invalid();
  return { use, won };
}

/**
 * The person's pick, checked against the merge's own originals, or null. It
 * says only what was kept and which rounds the merged skill won; whether it
 * won enough for "Use merged" is {@link kitMapMergeWins}.
 */
export function parseKitMapMergePick(value: unknown, keys: readonly string[]): KitMapMergePick | null {
  return attempt(() => readMergePick(value, keys));
}

/**
 * A merge record, or null when it is malformed or holds a field it shouldn't.
 * A merged skill comes only with a written merge (or one out of date since),
 * its rounds and sources only beside it, and both name each original once.
 */
export function parseKitMapMerge(value: unknown): KitMapMerge | null {
  return attempt(() => readMerge(value));
}

function readMergeReport(value: unknown, keys: readonly string[]): KitMapMergeReport {
  switch (isObject(value) ? value.status : undefined) {
    case 'writing':
      fields(value, ['status']);
      return { status: 'writing' };
    case 'ready': {
      const rec = fields(value, ['status', 'merged', 'brief', 'rounds']);
      return {
        status: 'ready',
        merged: mergedHash(rec.merged, keys),
        brief: writtenText(rec.brief, KIT_MAP_MERGE_BRIEF_MAX),
        rounds: readRounds(rec.rounds, keys),
      };
    }
    case 'failed': {
      const rec = fields(value, ['status', 'reason']);
      return { status: 'failed', reason: matching(rec.reason, KIT_MAP_CODE_RE) };
    }
    case 'out-of-date': {
      const rec = fields(value, ['status', 'reason']);
      return rec.reason === undefined ? { status: 'out-of-date' } : { status: 'out-of-date', reason: matching(rec.reason, KIT_MAP_CODE_RE) };
    }
    default:
      return invalid();
  }
}

/**
 * What the computer writing a merge reports, checked against the merge
 * change's own keys (the originals come from the change, never the report), or
 * null. `ready` carries one round per original.
 */
export function parseKitMapMergeReport(value: unknown, keys: readonly string[]): KitMapMergeReport | null {
  return attempt(() => readMergeReport(value, keys));
}

function readCounts(value: unknown): KitMapSaveCounts {
  const rec = fields(value, ['backups', 'removals', 'fills', 'merges']);
  return { backups: count(rec.backups), removals: count(rec.removals), fills: count(rec.fills), merges: count(rec.merges) };
}

/** Save's four counts, each a whole number from zero, with no other field; or null. */
export function parseKitMapSaveCounts(value: unknown): KitMapSaveCounts | null {
  return attempt(() => readCounts(value));
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
        session: matching(rec.session, KIT_MAP_RECORD_ID_RE),
        expiresAt: count(rec.expiresAt),
        proof: matching(rec.proof, KIT_MAP_SECRET_RE),
      };
    }
    case 'status': {
      const rec = fields(value, ['type', 'v', 'state', 'reason', 'handle']);
      const status: KitMapStatusMessage = { type: 'status', v, state: oneOf(rec.state, STATUS_STATES) };
      if (rec.reason !== undefined) status.reason = matching(rec.reason, KIT_MAP_CODE_RE);
      // The account handle travels with `confirm` and with nothing else.
      if (status.state === 'confirm') status.handle = matching(rec.handle, KIT_MAP_HANDLE_RE);
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
      return { type: 'proof-request', v, session: matching(fields(value, ['type', 'v', 'session']).session, KIT_MAP_RECORD_ID_RE) };
    case 'proof': {
      const rec = fields(value, ['type', 'v', 'session', 'proof', 'counts']);
      return {
        type: 'proof',
        v,
        session: matching(rec.session, KIT_MAP_RECORD_ID_RE),
        proof: matching(rec.proof, KIT_MAP_SECRET_RE),
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
