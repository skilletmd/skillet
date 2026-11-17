/**
 * Save in `skillet map` (plan U11, KTD6 KTD7 KTD8 KTD10 KTD16; R18 F1).
 *
 * A computer that isn't connected opens a map session when the person presses
 * Save: the CLI registers the hash of a one-time proof, hands the frame the
 * session and the proof, and polls with a secret the browser never sees until
 * the signed-in person approves on skillet.md/map/save. The code it gets back
 * is redeemed without the device token stored here (another account's, maybe),
 * which writes this computer's own device.json. A computer that is connected
 * skips all that: the frame names its account, and Save goes on once the
 * person confirms.
 *
 * Then, under the save lock, core's runMapApply makes the fixes (records the
 * drafted changes, backs up, removes by the folder rules, fills, saves the map),
 * and the CLI reports how it went to the session. An expired session leaves
 * the map open for another try; a Save that changed things and stopped partway
 * ends the run with a failure, and the next `skillet map` (or the app's
 * `skillet map --apply`) finishes what the account still holds.
 *
 * The registry only ever sees hashes, names and jobs: no path leaves this
 * computer, and the proof never goes to the registry.
 */
import { createHash, randomBytes } from "node:crypto";
import { Writable } from "node:stream";
import {
  REGISTRY_API,
  RegistryError,
  acquireMapSaveLock,
  add,
  authConnectFreshPair,
  defaultMachineLabel,
  loadSessionToken,
  materializeSkills,
  readDeviceFile,
  readState,
  runMapApply,
  SignatureError,
  type Adapter,
  type MapApplyClient,
  type MapApplyResult,
  type MapBackupBody,
  type MapBackupPut,
  type MapFillResult,
  type MapKitRemoval,
  type MapNotBackedUp,
  type MapScanResult,
} from "@skillet/core";
import {
  parseKitMapDocument,
  parseKitMapPendingChange,
  type KitMapDocument,
  type KitMapDraft,
  type KitMapEntry,
  type KitMapPendingChange,
  type KitMapSaveCounts,
} from "@skillet/protocol/kit-map";
import { ADDITIONAL_ADAPTERS, BASELINE_GLOBAL_ADAPTERS } from "../cli-context.js";
import { fail, ok } from "../cli-colors.js";
import type { MapFrameLink, MapSaveHandler } from "./loopback-server.js";

/** How often the CLI asks whether the person has approved. */
const POLL_MS = 2_000;
/**
 * The gap between two writes: backup uploads share the registry's 300 writes a
 * minute per address, so this stays under it with room for the rest.
 */
const PACE_MS = 220;
/** How many times one request follows a 429's Retry-After before giving up. */
const MAX_RATE_RETRIES = 5;
/** The longest one Retry-After is waited out. */
const MAX_RETRY_AFTER_MS = 120_000;
const REQUEST_TIMEOUT_MS = 120_000;
/** A session the registry never calls expired is given up this long after its expiry. */
const EXPIRY_GRACE_MS = 60_000;
/** How long the map stays up after Save ends it, so the page's next read carries the last status. */
const FINISH_GRACE_MS = 1_500;
const SESSION_ID_RE = /^[0-9a-f]{32}$/;
const SECRET_RE = /^[A-Za-z0-9_-]{32,256}$/;
const HANDLE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,38}$/;

// ---------------------------------------------------------------------------
// Talking to the registry
// ---------------------------------------------------------------------------

interface Answer {
  status: number;
  body: unknown;
}

interface Wire {
  registryUrl: string;
  fetchImpl: typeof fetch;
  paceMs: number;
  signal?: AbortSignal;
}

class Stopped extends Error {}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

/**
 * A signal that aborts after `ms` or with `outer`, whichever comes first, and
 * `done` to drop its timer. Built by hand: the Bun-compiled binary and the Node
 * fallback both have AbortController, not every build has AbortSignal.any.
 */
export function requestSignal(outer: AbortSignal | undefined, ms: number): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const onAbort = (): void => controller.abort();
  if (outer?.aborted) controller.abort();
  else outer?.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onAbort);
    },
  };
}

/** Seconds or an HTTP date, as RFC 9110 allows; at least a second, at most the cap. */
function retryAfterMs(header: string | null): number {
  const seconds = header !== null && /^\d+$/.test(header.trim()) ? Number(header.trim()) * 1000 : NaN;
  const date = header !== null && Number.isNaN(seconds) ? Date.parse(header) - Date.now() : NaN;
  const wait = Number.isFinite(seconds) ? seconds : Number.isFinite(date) ? date : 1000;
  return Math.min(Math.max(wait, 1000), MAX_RETRY_AFTER_MS);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One credential's calls: writes spaced by `paceMs`, and a 429 waited out per its Retry-After. */
class Registry {
  private lastWrite = 0;

  constructor(
    private readonly wire: Wire,
    private readonly token: string | null,
  ) {}

  async send(method: string, path: string, body?: unknown, opts: { followRateLimit?: boolean } = {}): Promise<Answer> {
    const follow = opts.followRateLimit ?? true;
    for (let attempt = 0; ; attempt++) {
      if (this.wire.signal?.aborted) throw new Stopped();
      if (method !== "GET" && this.wire.paceMs > 0) {
        const wait = this.lastWrite + this.wire.paceMs - Date.now();
        if (wait > 0) await sleep(wait, this.wire.signal);
        this.lastWrite = Date.now();
      }
      const request = requestSignal(this.wire.signal, REQUEST_TIMEOUT_MS);
      let status: number;
      let parsed: unknown;
      let retryAfter: string | null;
      try {
        const res = await this.wire.fetchImpl(`${this.wire.registryUrl}${REGISTRY_API}${path}`, {
          method,
          headers: {
            accept: "application/json",
            ...(body !== undefined ? { "content-type": "application/json" } : {}),
            ...(this.token !== null ? { authorization: `Bearer ${this.token}` } : {}),
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
          signal: request.signal,
        });
        status = res.status;
        retryAfter = res.headers.get("retry-after");
        parsed = await res.json().catch(() => null);
      } finally {
        request.done();
      }
      if (status === 429 && follow && attempt < MAX_RATE_RETRIES) {
        await sleep(retryAfterMs(retryAfter), this.wire.signal);
        continue;
      }
      return { status, body: parsed };
    }
  }
}

function unexpected(what: string, answer: Answer): Error {
  return new Error(`${what}: HTTP ${answer.status}`);
}

function changesOf(value: unknown, field: string): KitMapPendingChange[] {
  const list = isRecord(value) && Array.isArray(value[field]) ? (value[field] as unknown[]) : [];
  return list.map((item) => parseKitMapPendingChange(item)).filter((c): c is KitMapPendingChange => c !== null);
}

/** The base name of a file a finding names, so the report never carries a folder. */
function fileName(path: unknown): string | undefined {
  if (typeof path !== "string") return undefined;
  const name = path.split(/[\\/]/).pop()?.trim() ?? "";
  return name !== "" && name !== "." && name !== ".." ? name : undefined;
}

function backupRefusal(answer: Answer): MapBackupPut {
  const body = isRecord(answer.body) ? answer.body : {};
  if (answer.status === 422 && body.error === "scan_blocked") {
    const finding = Array.isArray(body.findings) && isRecord(body.findings[0]) ? body.findings[0] : {};
    const file = fileName(finding.file);
    return { ok: false, reason: "secret", ...(file ? { file } : {}), final: true };
  }
  if (answer.status === 413) {
    return { ok: false, reason: body.error === "backup_quota_exceeded" ? "quota" : "too-large", final: true };
  }
  if (answer.status === 422 || answer.status === 400) return { ok: false, reason: "refused", final: true };
  return { ok: false, reason: "unavailable", final: false };
}

/** Why the registry wouldn't add a pick, or null when the next run should try again. */
function fillRefusal(err: unknown): MapFillResult {
  if (err instanceof SignatureError) return { ok: false, reason: "not-verified", final: true };
  const status = (err as { status?: number } | null)?.status;
  const code = (err as { code?: string } | null)?.code ?? "";
  if (err instanceof RegistryError || typeof status === "number") {
    if (/quarantin|scan|blocked/.test(code)) return { ok: false, reason: "not-scan-clean", final: true };
    if (status === 403 || status === 404 || status === 410 || status === 451) {
      return { ok: false, reason: "not-public", final: true };
    }
    if (code === "no_versions" || code === "version_yanked" || code === "unsigned_version" || code === "author_not_claimed") {
      return { ok: false, reason: "not-public", final: true };
    }
  }
  return { ok: false, reason: "unavailable", final: false };
}

const quiet = (): Writable =>
  new Writable({
    write(_chunk, _encoding, done) {
      done();
    },
  });

async function detectedGlobalAdapters(): Promise<Adapter[]> {
  const adapters: Adapter[] = [...BASELINE_GLOBAL_ADAPTERS];
  for (const adapter of ADDITIONAL_ADAPTERS) {
    if (adapter.kind === "project") continue;
    try {
      if (await adapter.detect()) adapters.push(adapter);
    } catch {
      // A detect that throws is a tool that isn't there.
    }
  }
  return adapters;
}

/**
 * Fill through the normal kit add (KTD16): verify and add the pick to the kit,
 * then write it into every AI tool this computer has, the global folders only.
 * The registry refuses a pick that isn't public and scan-clean.
 */
async function kitAddFill(ref: string, registryUrl: string, token: string): Promise<MapFillResult> {
  try {
    const added = await add(ref, { registryUrl, token });
    await materializeSkills(process.cwd(), await detectedGlobalAdapters(), {
      slugs: [added.entry.slug],
      token,
      registryUrl,
      quietSkipLines: true,
      autoApprove: true,
      skipPull: true,
      output: quiet(),
      baselineAdapterNames: BASELINE_GLOBAL_ADAPTERS.map((a) => a.name),
    });
    return { ok: true };
  } catch (err) {
    return fillRefusal(err);
  }
}

interface ClientDeps {
  wire: Wire;
  token: string;
  fill: (ref: string) => Promise<MapFillResult>;
}

/** Core's view of the registry, as this computer's device. */
function applyClient({ wire, token, fill }: ClientDeps): MapApplyClient {
  const device = new Registry(wire, token);
  return {
    async listChanges() {
      const answer = await device.send("GET", "/kit-map/changes");
      if (answer.status !== 200) throw unexpected("waiting changes", answer);
      return changesOf(answer.body, "changes");
    },
    async claimChanges(keys) {
      const answer = await device.send("POST", "/kit-map/changes/claim", { keys });
      if (answer.status !== 200) throw unexpected("claim", answer);
      return changesOf(answer.body, "claimed");
    },
    async recordChanges(changes) {
      const answer = await device.send("POST", "/kit-map/changes", { changes });
      if (answer.status !== 201) throw unexpected("record changes", answer);
      return changesOf(answer.body, "changes");
    },
    async ackChange(id, outcome) {
      const answer = await device.send("POST", `/kit-map/changes/${encodeURIComponent(id)}/ack`, { outcome });
      // Already acknowledged, or gone: either way it's done.
      if (answer.status === 200 || answer.status === 409 || answer.status === 404) return;
      throw unexpected("acknowledge", answer);
    },
    async listBackups() {
      const answer = await device.send("GET", "/backups");
      if (answer.status !== 200 || !isRecord(answer.body) || !Array.isArray(answer.body.backups)) {
        throw unexpected("backups", answer);
      }
      const hashes = new Set<string>();
      for (const row of answer.body.backups as unknown[]) {
        if (isRecord(row) && typeof row.hash === "string") hashes.add(row.hash);
      }
      return hashes;
    },
    async putBackup(hash: string, body: MapBackupBody) {
      const answer = await device.send("PUT", `/backups/${encodeURIComponent(hash)}`, body);
      if (answer.status === 200 || answer.status === 201) return { ok: true };
      if (answer.status === 401 || answer.status === 403) throw unexpected("backup", answer);
      return backupRefusal(answer);
    },
    async removeFromKit(ref): Promise<MapKitRemoval> {
      const entry = (await readState()).skills[`@${ref.owner}/${ref.slug}`];
      const kitId = entry?.sourceKitId;
      if (!kitId) return { ok: false, reason: "not-in-your-kit", final: true };
      // Kit edits are a signed-in session's, as on the web.
      const session = await loadSessionToken();
      if (!session.startsWith("skillet_s_")) return { ok: false, reason: "not-signed-in", final: true };
      const answer = await new Registry(wire, session).send(
        "DELETE",
        `/kits/${encodeURIComponent(kitId)}/skills/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.slug)}`,
      );
      if (answer.status === 200 || answer.status === 404) return { ok: true };
      if (answer.status === 403) return { ok: false, reason: "not-kit-owner", final: true };
      if (answer.status === 422) return { ok: false, reason: "linked-kit", final: true };
      return { ok: false, reason: "unavailable", final: false };
    },
    fill,
    async readMap() {
      const answer = await device.send("GET", "/kit-map");
      if (answer.status === 404) return null;
      const doc = answer.status === 200 ? parseKitMapDocument(answer.body) : null;
      if (!doc) throw unexpected("saved map", answer);
      return doc;
    },
    async writeMap(doc: KitMapDocument) {
      const answer = await device.send("PUT", "/kit-map", doc);
      if (answer.status === 200) return "ok";
      if (answer.status === 409) return "conflict";
      throw unexpected("save the map", answer);
    },
  };
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

const NOT_BACKED_UP: Readonly<Record<string, string>> = {
  "links-outside": "it links to files outside its folder",
  "over-25-mb": "it's over 25 MB",
  "instructions-over-1-mb": "its instructions are over 1 MB",
  "git-folder": "it holds a .git folder",
  "too-large": "it's bigger than a backup can be",
  quota: "your account holds as many backups as it can",
};

function notBackedUpLine(skipped: MapNotBackedUp): string {
  const why =
    skipped.reason === "secret"
      ? skipped.file
        ? `${skipped.file} looks like it holds a secret`
        : "a file in it looks like it holds a secret"
      : (NOT_BACKED_UP[skipped.reason] ?? "Skillet couldn't back it up");
  return `${skipped.name} isn't backed up: ${why}.`;
}

const UNREMOVED: Readonly<Record<string, string>> = {
  "outside-allowlist": "it isn't in a skills folder Skillet manages",
  "not-in-your-kit": "it isn't in a kit of yours",
  "not-kit-owner": "it came with a kit someone else owns",
  "linked-kit": "it came with a linked kit",
  "not-signed-in": "this machine isn't signed in to change your kit",
};

const REFUSED: Readonly<Record<string, string>> = {
  "not-public": "it isn't a public skill",
  "not-scan-clean": "it didn't pass Skillet's scan",
  "not-verified": "its signature didn't check out",
};

function leftText(left: KitMapSaveCounts): string {
  const parts = [
    left.backups > 0 ? `back up ${plural(left.backups, "skill")}` : null,
    left.removals > 0 ? `remove ${plural(left.removals, "skill")}` : null,
    left.fills > 0 ? `add ${plural(left.fills, "pick")}` : null,
    left.merges > 0 ? `start ${plural(left.merges, "merge")}` : null,
  ].filter((part): part is string => part !== null);
  return parts.join(", ");
}

/** What Save did, for the terminal. Never a path. */
export function saveSummary(result: MapApplyResult): string[] {
  const lines: string[] = [];
  const { counts } = result;
  if (counts.backups > 0) lines.push(`Backed up ${plural(counts.backups, "skill")} privately.`);
  if (counts.removals > 0) {
    const restore = result.trashRun ? ` Run \`skillet restore ${result.trashRun}\` to bring ${counts.removals === 1 ? "it" : "them"} back.` : "";
    lines.push(`Removed ${plural(counts.removals, "skill")}.${restore}`);
  }
  if (counts.fills > 0) lines.push(`Added ${plural(counts.fills, "pick")}.`);
  if (counts.merges > 0) lines.push(`${plural(counts.merges, "merge")} waiting to be written.`);
  for (const kept of result.kept) {
    switch (kept.kind) {
      case "plugin":
        lines.push(`${kept.name} came with the ${kept.owner} plugin. Turn the plugin off to remove it.`);
        break;
      case "organization":
        lines.push(`${kept.name} is synced from ${kept.owner}. Remove it there.`);
        break;
      case "app":
        lines.push(`${kept.name} was put in ${kept.owner} by another app. Remove it in that app.`);
        break;
      case "own":
        lines.push(`${kept.name} is your published skill ${kept.owner}. Sync puts it back, so change it on its page.`);
        break;
    }
  }
  for (const unremoved of result.unremoved) {
    lines.push(`Couldn't remove ${unremoved.name}: ${UNREMOVED[unremoved.reason] ?? "Skillet couldn't move it"}.`);
  }
  for (const skipped of result.notBackedUp) lines.push(notBackedUpLine(skipped));
  for (const refused of result.refused) {
    lines.push(fail(`Couldn't add ${refused.ref}: ${REFUSED[refused.reason] ?? "Skillet refused it"}.`));
  }
  return lines;
}

// ---------------------------------------------------------------------------
// The session report
// ---------------------------------------------------------------------------

/** Characters the registry refuses in a name: control, C1 and the bidirectional overrides. */
function safeText(value: string, max: number): string {
  let out = "";
  for (const ch of value) {
    const c = ch.codePointAt(0)!;
    const unsafe = c < 0x20 || (c >= 0x7f && c <= 0x9f) || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069);
    out += unsafe ? " " : ch;
  }
  out = out.replace(/\s+/g, " ").trim();
  return out.length > max ? out.slice(0, max).trim() : out;
}

function emptyResult(): MapApplyResult {
  return {
    result: "applied",
    counts: { backups: 0, removals: 0, fills: 0, merges: 0 },
    left: { backups: 0, removals: 0, fills: 0, merges: 0 },
    notBackedUp: [],
    kept: [],
    unremoved: [],
    refused: [],
    trashRun: null,
    changed: false,
  };
}

function hasAny(counts: KitMapSaveCounts): boolean {
  return Object.values(counts).some((n) => n > 0);
}

function reportOf(result: MapApplyResult): Record<string, unknown> {
  const notBackedUp = result.notBackedUp.slice(0, 1_000).map((skipped) => {
    const file = skipped.file !== undefined ? safeText(fileName(skipped.file) ?? "", 255) : "";
    return {
      name: safeText(skipped.name, 200) || "a skill",
      reason: skipped.reason,
      ...(file !== "" ? { file } : {}),
    };
  });
  return {
    result: result.result,
    ...(result.reason !== undefined ? { reason: result.reason } : {}),
    counts: result.counts,
    ...(hasAny(result.left) ? { left: result.left } : {}),
    ...(notBackedUp.length > 0 ? { not_backed_up: notBackedUp } : {}),
  };
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

export interface MapSaveFlowOptions {
  registryUrl: string;
  /** The entries the map shows; the drafts were made on them. */
  entries: readonly KitMapEntry[];
  /** Whether the map told the frame this computer is connected (it then confirms instead of opening a tab). */
  connected: boolean;
  /** A fresh scan of this computer, read at Save time. */
  rescan: () => Promise<MapScanResult>;
  /** The scan as the map shows it. */
  wire: (scan: MapScanResult) => KitMapEntry[];
  print?: (line: string) => void;
  /** This computer's name, as the save tab's confirm shows it. */
  label?: string;
  fetchImpl?: typeof fetch;
  pollMs?: number;
  paceMs?: number;
  lockWaitMs?: number;
  /** How long the map stays up after a Save ends the run. */
  finishGraceMs?: number;
  /** Add a pick. Defaults to the normal kit add with this computer's device token. */
  fill?: (ref: string, token: string) => Promise<MapFillResult>;
}

export interface MapSaveFlow {
  handler: MapSaveHandler;
  /** Whether a Save changed anything on this computer or the account. */
  changed(): boolean;
  /** Whether a Save changed things and then stopped partway: the command exits non-zero. */
  failed(): boolean;
  /** Resolves once no Save is running. */
  settled(): Promise<void>;
}

interface Connection {
  token: string;
  handle: string;
  /** The map session to report on, for a computer this Save connected. */
  session: string | null;
}

export function createMapSaveFlow(opts: MapSaveFlowOptions): MapSaveFlow {
  const print = opts.print ?? ((line: string) => console.log(line));
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const pollMs = opts.pollMs ?? POLL_MS;
  const label = (opts.label ?? defaultMachineLabel()).slice(0, 80);
  let changed = false;
  let failed = false;
  let running: Promise<void> = Promise.resolve();

  /** End the run, after the page has had a moment to read the last status. */
  const finish = async (link: MapFrameLink): Promise<void> => {
    await sleep(opts.finishGraceMs ?? FINISH_GRACE_MS, link.signal);
    link.finish();
  };

  const wireFor = (link: MapFrameLink): Wire => ({
    registryUrl: opts.registryUrl.replace(/\/+$/, ""),
    fetchImpl,
    paceMs: opts.paceMs ?? PACE_MS,
    signal: link.signal,
  });

  const stopBeforeAnything = (link: MapFrameLink, reason: string, line: string): null => {
    link.status("failed", { reason });
    print(fail(line));
    return null;
  };

  /** A connected computer: name its account in the frame and wait for the confirm. */
  const confirmAccount = async (link: MapFrameLink): Promise<Connection | null> => {
    const device = await readDeviceFile();
    if (!device?.device_token || device.label === "anonymous") {
      return stopBeforeAnything(link, "not-connected", "This machine isn't connected anymore. Run `skillet map` again to save.");
    }
    let answer: Answer;
    try {
      answer = await new Registry({ ...wireFor(link), paceMs: 0 }, device.device_token).send("GET", "/whoami");
    } catch {
      if (link.signal.aborted) return null;
      return stopBeforeAnything(link, "registry-unreachable", "Couldn't reach Skillet. Press Save to try again.");
    }
    if (answer.status === 401 || answer.status === 403) {
      return stopBeforeAnything(link, "not-connected", "This machine isn't connected anymore. Run `skillet map` again to save.");
    }
    const handle = isRecord(answer.body) && typeof answer.body.handle === "string" ? answer.body.handle : "";
    if (answer.status !== 200) {
      return stopBeforeAnything(link, "registry-unreachable", "Couldn't reach Skillet. Press Save to try again.");
    }
    if (!HANDLE_RE.test(handle)) {
      return stopBeforeAnything(link, "username-required", "Pick a username on skillet.md, then press Save again.");
    }
    link.status("confirm", { handle });
    if (!(await link.confirmed())) return null;
    return { token: device.device_token, handle, session: null };
  };

  /** A computer that isn't connected: the map-session handshake (KTD6). */
  const connectThisMachine = async (link: MapFrameLink): Promise<Connection | null> => {
    const wire = { ...wireFor(link), paceMs: 0 };
    const anonymous = new Registry(wire, null);
    const proof = randomBytes(32).toString("base64url");
    const proofHash = createHash("sha256").update(proof, "utf8").digest("hex");
    let created: Answer;
    try {
      created = await anonymous.send("POST", "/map-sessions", { label, proof_hash: proofHash }, { followRateLimit: false });
    } catch {
      if (link.signal.aborted) return null;
      return stopBeforeAnything(link, "registry-unreachable", "Couldn't reach Skillet. Press Save to try again.");
    }
    if (created.status === 429) {
      return stopBeforeAnything(link, "rate-limited", "Too many saves from this network. Wait a minute, then press Save again.");
    }
    const session = isRecord(created.body) ? created.body : {};
    const id = typeof session.id === "string" ? session.id : "";
    const secret = typeof session.poll_secret === "string" ? session.poll_secret : "";
    const expiresAt = typeof session.expires_at === "number" ? session.expires_at * 1000 : 0;
    if (created.status !== 201 || !SESSION_ID_RE.test(id) || !SECRET_RE.test(secret) || !Number.isSafeInteger(expiresAt)) {
      return stopBeforeAnything(link, "registry-error", "Skillet couldn't start this save. Press Save to try again.");
    }

    link.session({ session: id, expiresAt, proof });
    link.status("waiting");
    print("Finish saving in the skillet.md tab.");
    let signingIn = false;
    let code = "";
    while (code === "") {
      if (link.signal.aborted) return null;
      if (Date.now() > expiresAt + EXPIRY_GRACE_MS) break;
      let answer: Answer;
      try {
        answer = await anonymous.send("POST", `/map-sessions/${id}/poll`, { secret });
      } catch {
        if (link.signal.aborted) return null;
        await sleep(pollMs, link.signal);
        continue;
      }
      const body = isRecord(answer.body) ? answer.body : {};
      if (answer.status === 202) {
        if (body.bound === true && !signingIn) {
          signingIn = true;
          link.status("signing-in");
        }
        await sleep(pollMs, link.signal);
        continue;
      }
      if (answer.status === 200 && typeof body.code === "string") {
        code = body.code;
        break;
      }
      if (answer.status === 410) break;
      return stopBeforeAnything(link, "session-refused", "Skillet didn't accept this save. Press Save to try again.");
    }
    if (code === "") {
      if (link.signal.aborted) return null;
      link.status("expired");
      print("Save timed out. Press Save in the map to try again.");
      return null;
    }

    let connected;
    try {
      connected = await authConnectFreshPair({ code, registryUrl: wire.registryUrl, label, clientKind: "cli", fetchImpl });
    } catch (err) {
      const why = (err as Error).message.replace(/^Could not connect with pair code:\s*/i, "");
      return stopBeforeAnything(link, "connect-failed", `Couldn't connect this machine: ${why}. Press Save to try again.`);
    }
    changed = true;
    const handle = connected.handle ?? "";
    print(ok(handle ? `Connected this machine to @${handle}.` : "Connected this machine to your account."));
    return { token: connected.device_token, handle, session: id };
  };

  const report = async (link: MapFrameLink, connection: Connection, result: MapApplyResult): Promise<void> => {
    if (connection.session === null) return;
    try {
      // The run may be stopping; the report goes anyway, so the save tab shows how it went.
      const wire = { ...wireFor(link), paceMs: 0, signal: undefined };
      await new Registry(wire, connection.token).send("POST", `/map-sessions/${connection.session}/result`, reportOf(result));
    } catch {
      // The save tab keeps showing the session's last state.
    }
  };

  const save = async (drafts: KitMapDraft[], link: MapFrameLink): Promise<void> => {
    const connection = opts.connected ? await confirmAccount(link) : await connectThisMachine(link);
    if (connection === null) return;

    link.status("saving");
    let lock;
    try {
      lock = await acquireMapSaveLock({
        waitMs: opts.lockWaitMs,
        signal: link.signal,
        onWait: () => print("Another Save is running on this machine. Waiting for it to finish."),
      });
    } catch {
      if (link.signal.aborted) return;
      print(fail("Another Save is still running on this machine."));
      await stoppedPartway(link, connection, { ...emptyResult(), result: "failed", reason: "locked" });
      return;
    }

    let result: MapApplyResult;
    try {
      const wire = wireFor(link);
      const client = applyClient({
        wire,
        token: connection.token,
        fill: (ref) => (opts.fill ?? ((r, t) => kitAddFill(r, wire.registryUrl, t)))(ref, connection.token),
      });
      result = await runMapApply({
        mode: "save",
        scan: await opts.rescan(),
        wire: opts.wire,
        client,
        drafts,
        draftedOn: opts.entries,
        rescan: opts.rescan,
        onStep: (step) => link.status(step),
        signal: link.signal,
      });
    } catch {
      result = { ...emptyResult(), result: "failed", reason: "error" };
    } finally {
      await lock.release();
    }
    if (result.changed) changed = true;
    for (const line of saveSummary(result)) print(line);
    if (result.result !== "applied") {
      const left = leftText(result.left);
      print(fail(`Save stopped partway.${left ? ` Left to do: ${left}.` : ""}`));
      await stoppedPartway(link, connection, result);
      return;
    }
    await report(link, connection, result);
    print(ok(connection.handle ? `Saved your map to @${connection.handle}.` : "Saved your map."));
    link.status("done");
    await finish(link);
  };

  /**
   * A Save that stopped after it began. Once anything changed (this machine got
   * connected, a backup went up, a folder moved), the run ends and the command
   * fails, so a second Save never starts from a map that no longer matches; the
   * next `skillet map`, or the app, finishes what the account still holds.
   * Otherwise the map stays open for another try.
   */
  const stoppedPartway = async (link: MapFrameLink, connection: Connection, result: MapApplyResult): Promise<void> => {
    await report(link, connection, result);
    link.status("failed", { reason: result.reason ?? "error" });
    if (changed) {
      failed = true;
      print("Run `skillet map` again to finish, or open the Skillet app.");
      await finish(link);
    } else {
      print("Nothing changed. Press Save to try again.");
    }
  };

  return {
    handler: (drafts, link) => {
      const run = save(drafts, link);
      running = run.catch(() => undefined);
      return run;
    },
    changed: () => changed,
    failed: () => failed,
    settled: () => running,
  };
}

// ---------------------------------------------------------------------------
// `skillet map --apply`
// ---------------------------------------------------------------------------

export interface MapApplyOnlyOptions {
  registryUrl: string;
  rescan: () => Promise<MapScanResult>;
  wire: (scan: MapScanResult) => KitMapEntry[];
  print?: (line: string) => void;
  fetchImpl?: typeof fetch;
  paceMs?: number;
  lockWaitMs?: number;
}

export type MapApplyOnlyResult = MapApplyResult | { result: "not-connected" } | { result: "locked" };

/**
 * Make this computer's waiting changes, with no frame and no new drafts: what
 * the app's sync runs, and what finishes a Save that stopped partway. Only a
 * connected computer has waiting changes.
 */
export async function runMapApplyOnly(opts: MapApplyOnlyOptions): Promise<MapApplyOnlyResult> {
  const device = await readDeviceFile();
  if (!device?.device_token || device.label === "anonymous") return { result: "not-connected" };
  let lock;
  try {
    lock = await acquireMapSaveLock({
      waitMs: opts.lockWaitMs ?? 60_000,
      onWait: () => opts.print?.("Another Save is running on this machine. Waiting for it to finish."),
    });
  } catch {
    return { result: "locked" };
  }
  try {
    const wire: Wire = {
      registryUrl: opts.registryUrl.replace(/\/+$/, ""),
      fetchImpl: opts.fetchImpl ?? globalThis.fetch,
      paceMs: opts.paceMs ?? PACE_MS,
    };
    const token = device.device_token;
    const client = applyClient({ wire, token, fill: (ref) => kitAddFill(ref, wire.registryUrl, token) });
    let scan: MapScanResult;
    try {
      scan = await opts.rescan();
    } catch {
      return { ...emptyResult(), result: "failed", reason: "scan-failed" };
    }
    return await runMapApply({ mode: "apply", scan, wire: opts.wire, client });
  } finally {
    await lock.release();
  }
}

export { leftText as mapLeftText };
