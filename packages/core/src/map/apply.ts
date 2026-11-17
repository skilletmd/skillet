/**
 * Save making the fixes on this computer (plan U11, KTD7 KTD8 KTD9 KTD10
 * KTD16; R6 R7 R12 R18 R19; AE3).
 *
 * One pass, the same for a Save pressed in the map (`mode: "save"`) and for the
 * app's `skillet map --apply` (`mode: "apply"`, no drafts):
 *
 *   1. Read the account: the saved map and the changes waiting for this
 *      computer, and claim device-less ones (a dropped-folder Save) whose
 *      hashes this scan holds.
 *   2. Record every drafted remove and merge not already waiting as this
 *      computer's change, before anything else happens, so a run that dies
 *      partway leaves a record of what's left. If that fails, nothing happens.
 *   3. Back up: on Save, every local skill, kept or removed; on apply, only the
 *      local skills a waiting remove is about to move. By hash, skipping the
 *      hashes the account holds, never through publish and never into the kit
 *      store.
 *   4. Apply the waiting removes by the folder rules: the person's own folders
 *      go to the map trash, Skillet's imports leave the kit store and their
 *      folders go to the map trash, another maker's skill leaves through kit
 *      removal (sync then takes its folders), and a plugin, synced, app-managed
 *      or own published skill changes no file: the result names what to turn
 *      off. Each one is acknowledged.
 *   5. Fill each pick through the normal kit add. Moves change assignments
 *      only. Merges stay waiting for the merge step; a replace too.
 *   6. Save the map with the version read, re-reading on a conflict.
 *
 * Every step can run again: backups go by hash, the trash moves only folders
 * still present, and a waiting remove whose skill is gone is acknowledged as
 * gone. Paths never leave this module: the account sees hashes, names and jobs.
 */
import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  SKILL_ENTRYPOINT,
  canonicalContentHash,
  encodeBundle,
  isSkilletBackupPath,
  type BundleFiles,
  type DecodedBundle,
} from "@skillet/protocol";
import type { JobId } from "@skillet/protocol/jobs";
import {
  deriveKitMapChanges,
  parseKitMapDocument,
  toSavedEntry,
  type KitMapDocument,
  type KitMapDraft,
  type KitMapEntry,
  type KitMapPendingChange,
  type KitMapSaveCounts,
  type KitMapSavedEntry,
} from "@skillet/protocol/kit-map";
import { readState, writeState } from "../kit/store.js";
import type { MapSource } from "./folder-rules.js";
import { trashMapFolders, type MapTrashResult, type MapTrashTarget } from "./remove-trash.js";
import type { MapScanEntry, MapScanResult } from "./scan.js";

// ---------------------------------------------------------------------------
// The account, as Save needs it
// ---------------------------------------------------------------------------

/** What a backup carries besides its hash: the registry's `PUT /backups/:hash` body. */
export interface MapBackupBody {
  files: BundleFiles;
  name: string;
  description: string;
  tools: string[];
  origin: "scan";
}

/** `final`: retrying won't help (a secret, a quota, a size cap); otherwise the next run tries again. */
export type MapBackupPut = { ok: true } | { ok: false; reason: string; file?: string; final: boolean };
export type MapFillResult = { ok: true } | { ok: false; reason: string; final: boolean };
export type MapKitRemoval = { ok: true } | { ok: false; reason: string; final: boolean };

export type MapChangeInput = { kind: "remove"; key: string } | { kind: "merge"; job: JobId; keys: string[] };

/**
 * The registry calls Save makes, as this computer. A method that throws is a
 * failure the next run retries (the registry is down, the network dropped).
 */
export interface MapApplyClient {
  /** This computer's waiting changes. */
  listChanges(): Promise<KitMapPendingChange[]>;
  /** Device-less changes whose every hash is in `keys`, now this computer's. */
  claimChanges(keys: string[]): Promise<KitMapPendingChange[]>;
  recordChanges(changes: MapChangeInput[]): Promise<KitMapPendingChange[]>;
  /** Acknowledge one change, once. Already acknowledged counts as done. */
  ackChange(id: string, outcome: string): Promise<void>;
  /** The hashes the account already backs up. */
  listBackups(): Promise<ReadonlySet<string>>;
  putBackup(hash: string, body: MapBackupBody): Promise<MapBackupPut>;
  /** Take another maker's skill out of the person's kit, the way the web does. */
  removeFromKit(ref: { owner: string; slug: string }): Promise<MapKitRemoval>;
  /** Add a pick (`@owner/slug`) through the normal kit add. */
  fill(ref: string): Promise<MapFillResult>;
  /** The saved map, or null when the account has none yet. */
  readMap(): Promise<KitMapDocument | null>;
  /** Write it with the version read; "conflict" when someone wrote first. */
  writeMap(doc: KitMapDocument): Promise<"ok" | "conflict">;
}

// ---------------------------------------------------------------------------
// Options and the result
// ---------------------------------------------------------------------------

export interface MapApplyOptions {
  /** `save`: a person pressed Save on these drafts. `apply`: this computer's waiting changes only. */
  mode: "save" | "apply";
  /** A fresh scan of this computer: the only place paths come from. */
  scan: MapScanResult;
  /** The scan as the map shows it (names, jobs, sources), with nothing that stays on the computer. */
  wire: (scan: MapScanResult) => KitMapEntry[];
  client: MapApplyClient;
  drafts?: readonly KitMapDraft[];
  /** The entries the drafts were drafted on. Defaults to the fresh scan's. */
  draftedOn?: readonly KitMapEntry[];
  /** Scan again after picks were added, so the saved map holds them. */
  rescan?: () => Promise<MapScanResult>;
  /** Where Save is: `saving` while it records and backs up, `applying` while it changes files. */
  onStep?: (step: "saving" | "applying") => void;
  /** Stops at the next safe point; what's left stays recorded. */
  signal?: AbortSignal;
}

export interface MapNotBackedUp {
  name: string;
  reason: string;
  /** The one file to clean, by its name alone. */
  file?: string;
}

/** A Remove that changes no file, and what it names instead (R7). */
export interface MapKeptRemove {
  name: string;
  kind: "plugin" | "organization" | "app" | "own";
  /** The plugin or organization's name, the app's folder name, or the skill's `@owner/slug`. */
  owner: string;
}

export interface MapUnremoved {
  name: string;
  /** `outside-allowlist`, `not-in-your-kit`, …: retrying won't help. */
  reason: string;
}

export interface MapRefusedFill {
  ref: string;
  reason: string;
}

export interface MapApplyResult {
  result: "applied" | "partial" | "failed";
  /** A short code for why it stopped or what didn't finish. */
  reason?: string;
  /** What this run did. */
  counts: KitMapSaveCounts;
  /** What's left for the next run. */
  left: KitMapSaveCounts;
  notBackedUp: MapNotBackedUp[];
  kept: MapKeptRemove[];
  unremoved: MapUnremoved[];
  refused: MapRefusedFill[];
  /** The map-trash run this Save made, if it moved anything. */
  trashRun: string | null;
  /** Whether anything on this computer or the account changed. */
  changed: boolean;
}

function zero(): KitMapSaveCounts {
  return { backups: 0, removals: 0, fills: 0, merges: 0 };
}

const REMOVABLE: ReadonlySet<MapSource> = new Set<MapSource>(["local", "skillet-imported", "skillet-added"]);

// ---------------------------------------------------------------------------
// Reading a skill the way the scan keys it
// ---------------------------------------------------------------------------

async function walkSkill(dir: string, rel: string, out: DecodedBundle): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const name = entry.name;
    if (name.startsWith(".") || isSkilletBackupPath(name)) continue;
    const abs = join(dir, name);
    const relPath = rel === "" ? name : `${rel}/${name}`;
    const info = await lstat(abs);
    if (info.isSymbolicLink()) {
      // A link is never part of a skill, except a linked SKILL.md, read as SKILL.md.
      if (relPath === SKILL_ENTRYPOINT) {
        const target = await realpath(abs);
        if ((await stat(target)).isFile()) out.set(SKILL_ENTRYPOINT, await readFile(target));
      }
      continue;
    }
    if (info.isDirectory()) await walkSkill(abs, relPath, out);
    else if (info.isFile()) out.set(relPath, await readFile(abs));
  }
}

/**
 * A skill folder's files by the scan's key rule (./scan.ts): the folder is
 * walked without following links, names that start with a dot and Skillet's
 * `*.skillet-backup` files are skipped, and a linked SKILL.md is read as
 * SKILL.md. Its canonical hash is the scan's key for it.
 */
export async function readMapSkillBundle(dir: string): Promise<DecodedBundle> {
  const out: DecodedBundle = new Map();
  await walkSkill(await realpath(dir), "", out);
  return out;
}

// ---------------------------------------------------------------------------
// Remove, by the folder rules
// ---------------------------------------------------------------------------

type RemovePlan =
  | { kind: "gone" }
  | { kind: "kept"; kept: MapKeptRemove }
  | {
      kind: "remove";
      name: string;
      trash: MapTrashTarget[];
      /** Skillet's own imports: their kit-store entries leave with their folders. */
      imports: string[];
      kit: Array<{ owner: string; slug: string }>;
    };

function keptOf(entry: MapScanEntry, name: string): MapKeptRemove {
  const owner = entry.owner;
  switch (entry.source) {
    case "plugin":
      return { name, kind: "plugin", owner: owner?.kind === "plugin" ? owner.name : "a plugin" };
    case "synced":
      return { name, kind: "organization", owner: owner?.kind === "organization" ? owner.name : "an organization" };
    case "app":
      return { name, kind: "app", owner: owner?.kind === "app" ? owner.name : "an app" };
    default: {
      const own = entry.locations.find((l) => l.source === "skillet-own" && l.skillet !== null)?.skillet;
      return { name, kind: "own", owner: own?.maker ? `@${own.maker}/${own.slug}` : name };
    }
  }
}

function planRemove(entry: MapScanEntry | undefined, name: string): RemovePlan {
  if (entry === undefined) return { kind: "gone" };
  // R7: a plugin's, an organization's, an app's or the person's own published skill is never touched.
  if (!REMOVABLE.has(entry.source)) return { kind: "kept", kept: keptOf(entry, name) };
  const plan: Extract<RemovePlan, { kind: "remove" }> = { kind: "remove", name, trash: [], imports: [], kit: [] };
  for (const location of entry.locations) {
    if (location.source === "local") {
      plan.trash.push({ key: entry.key, name, source: "local", path: location.path });
    } else if (location.source === "skillet-imported") {
      plan.trash.push({ key: entry.key, name, source: "skillet-imported", path: location.path });
      const slug = location.skillet?.slug;
      if (slug && !plan.imports.includes(slug)) plan.imports.push(slug);
    } else if (location.source === "skillet-added" && location.skillet?.maker) {
      const ref = { owner: location.skillet.maker, slug: location.skillet.slug };
      if (!plan.kit.some((k) => k.owner === ref.owner && k.slug === ref.slug)) plan.kit.push(ref);
    }
  }
  return plan;
}

/** Take Skillet's local imports out of the kit store, so sync doesn't write them back. */
async function leaveKitStore(slugs: readonly string[]): Promise<boolean> {
  if (slugs.length === 0) return true;
  try {
    const state = await readState();
    let changed = false;
    for (const slug of slugs) {
      if (state.skills[slug]?.source === "local") {
        delete state.skills[slug];
        changed = true;
      }
    }
    if (changed) await writeState(state);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// The saved map
// ---------------------------------------------------------------------------

/** One saved entry the protocol takes, or null. */
function savedEntryOf(entry: KitMapEntry): KitMapSavedEntry | null {
  const saved = toSavedEntry(entry);
  return parseKitMapDocument({ version: 0, entries: [saved], assignments: {} }) ? saved : null;
}

function buildDocument(
  base: KitMapDocument | null,
  entries: readonly KitMapEntry[],
  removed: ReadonlySet<string>,
  jobOf: (entry: KitMapEntry, saved: JobId | null | undefined) => JobId | null,
): KitMapDocument {
  const kept = new Map<string, KitMapSavedEntry>();
  for (const entry of base?.entries ?? []) if (!removed.has(entry.key)) kept.set(entry.key, entry);
  const assignments: Record<string, JobId | null> = {};
  for (const [key, job] of Object.entries(base?.assignments ?? {})) if (kept.has(key)) assignments[key] = job;
  for (const entry of entries) {
    if (removed.has(entry.key)) continue;
    const saved = savedEntryOf(entry);
    if (!saved) continue;
    kept.set(entry.key, saved);
    assignments[entry.key] = jobOf(entry, base?.assignments[entry.key]);
  }
  return { version: base?.version ?? 0, entries: [...kept.values()], assignments };
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

const sameKeys = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join();

function dedupe(changes: readonly KitMapPendingChange[]): KitMapPendingChange[] {
  const seen = new Set<string>();
  return changes.filter((change) => (seen.has(change.id) ? false : (seen.add(change.id), true)));
}

/** Run Save's steps on this computer (see the module comment). */
export async function runMapApply(opts: MapApplyOptions): Promise<MapApplyResult> {
  const { client, signal } = opts;
  const out: MapApplyResult = {
    result: "applied",
    counts: zero(),
    left: zero(),
    notBackedUp: [],
    kept: [],
    unremoved: [],
    refused: [],
    trashRun: null,
    changed: false,
  };
  const wire = opts.wire(opts.scan);
  const wireByKey = new Map(wire.map((entry) => [entry.key, entry]));
  const scanByKey = new Map(opts.scan.entries.map((entry) => [entry.key, entry]));
  const nameOf = (key: string, entry?: MapScanEntry): string => wireByKey.get(key)?.name ?? entry?.name ?? "a skill";

  const drafts = opts.mode === "save" ? (opts.drafts ?? []) : [];
  const derived = deriveKitMapChanges(drafts, opts.draftedOn ?? wire);
  const removeDrafts = derived.changes.filter((c): c is Extract<KitMapDraft, { kind: "remove" }> => c.kind === "remove");
  const mergeDrafts = derived.changes.filter((c): c is Extract<KitMapDraft, { kind: "merge" }> => c.kind === "merge");
  const fillDrafts = derived.changes.filter((c): c is Extract<KitMapDraft, { kind: "fill" }> => c.kind === "fill");
  const moved = new Set(
    derived.changes.filter((c): c is Extract<KitMapDraft, { kind: "move" }> => c.kind === "move").map((c) => c.key),
  );
  const backupCandidates = (removing: ReadonlySet<string>): MapScanEntry[] =>
    opts.scan.entries.filter((e) => e.source === "local" && (opts.mode === "save" || removing.has(e.key)));

  const stop = (reason: string, left: KitMapSaveCounts): MapApplyResult => ({ ...out, result: "failed", reason, left });

  // 1. The account's side: the saved map and what waits for this computer.
  let doc: KitMapDocument | null = null;
  let docRead = true;
  try {
    doc = await client.readMap();
  } catch {
    docRead = false;
  }
  let waiting: KitMapPendingChange[];
  try {
    waiting = await client.listChanges();
  } catch {
    return stop("registry-unreachable", {
      backups: backupCandidates(new Set()).length,
      removals: removeDrafts.length,
      fills: fillDrafts.length,
      merges: mergeDrafts.length,
    });
  }
  // On Save every hash this map is about to save goes up anyway; on apply, only hashes the saved map already holds.
  const known = new Set((doc?.entries ?? []).map((e) => e.key));
  const claimKeys = opts.scan.entries
    .filter((e) => REMOVABLE.has(e.source) && (opts.mode === "save" || known.has(e.key)))
    .map((e) => e.key);
  if (claimKeys.length > 0 && (opts.mode === "save" || docRead)) {
    try {
      const claimed = await client.claimChanges(claimKeys);
      if (claimed.length > 0) out.changed = true;
      waiting = dedupe([...waiting, ...claimed]);
    } catch {
      // Device-less changes wait for the next run.
    }
  }

  // 2. Record what was drafted, before anything else happens.
  const toRecord: MapChangeInput[] = [];
  for (const draft of removeDrafts) {
    if (!waiting.some((w) => w.kind === "remove" && w.key === draft.key)) toRecord.push({ kind: "remove", key: draft.key });
  }
  for (const draft of mergeDrafts) {
    if (!waiting.some((w) => w.kind === "merge" && w.job === draft.job && sameKeys(w.keys, draft.keys))) {
      toRecord.push({ kind: "merge", job: draft.job, keys: [...draft.keys] });
    }
  }
  if (toRecord.length > 0) {
    try {
      waiting = dedupe([...waiting, ...(await client.recordChanges(toRecord))]);
    } catch {
      return stop("registry-unreachable", {
        backups: backupCandidates(new Set()).length,
        removals: removeDrafts.length,
        fills: fillDrafts.length,
        merges: mergeDrafts.length,
      });
    }
    out.changed = true;
  }
  out.counts.merges = mergeDrafts.length;

  const removes = waiting.filter((c): c is Extract<KitMapPendingChange, { kind: "remove" }> => c.kind === "remove");
  const removing = new Set(removes.map((c) => c.key));

  // 3. Back up.
  opts.onStep?.("saving");
  const candidates = backupCandidates(removing);
  const able: MapScanEntry[] = [];
  for (const entry of candidates) {
    const block = entry.flags.cantBackUp[0];
    if (block !== undefined) out.notBackedUp.push({ name: nameOf(entry.key, entry), reason: block });
    else able.push(entry);
  }
  if (able.length > 0) {
    let stored: ReadonlySet<string> | null = null;
    try {
      stored = await client.listBackups();
    } catch {
      out.left.backups += able.length;
    }
    for (const entry of stored === null ? [] : able) {
      if (signal?.aborted) {
        out.left.backups++;
        continue;
      }
      if (stored!.has(entry.key)) {
        out.counts.backups++;
        continue;
      }
      const body = await backupBody(entry, wireByKey.get(entry.key));
      if (body === null) {
        out.left.backups++;
        continue;
      }
      let put: MapBackupPut;
      try {
        put = await client.putBackup(entry.key, body);
      } catch {
        out.left.backups++;
        continue;
      }
      if (put.ok) {
        out.counts.backups++;
        out.changed = true;
      } else if (put.final) {
        out.notBackedUp.push({ name: nameOf(entry.key, entry), reason: put.reason, ...(put.file ? { file: put.file } : {}) });
      } else {
        out.left.backups++;
      }
    }
  }

  // 4. Remove, by the folder rules.
  opts.onStep?.("applying");
  const removed = new Set<string>();
  // One plan per skill: a second waiting remove of the same hash is acknowledged with the first.
  const twins = new Map<string, string[]>();
  const plans: Array<{ change: Extract<KitMapPendingChange, { kind: "remove" }>; plan: RemovePlan }> = [];
  for (const change of removes) {
    const ids = twins.get(change.key);
    if (ids) {
      ids.push(change.id);
      continue;
    }
    twins.set(change.key, []);
    const entry = scanByKey.get(change.key);
    plans.push({ change, plan: planRemove(entry, nameOf(change.key, entry)) });
  }
  const acks: Array<{ id: string; outcome: string }> = [];
  if (signal?.aborted) {
    out.left.removals += plans.filter((p) => p.plan.kind === "remove").length;
  } else {
    // Imports leave the kit store first: if that fails, their folders stay where they are.
    const imports = plans.flatMap((p) => (p.plan.kind === "remove" ? p.plan.imports : []));
    const storeLeft = await leaveKitStore(imports);
    if (storeLeft && imports.length > 0) out.changed = true;
    const targets = plans.flatMap((p) =>
      p.plan.kind === "remove" && (storeLeft || p.plan.imports.length === 0) ? p.plan.trash : [],
    );
    let trash: MapTrashResult = { runId: null, moved: [], skipped: [] };
    if (targets.length > 0) {
      try {
        trash = await trashMapFolders(targets);
      } catch {
        trash = { runId: null, moved: [], skipped: targets.map((t) => ({ ...t, reason: "move-failed" as const })) };
      }
    }
    out.trashRun = trash.runId;
    if (trash.moved.length > 0) out.changed = true;

    for (const { change, plan } of plans) {
      if (plan.kind === "gone") {
        acks.push({ id: change.id, outcome: "gone" });
        continue;
      }
      if (plan.kind === "kept") {
        out.kept.push(plan.kept);
        acks.push({ id: change.id, outcome: `kept-${plan.kept.kind}` });
        continue;
      }
      if (!storeLeft && plan.imports.length > 0) {
        out.left.removals++;
        continue;
      }
      const mine = (path: string) => plan.trash.some((t) => t.path === path);
      const movedHere = trash.moved.filter((m) => m.key === change.key && mine(m.path)).length;
      const skips = trash.skipped.filter((s) => s.key === change.key && mine(s.path));
      let retry = skips.some((s) => s.reason === "move-failed");
      let done = movedHere + skips.filter((s) => s.reason === "missing").length;
      let refusal: string | undefined = skips.find((s) => s.reason === "outside-allowlist")?.reason;
      for (const ref of plan.kit) {
        let removal: MapKitRemoval;
        try {
          removal = await client.removeFromKit(ref);
        } catch {
          retry = true;
          continue;
        }
        if (removal.ok) {
          done++;
          out.changed = true;
        } else if (removal.final) refusal ??= removal.reason;
        else retry = true;
      }
      if (retry) {
        out.left.removals++;
      } else if (done === 0 && refusal !== undefined) {
        out.unremoved.push({ name: plan.name, reason: refusal });
        acks.push({ id: change.id, outcome: "not-removable" });
      } else {
        out.counts.removals++;
        removed.add(change.key);
        acks.push({ id: change.id, outcome: "applied" });
      }
    }
  }
  for (const ack of [...acks]) {
    const change = removes.find((c) => c.id === ack.id);
    for (const id of change ? (twins.get(change.key) ?? []) : []) acks.push({ id, outcome: ack.outcome });
  }
  for (const ack of acks) {
    try {
      await client.ackChange(ack.id, ack.outcome);
    } catch {
      // Still waiting on the account: the next run finds it done or gone and acknowledges it then.
    }
  }

  // 5. Fill each pick through the normal kit add.
  const filled: Array<Extract<KitMapDraft, { kind: "fill" }>> = [];
  for (const fill of fillDrafts) {
    if (signal?.aborted) {
      out.left.fills++;
      continue;
    }
    let result: MapFillResult;
    try {
      result = await client.fill(fill.ref);
    } catch {
      out.left.fills++;
      continue;
    }
    if (result.ok) {
      out.counts.fills++;
      out.changed = true;
      filled.push(fill);
    } else if (result.final) out.refused.push({ ref: fill.ref, reason: result.reason });
    else out.left.fills++;
  }

  // 6. Save the map: on Save, with this computer's entries; on apply, only to
  // take out what left, so nothing new about this computer's skills goes up.
  let mapSaved = true;
  if (!signal?.aborted && (opts.mode === "save" || removed.size > 0)) {
    let final: readonly KitMapEntry[] = opts.mode === "save" ? wire : [];
    if (opts.mode === "save" && filled.length > 0 && opts.rescan) {
      try {
        final = opts.wire(await opts.rescan());
      } catch {
        // The picks join the map on the next Save.
      }
    }
    const jobOf = (entry: KitMapEntry, saved: JobId | null | undefined): JobId | null => {
      if (moved.has(entry.key)) return derived.jobs.get(entry.key) ?? null;
      if (saved !== undefined) return saved;
      const pick = entry.skillet?.ref ? filled.find((f) => f.ref === entry.skillet?.ref) : undefined;
      if (pick) return pick.job;
      return derived.jobs.has(entry.key) ? (derived.jobs.get(entry.key) ?? null) : entry.job;
    };
    mapSaved = await saveMap(client, docRead ? doc : null, !docRead, final, removed, jobOf);
    if (mapSaved) out.changed = true;
  }

  const leftOver = Object.values(out.left).some((n) => n > 0);
  if (signal?.aborted) {
    out.result = "partial";
    out.reason = "stopped";
  } else if (leftOver || !mapSaved) {
    out.result = "partial";
    out.reason = mapSaved ? "registry-unreachable" : "map-not-saved";
  }
  return out;
}

async function backupBody(entry: MapScanEntry, shown: KitMapEntry | undefined): Promise<MapBackupBody | null> {
  const location = entry.locations.find((l) => l.source === "local");
  if (!location) return null;
  let bundle: DecodedBundle;
  try {
    bundle = await readMapSkillBundle(location.path);
  } catch {
    return null;
  }
  // The folder changed since the scan: the next Save backs up what's there then.
  if (canonicalContentHash(bundle) !== entry.key) return null;
  return {
    files: encodeBundle(bundle),
    name: shown?.name ?? entry.name,
    description: shown?.description ?? "",
    tools: shown?.tools.map((t) => t.tool) ?? [],
    origin: "scan",
  };
}

async function saveMap(
  client: MapApplyClient,
  base: KitMapDocument | null,
  readFirst: boolean,
  entries: readonly KitMapEntry[],
  removed: ReadonlySet<string>,
  jobOf: (entry: KitMapEntry, saved: JobId | null | undefined) => JobId | null,
): Promise<boolean> {
  let current = base;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0 || readFirst) {
      try {
        current = await client.readMap();
      } catch {
        return false;
      }
    }
    let written: "ok" | "conflict";
    try {
      written = await client.writeMap(buildDocument(current, entries, removed, jobOf));
    } catch {
      return false;
    }
    if (written === "ok") return true;
  }
  return false;
}
