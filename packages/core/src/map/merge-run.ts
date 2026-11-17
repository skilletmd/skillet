/**
 * Writing the drafted merges on this computer (plan U14, KTD9 KTD10 KTD12
 * KTD13 KTD14; R21 R22 R23 R24, AE1 AE5).
 *
 * Save records each drafted merge as a change waiting for this computer
 * (./apply.ts). This step writes them once Save is done: from Save's own run,
 * or, if that exited first, from the app's `skillet map --apply` or the next
 * Save, always under the save lock.
 *
 *   1. Read this computer's waiting merges and the account's record of each.
 *      One the account already holds as written, or as out of date, is
 *      acknowledged and left alone.
 *   2. Check its sources against a fresh scan (KTD12). An original no longer on
 *      this computer under the hash it was drafted on makes the merge out of
 *      date. Each one must be the person's own folder or a Skillet-managed
 *      copy, a lone SKILL.md with no links out, in a job that holds one skill;
 *      otherwise it can't be merged. Either way its change is acknowledged and
 *      nothing is written.
 *   3. Find the person's AI tool (./merge-writer.ts), once, and only when a
 *      merge needs writing. With none, every merge waits and says why.
 *   4. Write the merged SKILL.md, one brief for the job, then one blind round
 *      per original (KTD13): the brief run with that original, and again with
 *      the merged skill, fresh each round. N originals, 2N samples. Every call
 *      has a time cap, and so does the whole merge.
 *   5. Keep what was written in `~/.skillet/map-merges/<change id>.json`. A
 *      run that stops before the account holds it stores it later without
 *      writing it again, and a later replace installs only a merged bundle
 *      whose hash this computer wrote (KTD9).
 *   6. Credit the sources (KTD14): a public skill version with the same bytes
 *      names its maker (a Skillet-managed copy keeps its kit's name for it),
 *      and anything else is private: counted, never named (R23).
 *   7. Back the merged skill up privately as a merge (R24), give the account
 *      the brief and the rounds (ready to pick), and acknowledge the change.
 *
 * A failure in 3 or 4 stores nothing and leaves the merge waiting with its
 * reason, and nothing here changes an original (R22). Paths never leave this
 * module: the account sees hashes, names, the merged text and the samples.
 */
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  BundleError,
  SKILL_ENTRYPOINT,
  canonicalContentHash,
  encodeBundle,
  validateBundle,
  type DecodedBundle,
} from "@skillet/protocol";
import { isJobId, jobById, type Job, type JobId } from "@skillet/protocol/jobs";
import {
  KIT_MAP_MERGE_MAX_SOURCES,
  KIT_MAP_NAME_MAX,
  type KitMapMerge,
  type KitMapMergeReport,
  type KitMapMergeRound,
  type KitMapMergeSource,
  type KitMapPendingChange,
  type KitMapPendingMerge,
} from "@skillet/protocol/kit-map";
import { readState } from "../kit/store.js";
import type { KitState } from "../kit/types.js";
import { skilletDir } from "../session-token.js";
import { atomicWrite } from "../util/atomic.js";
import { readMapSkillBundle, type MapBackupBody, type MapBackupPut } from "./apply.js";
import type { MapSource } from "./folder-rules.js";
import {
  MergeWriterError,
  readBrief,
  readMergedSkill,
  readSample,
  type MergeSourceSkill,
  type MergeWriter,
  type MergeWriterCall,
} from "./merge-writer.js";
import type { MapScanEntry, MapScanResult } from "./scan.js";

// ---------------------------------------------------------------------------
// Which skills a merge is written from (KTD12)
// ---------------------------------------------------------------------------

/**
 * The person's own folders and Skillet-managed copies. Their own published
 * skills stay out because sync writes them back, and plugin, synced and
 * app-managed skills because they're never changed (R7).
 */
const MERGE_SOURCES: ReadonlySet<MapSource> = new Set<MapSource>(["local", "skillet-imported", "skillet-added"]);

/**
 * Whether a merge can be written from this skill: one of the person's own
 * folders or a Skillet-managed copy, and a lone SKILL.md with no links out.
 * The writer answers with one SKILL.md, so a skill's scripts and references
 * would go to the trash with it while no blind sample ever used them.
 */
export function isMergeableEntry(entry: MapScanEntry): boolean {
  return MERGE_SOURCES.has(entry.source) && entry.flags.cantMerge.length === 0;
}

/**
 * The skills in a job a merge would be written from, or none when the job
 * offers no merge: fewer than two can be merged, or the job holds as many
 * skills as you like (Platforms).
 */
export function mapMergeSources(job: JobId, held: readonly MapScanEntry[]): MapScanEntry[] {
  const slot: Job | undefined = jobById(job as string);
  if (slot === undefined || slot.many) return [];
  const able = held.filter(isMergeableEntry);
  return able.length >= 2 ? able : [];
}

// ---------------------------------------------------------------------------
// The account, as the merge step needs it
// ---------------------------------------------------------------------------

/**
 * The registry calls the merge step makes, as this computer. A method that
 * throws is a failure the next run retries.
 */
export interface MapMergeClient {
  /** This computer's waiting changes; the merges among them are written. */
  listChanges(): Promise<KitMapPendingChange[]>;
  /** Acknowledge one change, once. Already acknowledged counts as done. */
  ackChange(id: string, outcome: string): Promise<void>;
  /** This computer's merges, as the account keeps them. */
  listMerges(): Promise<KitMapMerge[]>;
  /** Tell the account where a merge is. Throws when the account can't be reached or won't take it. */
  reportMerge(id: string, report: KitMapMergeReport): Promise<void>;
  /** The public skill versions among these content hashes, each with its ref and name. */
  lookupSources(keys: string[]): Promise<ReadonlyMap<string, { ref: string; name: string }>>;
  putBackup(hash: string, body: MapBackupBody): Promise<MapBackupPut>;
}

export interface MapMergeLimits {
  /** One call to the AI tool. */
  callMs: number;
  /** One whole merge: the merge, its brief and every sample. */
  mergeMs: number;
  /** Every source's SKILL.md, together. */
  sourceBytes: number;
}

export const MAP_MERGE_LIMITS: Readonly<MapMergeLimits> = Object.freeze({
  callMs: 5 * 60_000,
  mergeMs: 30 * 60_000,
  sourceBytes: 512 * 1024,
});

export interface MapMergeRunOptions {
  /**
   * A fresh scan of this computer, after Save's removes: the only place paths
   * come from. A function is called only when a merge is waiting.
   */
  scan: MapScanResult | (() => Promise<MapScanResult>);
  client: MapMergeClient;
  /** Finds the person's AI tool. Called once, and only when a merge needs writing. */
  writer: () => Promise<MergeWriter | null>;
  /** Called once, before the first merge is written: how many, and with what. */
  onStart?: (info: { merges: number; writer: string }) => void;
  /** Called as each merge's outcome is known, with the AI tool that wrote (or null). */
  onOutcome?: (outcome: MapMergeOutcome, writer: string | null) => void;
  /** Stops at the next safe point; what's left waits for the next run. */
  signal?: AbortSignal;
  limits?: Partial<MapMergeLimits>;
  /**
   * Set when nobody pressed Save: the app's sync and `skillet map --apply`. A
   * merge whose last write failed then waits {@link RETRY_FAILED_AFTER_S}
   * before it is tried again, so a merge that keeps failing doesn't spend a run
   * of the person's AI tool on every sync. A Save always tries again.
   */
  unattended?: boolean;
  /** Now, in epoch seconds. For tests. */
  now?: () => number;
}

/** How long a run nobody started leaves a failed merge alone: a day. */
export const RETRY_FAILED_AFTER_S = 24 * 60 * 60;

/**
 * One merge after this run. `written`: stored and ready to pick. `waiting`: the
 * next run tries again. `dropped`: it can't be written as drafted, so its change
 * is done. `reason` is a short code for the last two.
 */
export interface MapMergeOutcome {
  id: string;
  job: JobId;
  result: "written" | "waiting" | "dropped";
  reason?: string;
  /** A written merge's sources: how many it names, and how many it only counts. */
  linked?: number;
  private?: number;
}

export interface MapMergeRunResult {
  /** The AI tool that wrote, or null when none was needed or found. */
  writer: string | null;
  outcomes: MapMergeOutcome[];
  written: number;
  waiting: number;
  /** Whether a merge was stored or a change acknowledged. */
  changed: boolean;
  /** Set when the account, or this computer's skills, couldn't be read, so nothing was tried. */
  reason?: "registry-unreachable" | "scan-failed";
}

// ---------------------------------------------------------------------------
// What this computer wrote (KTD9)
// ---------------------------------------------------------------------------

/** A merge this computer wrote, kept on this computer only. */
export interface MapMergeRecord {
  /** The merge change's id. */
  id: string;
  job: JobId;
  /** The originals it was written from. */
  keys: string[];
  /** The merged skill's content hash: a replace installs only a bundle whose hash is here. */
  merged: string;
  name: string;
  description: string;
  /** The merged SKILL.md, which hashes to `merged`. */
  skill: string;
  brief: string;
  rounds: KitMapMergeRound[];
  writtenAt: string;
  /** Set once the account holds the merge and its rounds. */
  storedAt?: string;
}

const RECORD_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const HASH_RE = /^sha256:[0-9a-f]{64}$/;
const TOOL_RE = /^[a-z][a-z0-9-]{0,31}$/;

export function mapMergeRecordsDir(): string {
  return join(skilletDir(), "map-merges");
}

function recordPath(id: string): string {
  if (!RECORD_ID_RE.test(id)) throw new Error("not a merge change id");
  return join(mapMergeRecordsDir(), `${id}.json`);
}

function skillBundle(skill: string): DecodedBundle {
  return new Map([[SKILL_ENTRYPOINT, Buffer.from(skill, "utf8")]]);
}

const isText = (value: unknown): value is string => typeof value === "string";

function parseRecord(value: unknown, id: string): MapMergeRecord | null {
  if (typeof value !== "object" || value === null) return null;
  const rec = value as Record<string, unknown>;
  const keys = Array.isArray(rec.keys) && rec.keys.every((k) => isText(k) && HASH_RE.test(k)) ? (rec.keys as string[]) : null;
  const rounds = Array.isArray(rec.rounds) ? (rec.rounds as unknown[]) : null;
  if (
    rec.id !== id ||
    !isText(rec.job) ||
    !isJobId(rec.job) ||
    keys === null ||
    !isText(rec.merged) ||
    !HASH_RE.test(rec.merged) ||
    !isText(rec.name) ||
    !isText(rec.description) ||
    !isText(rec.skill) ||
    !isText(rec.brief) ||
    rounds === null ||
    !isText(rec.writtenAt) ||
    (rec.storedAt !== undefined && !isText(rec.storedAt))
  ) {
    return null;
  }
  const readRounds: KitMapMergeRound[] = [];
  for (const round of rounds) {
    const r = round as Record<string, unknown> | null;
    if (!r || !isText(r.key) || !isText(r.merged) || !isText(r.original)) return null;
    readRounds.push({ key: r.key, merged: r.merged, original: r.original });
  }
  // A record whose text doesn't hash to its merged hash is no record of what was written.
  if (canonicalContentHash(skillBundle(rec.skill)) !== rec.merged) return null;
  return {
    id,
    job: rec.job,
    keys,
    merged: rec.merged,
    name: rec.name,
    description: rec.description,
    skill: rec.skill,
    brief: rec.brief,
    rounds: readRounds,
    writtenAt: rec.writtenAt,
    ...(isText(rec.storedAt) ? { storedAt: rec.storedAt } : {}),
  };
}

/** What this computer wrote for one merge change, or null. */
export async function readMapMergeRecord(id: string): Promise<MapMergeRecord | null> {
  if (!RECORD_ID_RE.test(id)) return null;
  try {
    return parseRecord(JSON.parse(await readFile(recordPath(id), "utf8")) as unknown, id);
  } catch {
    return null;
  }
}

/** Every merge this computer wrote and still keeps. */
export async function readMapMergeRecords(): Promise<MapMergeRecord[]> {
  let names: string[];
  try {
    names = await readdir(mapMergeRecordsDir());
  } catch {
    return [];
  }
  const records: MapMergeRecord[] = [];
  for (const name of names.sort()) {
    if (!name.endsWith(".json")) continue;
    const record = await readMapMergeRecord(name.slice(0, -".json".length));
    if (record) records.push(record);
  }
  return records;
}

async function keepRecord(record: MapMergeRecord): Promise<void> {
  await mkdir(mapMergeRecordsDir(), { recursive: true, mode: 0o700 });
  await atomicWrite(recordPath(record.id), `${JSON.stringify(record, null, 2)}\n`, { backup: false, mode: 0o600 });
}

async function dropRecord(id: string): Promise<void> {
  try {
    await rm(recordPath(id), { force: true });
  } catch {
    // Nothing to drop.
  }
}

// ---------------------------------------------------------------------------
// Planning each merge
// ---------------------------------------------------------------------------

interface PlanSource extends MergeSourceSkill {
  entry: MapScanEntry;
}

interface Plan {
  change: KitMapPendingMerge;
  /** In the change's order, which is the rounds' order. */
  sources: PlanSource[];
  /** What a run that stopped before the account took it already wrote. */
  record: MapMergeRecord | null;
}

type Planned = { kind: "write"; plan: Plan } | { kind: "drop"; reason: string } | { kind: "wait"; reason: string };

const sameKeys = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((key, i) => key === b[i]);

/** A source's SKILL.md, read the way the scan keyed it, or why it can't be. */
async function sourceText(entry: MapScanEntry): Promise<string | "changed" | "not-mergeable" | "unreadable"> {
  const location = entry.locations[0];
  if (!location) return "unreadable";
  let bundle: DecodedBundle;
  try {
    bundle = await readMapSkillBundle(location.path);
  } catch {
    return "unreadable";
  }
  if (canonicalContentHash(bundle) !== entry.key) return "changed";
  const skill = bundle.get(SKILL_ENTRYPOINT);
  if (bundle.size !== 1 || skill === undefined) return "not-mergeable";
  return Buffer.from(skill).toString("utf8");
}

async function planMerge(
  change: KitMapPendingMerge,
  scanned: ReadonlyMap<string, MapScanEntry>,
  limits: MapMergeLimits,
): Promise<Planned> {
  if (change.keys.length > KIT_MAP_MERGE_MAX_SOURCES) return { kind: "drop", reason: "too-many-sources" };
  const slot: Job | undefined = jobById(change.job as string);
  if (slot === undefined || slot.many) return { kind: "drop", reason: "not-mergeable" };
  const entries: MapScanEntry[] = [];
  for (const key of change.keys) {
    const entry = scanned.get(key);
    if (entry === undefined) return { kind: "drop", reason: "sources-changed" };
    entries.push(entry);
  }
  if (!entries.every(isMergeableEntry)) return { kind: "drop", reason: "not-mergeable" };

  const kept = await readMapMergeRecord(change.id);
  const record = kept !== null && kept.job === change.job && sameKeys(kept.keys, change.keys) ? kept : null;
  const sources: PlanSource[] = [];
  let bytes = 0;
  for (const entry of entries) {
    // A merge already written needs no source text again.
    const text = record !== null ? "" : await sourceText(entry);
    if (text === "changed") return { kind: "drop", reason: "sources-changed" };
    if (text === "not-mergeable") return { kind: "drop", reason: "not-mergeable" };
    if (text === "unreadable") return { kind: "wait", reason: "unreadable" };
    bytes += Buffer.byteLength(text, "utf8");
    if (bytes > limits.sourceBytes) return { kind: "drop", reason: "sources-too-large" };
    sources.push({ key: entry.key, name: entry.name, description: entry.description, text, entry });
  }
  return { kind: "write", plan: { change, sources, record } };
}

// ---------------------------------------------------------------------------
// Writing one
// ---------------------------------------------------------------------------

/** One writer call inside the merge's own deadline, stopped with the run. */
async function withDeadline(
  run: (call: MergeWriterCall) => Promise<string>,
  deadline: number,
  callMs: number,
  outer: AbortSignal | undefined,
): Promise<string> {
  if (outer?.aborted) throw new MergeWriterError("stopped");
  const ms = Math.min(callMs, deadline - Date.now());
  if (ms <= 0) throw new MergeWriterError("timeout");
  const controller = new AbortController();
  const onAbort = (): void => controller.abort();
  outer?.addEventListener("abort", onAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new MergeWriterError("timeout"));
      controller.abort();
    }, ms);
    controller.signal.addEventListener("abort", () => reject(new MergeWriterError(outer?.aborted ? "stopped" : "timeout")), {
      once: true,
    });
  });
  try {
    return await Promise.race([run({ signal: controller.signal, timeoutMs: ms }), cut]);
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", onAbort);
    // A call that lost the race is told to stop.
    controller.abort();
  }
}

async function compose(
  writer: MergeWriter,
  plan: Plan,
  limits: MapMergeLimits,
  signal: AbortSignal | undefined,
): Promise<MapMergeRecord> {
  const { change, sources } = plan;
  const deadline = Date.now() + limits.mergeMs;
  const ask = (run: (call: MergeWriterCall) => Promise<string>): Promise<string> =>
    withDeadline(run, deadline, limits.callMs, signal);
  const job = jobById(change.job);

  const merged = readMergedSkill(await ask((call) => writer.merge({ job, sources }, call)));
  const bundle = skillBundle(merged.text);
  try {
    validateBundle(bundle);
  } catch (err) {
    if (err instanceof BundleError) throw new MergeWriterError("bad-output");
    throw err;
  }
  const hash = canonicalContentHash(bundle);
  // An original handed back unchanged is no merge.
  if (change.keys.includes(hash)) throw new MergeWriterError("bad-output");

  const brief = readBrief(await ask((call) => writer.brief({ job, descriptions: sources.map((s) => s.description) }, call)));
  const rounds: KitMapMergeRound[] = [];
  for (const source of sources) {
    const original = readSample(await ask((call) => writer.sample({ skill: source.text, brief }, call)));
    // Fresh for every round: a merged text that repeated would give the merge away after the first.
    const fresh = readSample(await ask((call) => writer.sample({ skill: merged.text, brief }, call)));
    rounds.push({ key: source.key, merged: fresh, original });
  }
  return {
    id: change.id,
    job: change.job,
    keys: [...change.keys],
    merged: hash,
    name: merged.name,
    description: merged.description,
    skill: merged.text,
    brief,
    rounds,
    writtenAt: new Date().toISOString(),
  };
}

/** A name to credit: one line, within the map's limit, never blank. */
function creditName(value: string): string | null {
  const name = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return name === "" ? null : name.slice(0, KIT_MAP_NAME_MAX).trim();
}

/** The kit's own entry for a Skillet-managed copy: its ref, its name and the hash it was installed at. */
function kitEntryOf(entry: MapScanEntry, state: KitState | null): { ref: string | null; name: string; hash: string } | null {
  if (state === null || entry.source === "local") return null;
  const copy = entry.locations.find((location) => location.skillet !== null)?.skillet;
  if (!copy) return null;
  const key = copy.maker !== null ? `@${copy.maker}/${copy.slug}` : copy.slug;
  const kit = state.skills[key];
  if (!kit) return null;
  return { ref: copy.maker !== null ? key : null, name: kit.name, hash: kit.hash };
}

/**
 * Who a merge credits (KTD14, R23): one per original. A source the lookup
 * matches to a public version, by its bytes or by the version its kit
 * installed, is named; a Skillet-managed one keeps its kit's name when the
 * public version is the one its kit names. Anything else is private, so a
 * private kit's skill is never named, even after the merge is published.
 */
async function creditsFor(sources: readonly PlanSource[], client: MapMergeClient): Promise<KitMapMergeSource[]> {
  let state: KitState | null = null;
  try {
    state = await readState();
  } catch {
    // An unreadable kit state credits every source by its bytes alone.
  }
  const kits = sources.map((source) => kitEntryOf(source.entry, state));
  const asks = new Set<string>();
  sources.forEach((source, i) => {
    asks.add(source.key);
    const installed = kits[i]?.hash;
    if (installed !== undefined && HASH_RE.test(installed)) asks.add(installed);
  });
  const found = await client.lookupSources([...asks]);
  return sources.map((source, i): KitMapMergeSource => {
    const kit = kits[i] ?? null;
    const match = found.get(source.key) ?? (kit !== null ? found.get(kit.hash) : undefined);
    if (match === undefined) return { key: source.key, private: true };
    const kitName = kit !== null ? creditName(kit.name) : null;
    if (kit?.ref && kit.ref === match.ref && kitName !== null) return { key: source.key, ref: kit.ref, name: kitName };
    return { key: source.key, ref: match.ref, name: match.name };
  });
}

function backupOf(record: MapMergeRecord, sources: readonly PlanSource[], credits: KitMapMergeSource[]): MapBackupBody {
  // The merged skill goes into every tool that held an original (KTD13).
  const tools = [...new Set(sources.flatMap((source) => source.entry.tools))].filter((tool) => TOOL_RE.test(tool)).slice(0, 64);
  return {
    files: encodeBundle(skillBundle(record.skill)),
    name: record.name,
    description: record.description,
    tools,
    origin: "merge",
    sources: credits,
  };
}

/** Why a backup the account refused for good leaves the merge waiting. */
function backupReason(put: Extract<MapBackupPut, { ok: false }>): string {
  if (put.reason === "quota") return "backup-quota";
  if (put.reason === "secret") return "backup-secret";
  return "not-backed-up";
}

const WRITTEN: ReadonlySet<KitMapMerge["status"]> = new Set<KitMapMerge["status"]>(["ready", "picked", "applied"]);

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/** Write and store this computer's waiting merges (see the module comment). */
export async function runMapMerges(opts: MapMergeRunOptions): Promise<MapMergeRunResult> {
  const { client, signal } = opts;
  const limits: MapMergeLimits = { ...MAP_MERGE_LIMITS, ...opts.limits };
  const out: MapMergeRunResult = { writer: null, outcomes: [], written: 0, waiting: 0, changed: false };

  // 1. What waits, and what the account already holds.
  let merges: KitMapPendingMerge[];
  let known: Map<string, KitMapMerge>;
  try {
    merges = (await client.listChanges()).filter((change): change is KitMapPendingMerge => change.kind === "merge");
    if (merges.length === 0) return out;
    known = new Map((await client.listMerges()).map((merge) => [merge.id, merge]));
  } catch {
    return { ...out, reason: "registry-unreachable" };
  }

  const tally = (outcome: MapMergeOutcome): void => {
    out.outcomes.push(outcome);
    if (outcome.result === "written") out.written++;
    else if (outcome.result === "waiting") out.waiting++;
    opts.onOutcome?.(outcome, out.writer);
  };
  const ack = async (id: string, outcome: string): Promise<void> => {
    try {
      await client.ackChange(id, outcome);
      out.changed = true;
    } catch {
      // Still waiting on the account: the next run finds it done and acknowledges it then.
    }
  };
  const tell = async (id: string, report: KitMapMergeReport): Promise<boolean> => {
    try {
      await client.reportMerge(id, report);
      return true;
    } catch {
      return false;
    }
  };

  // The ones the account already holds as written, or as out of date, are done.
  // With nobody at Save, one that failed in the last day waits (see `unattended`).
  const now = opts.now?.() ?? Math.floor(Date.now() / 1000);
  const open: KitMapPendingMerge[] = [];
  for (const change of merges) {
    const account = known.get(change.id);
    if (account !== undefined && WRITTEN.has(account.status)) await ack(change.id, "written");
    else if (account?.status === "out-of-date") await ack(change.id, "out-of-date");
    else if (opts.unattended && account?.status === "failed" && now - account.updatedAt < RETRY_FAILED_AFTER_S) {
      tally({ id: change.id, job: change.job, result: "waiting", reason: account.reason ?? "writer-failed" });
    } else open.push(change);
  }
  if (open.length === 0) return out;

  // 2. What each of the rest needs, against a fresh scan.
  let scan: MapScanResult;
  try {
    scan = typeof opts.scan === "function" ? await opts.scan() : opts.scan;
  } catch {
    return { ...out, reason: "scan-failed" };
  }
  const scanned = new Map(scan.entries.map((entry) => [entry.key, entry]));
  const plans: Plan[] = [];
  for (const change of open) {
    const planned = await planMerge(change, scanned, limits);
    if (planned.kind === "write") {
      plans.push(planned.plan);
      continue;
    }
    if (planned.kind === "wait") {
      tally({ id: change.id, job: change.job, result: "waiting", reason: planned.reason });
      continue;
    }
    const outOfDate = planned.reason === "sources-changed";
    await dropRecord(change.id);
    await tell(change.id, outOfDate ? { status: "out-of-date", reason: planned.reason } : { status: "failed", reason: planned.reason });
    await ack(change.id, outOfDate ? "out-of-date" : "not-mergeable");
    tally({ id: change.id, job: change.job, result: "dropped", reason: planned.reason });
  }

  // 3. The AI tool, only when a merge needs writing.
  const toWrite = plans.filter((plan) => plan.record === null).length;
  let writer: MergeWriter | null = null;
  if (toWrite > 0 && !signal?.aborted) {
    try {
      writer = await opts.writer();
    } catch {
      writer = null;
    }
    out.writer = writer?.name ?? null;
    if (writer !== null) opts.onStart?.({ merges: toWrite, writer: writer.name });
  }

  // 4-7. Write, keep, credit, store.
  let unreachable = false;
  for (const plan of plans) {
    const { change } = plan;
    const wait = (reason: string): void => tally({ id: change.id, job: change.job, result: "waiting", reason });
    if (signal?.aborted) {
      wait("stopped");
      continue;
    }
    if (unreachable) {
      wait("registry-unreachable");
      continue;
    }

    let record = plan.record;
    if (record === null) {
      if (writer === null) {
        await tell(change.id, { status: "failed", reason: "no-ai-tool" });
        wait("no-ai-tool");
        continue;
      }
      if (!(await tell(change.id, { status: "writing" }))) {
        unreachable = true;
        wait("registry-unreachable");
        continue;
      }
      try {
        record = await compose(writer, plan, limits, signal);
      } catch (err) {
        const reason = err instanceof MergeWriterError ? err.reason : "writer-failed";
        await tell(change.id, { status: "failed", reason });
        wait(reason);
        continue;
      }
      try {
        await keepRecord(record);
      } catch {
        // Stored below all the same; only a run that stops first would write it again.
      }
    }

    let credits: KitMapMergeSource[];
    let put: MapBackupPut;
    try {
      credits = await creditsFor(plan.sources, client);
      put = await client.putBackup(record.merged, backupOf(record, plan.sources, credits));
    } catch {
      unreachable = true;
      wait("registry-unreachable");
      continue;
    }
    if (!put.ok) {
      if (!put.final) {
        unreachable = true;
        wait("registry-unreachable");
        continue;
      }
      // A secret in what was written: the next run writes it afresh. Anything else keeps it for a retry.
      if (put.reason === "secret") await dropRecord(change.id);
      const reason = backupReason(put);
      await tell(change.id, { status: "failed", reason });
      wait(reason);
      continue;
    }
    if (!(await tell(change.id, { status: "ready", merged: record.merged, brief: record.brief, rounds: record.rounds }))) {
      unreachable = true;
      wait("registry-unreachable");
      continue;
    }
    out.changed = true;
    await ack(change.id, "written");
    try {
      await keepRecord({ ...record, storedAt: new Date().toISOString() });
    } catch {
      // The account holds it; the record still names the bundle this computer wrote.
    }
    const linked = credits.filter((source) => !("private" in source)).length;
    tally({ id: change.id, job: change.job, result: "written", linked, private: credits.length - linked });
  }
  return out;
}
