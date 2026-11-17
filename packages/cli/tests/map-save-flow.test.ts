/**
 * Save in `skillet map` (plan U11, KTD6 KTD7 KTD8 KTD10 KTD16; R18 F1).
 *
 * HOME, SKILLET_DIR and the XDG folders point into a throwaway fixture BEFORE
 * the CLI and core load (their adapters and allowlists are built from the home
 * at load), the registry is a local fake that records every request, and the
 * map runs in process with its loopback server on 127.0.0.1. Nothing here can
 * read a real home or reach a real registry.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import type { KitMapDraft, KitMapScan } from "@skillet/protocol/kit-map";
import type { MergeWriter } from "@skillet/core";

const ROOT = mkdtempSync(join(tmpdir(), "skillet-map-save-"));
const HOME = join(ROOT, "home");
const SKILLET = join(ROOT, "skillet");
for (const key of [
  "CLAUDE_CONFIG_DIR",
  "HERMES_HOME",
  "CODEX_HOME",
  "SKILLET_TOKEN",
  "SKILLET_TOKEN_FORCE",
  "SKILLET_SKILL_ROOTS",
  "SKILLET_TCC_POLICY",
  "SKILLET_TCC_CONTEXT",
  "SKILLET_REGISTRY_URL",
  "SKILLET_REGISTRY",
  "SKILLET_WEB_URL",
  "SKILLET_DAEMON",
]) {
  delete process.env[key];
}
process.env["HOME"] = HOME;
process.env["USERPROFILE"] = HOME;
process.env["SKILLET_DIR"] = SKILLET;
process.env["XDG_CONFIG_HOME"] = join(HOME, ".config");
process.env["XDG_DATA_HOME"] = join(HOME, ".local", "share");

const { readMap, startMap, scanThisMachine, wireEntries } = await import("../src/commands/map-cmd.js");
const { createMapSaveFlow, runMapApplyOnly, saveSummary } = await import("../src/map/save-flow.js");
const { acquireMapSaveLock, findMergeWriter, readMapMergeRecord } = await import("@skillet/core");
const { MAP_TOKEN_HEADER } = await import("../src/map/shell-page.js");

after(async () => {
  await rm(ROOT, { recursive: true, force: true });
});

const CLAUDE = join(HOME, ".claude", "skills");
const AGENTS = join(HOME, ".agents", "skills");
const WEB = "https://web.test";
const CODE = "MAPS2345";

// ---------------------------------------------------------------------------
// The fixture home
// ---------------------------------------------------------------------------

function skillMd(name: string, body = `Body for ${name}.`): string {
  return `---\nname: ${name}\ndescription: ${name} helper\n---\n\n# ${name}\n\n${body}\n`;
}

async function writeSkill(dir: string, name: string, body?: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), skillMd(name, body));
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2));
}

/** An empty home with Claude Code and Codex, and an empty Skillet folder. */
async function resetHome(): Promise<void> {
  await rm(HOME, { recursive: true, force: true });
  await rm(SKILLET, { recursive: true, force: true });
  await mkdir(CLAUDE, { recursive: true });
  await mkdir(AGENTS, { recursive: true });
  await mkdir(SKILLET, { recursive: true });
}

async function connectAs(token: string): Promise<void> {
  await writeJson(join(SKILLET, "device.json"), {
    device_token: token,
    device_id: token === "skillet_d_valid" ? "dev-valid" : "dev-other",
    label: "test-machine",
    machine_id: "m-test",
    saved_at: "2026-11-01T00:00:00.000Z",
  });
}

// ---------------------------------------------------------------------------
// The registry, faked
// ---------------------------------------------------------------------------

interface Hit {
  method: string;
  path: string;
  auth: string | null;
  body: unknown;
  at: number;
}

interface Session {
  id: string;
  secret: string;
  proofHash: string;
  label: string;
  state: "pending" | "approved" | "expired";
  bound: boolean;
  delivered: boolean;
  claimed: boolean;
  device: string | null;
  result?: unknown;
}

interface Device {
  id: string;
  user: string;
  label: string;
}

interface Change {
  id: string;
  user: string;
  device: string | null;
  kind: string;
  version: number;
  body: Record<string, unknown>;
  outcome?: string;
}

interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

class FakeRegistry {
  url = "";
  hits: Hit[] = [];
  sessions = new Map<string, Session>();
  devices = new Map<string, Device>([
    ["skillet_d_valid", { id: "dev-valid", user: "user-b", label: "test-machine" }],
    // Another account's computer row: a stale device.json on this computer may hold its token.
    ["skillet_d_other", { id: "dev-other", user: "user-a", label: "test-machine-old" }],
  ]);
  revoked = new Set<string>(["skillet_d_other"]);
  handles: Record<string, string> = { "user-a": "other-user", "user-b": "test-user" };
  changes = new Map<string, Change>();
  backups = new Map<string, Map<string, unknown>>();
  docs = new Map<string, { version: number; entries: unknown[]; assignments: Record<string, unknown> }>();
  /** Merge records by change id, as PUT /map-merges/:id leaves them. */
  merges = new Map<string, Record<string, unknown>>();
  /** Public skill versions by content hash, as the source-maker lookup finds them. */
  published = new Map<string, { ref: string; name: string }>();
  /** Per PUT /backups attempt: an override reply, or null to store it. */
  backupReply: (hash: string, attempt: number) => Reply | null = () => null;
  failAck = false;
  failMapPut = false;
  private puts = 0;
  private nextChange = 0;
  private server: Server | null = null;

  async start(): Promise<this> {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    const { port } = this.server.address() as { port: number };
    this.url = `http://127.0.0.1:${port}`;
    return this;
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      this.server?.closeAllConnections();
      this.server?.close(() => resolve());
    });
  }

  /** The signed-in person approves the session on skillet.md. */
  approve(id: string): void {
    const session = this.sessions.get(id);
    assert.ok(session, `no session ${id}`);
    session.bound = true;
    session.state = "approved";
  }

  expire(id: string): void {
    this.sessions.get(id)!.state = "expired";
  }

  /** The requests to `path`, or under it when it ends in a slash. */
  calls(method: string, path: string): Hit[] {
    return this.hits.filter(
      (hit) => hit.method === method && (path.endsWith("/") ? hit.path.startsWith(path) : hit.path === path),
    );
  }

  private principal(auth: string | null): Device | null {
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token || this.revoked.has(token)) return null;
    return this.devices.get(token) ?? null;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString("utf8");
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    const path = (req.url ?? "/").split("?")[0]!;
    const auth = typeof req.headers.authorization === "string" ? req.headers.authorization : null;
    this.hits.push({ method: req.method ?? "GET", path, auth, body, at: Date.now() });
    const reply = this.route(req.method ?? "GET", path, auth, (body ?? {}) as Record<string, unknown>);
    res.writeHead(reply.status, { "content-type": "application/json", ...(reply.headers ?? {}) });
    res.end(reply.body === undefined ? "" : JSON.stringify(reply.body));
  }

  private route(method: string, path: string, auth: string | null, body: Record<string, unknown>): Reply {
    const api = "/api/v1";
    if (!path.startsWith(api)) return { status: 404, body: { error: "not_found" } };
    const p = path.slice(api.length);
    let m: RegExpExecArray | null;

    if (method === "POST" && p === "/map-sessions") {
      const id = createHash("sha256").update(`session-${this.sessions.size}`).digest("hex").slice(0, 32);
      const secret = `poll-secret-${"x".repeat(40)}-${this.sessions.size}`;
      this.sessions.set(id, {
        id,
        secret,
        proofHash: String(body.proof_hash),
        label: String(body.label),
        state: "pending",
        bound: false,
        delivered: false,
        claimed: false,
        device: null,
      });
      return { status: 201, body: { id, poll_secret: secret, expires_at: Math.floor(Date.now() / 1000) + 600, ttl_sec: 600 } };
    }
    if (method === "POST" && (m = /^\/map-sessions\/([0-9a-f]{32})\/poll$/.exec(p))) {
      const session = this.sessions.get(m[1]!);
      if (!session) return { status: 404, body: { error: "map_session_not_found" } };
      if (body.secret !== session.secret) return { status: 403, body: { error: "poll_secret_invalid" } };
      if (session.state === "expired") return { status: 410, body: { error: "map_session_expired" } };
      if (session.state === "pending") return { status: 202, body: { state: "pending", bound: session.bound } };
      if (session.delivered) return { status: 409, body: { error: "code_already_delivered" } };
      session.delivered = true;
      return { status: 200, body: { code: CODE, expires_at: Math.floor(Date.now() / 1000) + 300 } };
    }
    if (method === "POST" && p === "/connect/claim") {
      const session = [...this.sessions.values()].find((s) => s.delivered && !s.claimed);
      if (!session || body.code !== CODE) return { status: 404, body: { error: "code_not_found" } };
      // The registry refuses a presented device token with a map-session code (KTD6).
      if (body.device_token !== undefined) return { status: 403, body: { error: "device_token_not_allowed" } };
      session.claimed = true;
      session.device = "dev-new";
      this.devices.set("skillet_d_new", { id: "dev-new", user: "user-b", label: String(body.label) });
      return {
        status: 200,
        body: {
          session_token: "skillet_s_new",
          device_id: "dev-new",
          device_token: "skillet_d_new",
          handle: "test-user",
          user_id: "user-b",
        },
      };
    }
    if (method === "POST" && (m = /^\/map-sessions\/([0-9a-f]{32})\/result$/.exec(p))) {
      const device = this.principal(auth);
      const session = this.sessions.get(m[1]!);
      if (!device || !session || session.device !== device.id) return { status: 403, body: { error: "not_this_computer" } };
      session.result = body;
      return { status: 200, body: { ok: true } };
    }

    const device = this.principal(auth);
    if (!device) return { status: 401, body: { error: "auth_required" } };
    const user = device.user;

    if (method === "GET" && p === "/whoami") {
      return { status: 200, body: { token_class: "device", device_id: device.id, user_id: user, handle: this.handles[user] } };
    }
    if (method === "GET" && p === "/kit-map/changes") {
      const open = [...this.changes.values()].filter((c) => c.user === user && c.device === device.id && !c.outcome);
      return { status: 200, body: { changes: open.map((c) => this.wire(c)) } };
    }
    if (method === "POST" && p === "/kit-map/changes") {
      const input = Array.isArray(body.changes) ? (body.changes as Array<Record<string, unknown>>) : [];
      const made = input.map((item) => {
        const { kind, ...rest } = item;
        const change: Change = { id: `change-${++this.nextChange}`, user, device: device.id, kind: String(kind), version: 1, body: rest };
        this.changes.set(change.id, change);
        return this.wire(change);
      });
      return { status: 201, body: { changes: made } };
    }
    if (method === "POST" && p === "/kit-map/changes/claim") return { status: 200, body: { claimed: [] } };
    if (method === "POST" && (m = /^\/kit-map\/changes\/([^/]+)\/ack$/.exec(p))) {
      if (this.failAck) return { status: 503, body: { error: "unavailable" } };
      const change = this.changes.get(m[1]!);
      if (!change || change.device !== device.id) return { status: 404, body: { error: "change_not_found" } };
      if (change.outcome) return { status: 409, body: { error: "already_acknowledged" } };
      change.outcome = typeof body.outcome === "string" ? body.outcome : "applied";
      return { status: 200, body: { ok: true } };
    }
    if (method === "GET" && p === "/backups") {
      const mine = this.backups.get(user) ?? new Map();
      return { status: 200, body: { backups: [...mine.keys()].map((hash) => ({ hash })), usage: { count: mine.size } } };
    }
    if (method === "PUT" && (m = /^\/backups\/([^/]+)$/.exec(p))) {
      const hash = decodeURIComponent(m[1]!);
      const forced = this.backupReply(hash, ++this.puts);
      if (forced) return forced;
      const mine = this.backups.get(user) ?? new Map<string, unknown>();
      const created = !mine.has(hash);
      mine.set(hash, body);
      this.backups.set(user, mine);
      return { status: created ? 201 : 200, body: { hash, size: 1, created } };
    }
    if (method === "GET" && p === "/kit-map") {
      const doc = this.docs.get(user);
      return doc ? { status: 200, body: doc } : { status: 404, body: { error: "kit_map_not_found" } };
    }
    if (method === "PUT" && p === "/kit-map") {
      if (this.failMapPut) return { status: 503, body: { error: "unavailable" } };
      const current = this.docs.get(user)?.version ?? 0;
      if (body.version !== current) return { status: 409, body: { error: "version_conflict", version: current } };
      this.docs.set(user, {
        version: current + 1,
        entries: body.entries as unknown[],
        assignments: body.assignments as Record<string, unknown>,
      });
      return { status: 200, body: { version: current + 1 } };
    }
    if (method === "GET" && p === "/map-merges") {
      const mine = [...this.changes.values()].filter((c) => c.user === user && c.device === device.id && c.kind === "merge");
      const merges = mine.map(
        (c) => this.merges.get(c.id) ?? { id: c.id, device: c.device, job: c.body.job, keys: c.body.keys, status: "waiting", updatedAt: 1 },
      );
      return { status: 200, body: { merges } };
    }
    if (method === "PUT" && (m = /^\/map-merges\/([^/]+)$/.exec(p))) {
      const change = this.changes.get(decodeURIComponent(m[1]!));
      if (!change || change.device !== device.id || change.kind !== "merge") return { status: 404, body: { error: "merge_not_found" } };
      const record: Record<string, unknown> = {
        id: change.id,
        device: change.device,
        job: change.body.job,
        keys: change.body.keys,
        status: body.status,
        updatedAt: 2,
        ...(typeof body.reason === "string" ? { reason: body.reason } : {}),
        ...(typeof body.merged === "string" ? { merged: body.merged } : {}),
      };
      this.merges.set(change.id, { ...record, ...(body.rounds ? { brief: body.brief, rounds: body.rounds } : {}) });
      return { status: 200, body: { merge: record } };
    }
    if (method === "POST" && p === "/backups/sources") {
      const keys = Array.isArray(body.keys) ? (body.keys as string[]) : [];
      const sources = keys.map((key) => {
        const hit = this.published.get(key);
        if (!hit) return { key, private: true };
        const [owner, slug] = hit.ref.slice(1).split("/");
        return { key, ref: hit.ref, maker: owner, name: hit.name, page: `${WEB}/${owner}/${slug}` };
      });
      return { status: 200, body: { sources } };
    }
    if (method === "GET" && (m = /^\/skills\/([^/]+)\/([^/]+)\/manifest$/.exec(p))) {
      return { status: 404, body: { error: "skill_not_found", message: "No such public skill." } };
    }
    return { status: 404, body: { error: "not_found" } };
  }

  private wire(change: Change): Record<string, unknown> {
    return { id: change.id, kind: change.kind, device: change.device, version: change.version, ...change.body };
  }
}

// ---------------------------------------------------------------------------
// Driving the map
// ---------------------------------------------------------------------------

interface Answer {
  status: number;
  body: string;
}

function send(url: string, opts: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method: opts.method ?? "GET", headers: opts.headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

interface Frame {
  origin: string;
  token: string;
  messages: Array<Record<string, unknown>>;
  cursor: number;
}

function post(frame: Frame, message: unknown): Promise<Answer> {
  return send(`${frame.origin}/${frame.token}/message`, {
    method: "POST",
    headers: { "content-type": "application/json", [MAP_TOKEN_HEADER]: frame.token, origin: frame.origin },
    body: JSON.stringify(message),
  });
}

/** Read the loopback page's messages until one matches. */
async function waitFor(
  frame: Frame,
  match: (message: Record<string, unknown>) => boolean,
  timeoutMs = 20_000,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const seen = frame.messages.find(match);
    if (seen) return seen;
    if (Date.now() > deadline) throw new Error(`no matching message; saw ${JSON.stringify(frame.messages)}`);
    const reply = await send(`${frame.origin}/${frame.token}/messages?after=${frame.cursor}`);
    const { messages, next } = JSON.parse(reply.body) as { messages: Array<Record<string, unknown>>; next: number };
    frame.messages.push(...messages);
    frame.cursor = next;
  }
}

const isStatus = (state: string) => (m: Record<string, unknown>) => m.type === "status" && m.state === state;

interface Opened {
  run: Awaited<ReturnType<typeof startMap>>;
  flow: ReturnType<typeof createMapSaveFlow>;
  frame: Frame;
  scan: KitMapScan;
  printed: string[];
}

async function openMap(
  registry: FakeRegistry,
  over: Partial<Parameters<typeof createMapSaveFlow>[0]> = {},
): Promise<Opened> {
  const printed: string[] = [];
  const print = (line: string) => printed.push(line);
  const reading = await readMap({ registryUrl: registry.url });
  const flow = createMapSaveFlow({
    registryUrl: registry.url,
    entries: reading.payload.entries,
    connected: reading.payload.connected === true,
    rescan: scanThisMachine,
    wire: wireEntries,
    print,
    label: "test-machine",
    pollMs: 30,
    paceMs: 5,
    ...over,
  });
  const run = await startMap({
    open: false,
    reading,
    webUrl: WEB,
    handleSignals: false,
    print,
    onSave: flow.handler,
    saveChanged: flow.changed,
  });
  return { run, flow, frame: { origin: run.origin, token: run.token, messages: [], cursor: 0 }, scan: reading.payload, printed };
}

const keyOf = (scan: KitMapScan, name: string): string => {
  const entry = scan.entries.find((e) => e.name === name);
  assert.ok(entry, `no ${name} on the map`);
  return entry.key;
};

async function mapTrashRuns(): Promise<string[]> {
  try {
    return await readdir(join(SKILLET, "map-trash"));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Save on a computer that isn't connected (KTD6)
// ---------------------------------------------------------------------------

test("an approved session writes device.json here, and the claim never carries the stale device token", { timeout: 60_000 }, async () => {
  await resetHome();
  await writeSkill(join(CLAUDE, "old-notes"), "old-notes");
  await writeSkill(join(CLAUDE, "plain-prose"), "plain-prose");
  // Another account's token, revoked there: the account says this computer isn't connected.
  await connectAs("skillet_d_other");
  const registry = await new FakeRegistry().start();
  const opened = await openMap(registry);
  try {
    assert.equal(opened.scan.connected, undefined, "a token the account refuses is not a connection");
    const drafts: KitMapDraft[] = [{ kind: "remove", key: keyOf(opened.scan, "old-notes") }];
    assert.equal((await post(opened.frame, { type: "save", v: 1, drafts })).status, 202);

    const session = await waitFor(opened.frame, (m) => m.type === "session");
    const created = registry.calls("POST", "/api/v1/map-sessions")[0]!;
    assert.deepEqual(Object.keys(created.body as object).sort(), ["label", "proof_hash"]);
    assert.equal((created.body as { label: string }).label, "test-machine");
    const proof = String(session.proof);
    assert.match(proof, /^[A-Za-z0-9_-]{32,256}$/);
    assert.equal(
      (created.body as { proof_hash: string }).proof_hash,
      createHash("sha256").update(proof, "utf8").digest("hex"),
      "the session holds the proof's hash, never the proof",
    );
    assert.ok(!JSON.stringify(registry.hits).includes(proof), "the proof never reaches the registry");
    assert.equal(created.auth, null, "the session is opened with no credential");
    assert.ok(Number(session.expiresAt) > Date.now(), "expiresAt is in epoch milliseconds");
    await waitFor(opened.frame, isStatus("waiting"));

    registry.approve(String(session.session));
    await waitFor(opened.frame, isStatus("done"));
    assert.equal(await opened.run.done, "finished");

    const claim = registry.calls("POST", "/api/v1/connect/claim");
    assert.equal(claim.length, 1);
    assert.equal(claim[0]!.auth, null);
    assert.equal("device_token" in (claim[0]!.body as object), false, "the claim carries no device token");
    assert.equal((claim[0]!.body as { code: string }).code, CODE);
    const device = JSON.parse(readFileSync(join(SKILLET, "device.json"), "utf8")) as Record<string, unknown>;
    assert.equal(device.device_token, "skillet_d_new");
    assert.equal(device.device_id, "dev-new");
    assert.deepEqual(registry.devices.get("skillet_d_other"), { id: "dev-other", user: "user-a", label: "test-machine-old" }, "the other account's row is untouched");

    // Everything after the claim runs as the new device.
    const afterClaim = registry.hits.slice(registry.hits.indexOf(claim[0]!) + 1);
    assert.ok(afterClaim.length > 0);
    for (const hit of afterClaim) assert.equal(hit.auth, "Bearer skillet_d_new", `${hit.method} ${hit.path}`);
    assert.equal(registry.calls("PUT", "/api/v1/backups/").length, 2, "both local skills back up, kept or removed");
    assert.equal(existsSync(join(CLAUDE, "old-notes")), false);
    assert.equal((await mapTrashRuns()).length, 1);
    const result = [...registry.sessions.values()][0]!.result as Record<string, unknown>;
    assert.equal(result.result, "applied");
    assert.deepEqual(result.counts, { backups: 2, removals: 1, fills: 0, merges: 0 });
    assert.equal(opened.flow.failed(), false);
    assert.ok(opened.printed.some((line) => /Connected this machine to @test-user\./.test(line)), opened.printed.join("\n"));
  } finally {
    await opened.run.stop("interrupted");
    await registry.close();
  }
});

test("an expired session returns the map to drafting with the server still up, and a second Save starts a new session", { timeout: 60_000 }, async () => {
  await resetHome();
  await writeSkill(join(CLAUDE, "notes"), "notes");
  const registry = await new FakeRegistry().start();
  const opened = await openMap(registry);
  try {
    assert.equal((await post(opened.frame, { type: "save", v: 1, drafts: [] })).status, 202);
    const first = await waitFor(opened.frame, (m) => m.type === "session");
    registry.expire(String(first.session));
    await waitFor(opened.frame, isStatus("expired"));
    assert.ok(opened.printed.some((line) => /Save timed out\. Press Save in the map to try again\./.test(line)), opened.printed.join("\n"));
    assert.equal((await send(opened.run.url)).status, 200, "the map is still served");
    assert.equal(opened.flow.changed(), false);
    assert.ok(existsSync(join(CLAUDE, "notes", "SKILL.md")));
    assert.equal(existsSync(join(SKILLET, "device.json")), false);

    // Save again: a new session.
    let reply = await post(opened.frame, { type: "save", v: 1, drafts: [] });
    for (let i = 0; reply.status === 409 && i < 50; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      reply = await post(opened.frame, { type: "save", v: 1, drafts: [] });
    }
    assert.equal(reply.status, 202);
    const second = await waitFor(opened.frame, (m) => m.type === "session" && m.session !== first.session);
    assert.notEqual(second.session, first.session);
    assert.equal(registry.calls("POST", "/api/v1/map-sessions").length, 2);
  } finally {
    await opened.run.stop("interrupted");
    await registry.close();
  }
  assert.ok(opened.printed.includes("Map closed. Nothing changed."), opened.printed.join("\n"));
});

// ---------------------------------------------------------------------------
// Save on a computer that's already connected
// ---------------------------------------------------------------------------

test("a connected computer saves to its own account after the confirm, and never opens a session or claims", { timeout: 60_000 }, async () => {
  await resetHome();
  await writeSkill(join(CLAUDE, "code-review"), "code-review", "Review for bugs.");
  await writeSkill(join(AGENTS, "code-review"), "code-review", "Review for style.");
  await writeSkill(join(CLAUDE, "writing-style"), "writing-style");
  await writeJson(join(SKILLET, "identity.json"), { handle: "test-user" });
  await connectAs("skillet_d_valid");
  const registry = await new FakeRegistry().start();
  // The account already holds a change for this computer: a remove picked on skillet.md.
  registry.changes.set("waiting-1", {
    id: "waiting-1",
    user: "user-b",
    device: "dev-valid",
    kind: "remove",
    version: 1,
    body: { key: `sha256:${"c".repeat(64)}` },
  });
  const opened = await openMap(registry);
  try {
    assert.equal(opened.scan.connected, true);
    assert.deepEqual(opened.scan.pending?.map((c) => c.id), ["waiting-1"], "the scan lists what the account holds for this computer");
    assert.equal((await post(opened.frame, { type: "save", v: 1, drafts: [] })).status, 202);
    const confirm = await waitFor(opened.frame, isStatus("confirm"));
    assert.equal(confirm.handle, "test-user");
    assert.equal(registry.calls("PUT", "/api/v1/backups/").length, 0, "nothing happens before the confirm");

    assert.equal((await post(opened.frame, { type: "confirm", v: 1 })).status, 200);
    await waitFor(opened.frame, isStatus("done"));
    assert.equal(await opened.run.done, "finished");

    assert.equal(registry.calls("POST", "/api/v1/map-sessions").length, 0);
    assert.equal(registry.calls("POST", "/api/v1/connect/claim").length, 0);
    for (const hit of registry.hits) assert.equal(hit.auth, "Bearer skillet_d_valid", `${hit.method} ${hit.path}`);
    const puts = registry.calls("PUT", "/api/v1/backups/").map((hit) => decodeURIComponent(hit.path.slice("/api/v1/backups/".length)));
    const reviews = opened.scan.entries.filter((e) => e.name === "code-review").map((e) => e.key);
    assert.equal(reviews.length, 2);
    assert.deepEqual([...puts].sort(), [...reviews, keyOf(opened.scan, "writing-style")].sort(), "both code-review skills back up by hash");
    assert.ok(
      registry.hits.every((hit) => !/^\/api\/v1\/(skills|me\/library|publish)/.test(hit.path) || hit.method === "GET"),
      "no publish: a backup never becomes a version of a published skill",
    );
    const body = registry.calls("PUT", "/api/v1/backups/")[0]!.body as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), ["description", "files", "name", "origin", "tools"]);
    assert.equal(body.origin, "scan");
    assert.equal(registry.changes.get("waiting-1")?.outcome, "gone", "a waiting change for a skill that isn't here is acknowledged");
    assert.equal(registry.docs.get("user-b")?.version, 1, "the map is saved");
    assert.ok(!JSON.stringify(registry.docs.get("user-b")).includes(HOME), "the saved map holds no path");
  } finally {
    await opened.run.stop("interrupted");
    await registry.close();
  }
});

test("backups follow Retry-After on a 429 and are spaced", { timeout: 60_000 }, async () => {
  await resetHome();
  for (const name of ["alpha", "bravo", "charlie"]) await writeSkill(join(CLAUDE, name), name);
  await connectAs("skillet_d_valid");
  const registry = await new FakeRegistry().start();
  let limitedAt = 0;
  registry.backupReply = (_hash, attempt) => {
    if (attempt !== 2) return null;
    limitedAt = Date.now();
    return { status: 429, body: { error: "rate_limited", retry_after_seconds: 1 }, headers: { "retry-after": "1" } };
  };
  const opened = await openMap(registry, { paceMs: 120 });
  try {
    await post(opened.frame, { type: "save", v: 1, drafts: [] });
    await waitFor(opened.frame, isStatus("confirm"));
    await post(opened.frame, { type: "confirm", v: 1 });
    await waitFor(opened.frame, isStatus("done"));

    const puts = registry.calls("PUT", "/api/v1/backups/");
    assert.equal(puts.length, 4, "three uploads and one retry");
    assert.equal(registry.backups.get("user-b")?.size, 3);
    assert.ok(puts[2]!.at - limitedAt >= 950, `the retry waited for Retry-After (${puts[2]!.at - limitedAt} ms)`);
    for (let i = 1; i < puts.length; i++) {
      assert.ok(puts[i]!.at - puts[i - 1]!.at >= 100, `uploads are spaced (${puts[i]!.at - puts[i - 1]!.at} ms)`);
    }
  } finally {
    await opened.run.stop("interrupted");
    await registry.close();
  }
});

test("a pick the registry won't serve is reported, and the rest of Save goes on", { timeout: 60_000 }, async () => {
  await resetHome();
  await writeSkill(join(CLAUDE, "notes"), "notes");
  await connectAs("skillet_d_valid");
  const registry = await new FakeRegistry().start();
  const opened = await openMap(registry);
  try {
    const drafts: KitMapDraft[] = [{ kind: "fill", job: "writing.emails", ref: "@test-maker/private-pick" }];
    await post(opened.frame, { type: "save", v: 1, drafts });
    await waitFor(opened.frame, isStatus("confirm"));
    await post(opened.frame, { type: "confirm", v: 1 });
    await waitFor(opened.frame, isStatus("done"));

    assert.equal(registry.calls("GET", "/api/v1/skills/test-maker/private-pick/manifest").length, 1, "Fill goes through kit add");
    assert.ok(opened.printed.some((line) => /Couldn't add @test-maker\/private-pick/.test(line)), opened.printed.join("\n"));
    assert.equal(registry.backups.get("user-b")?.size, 1);
    assert.equal(registry.docs.get("user-b")?.version, 1);
  } finally {
    await opened.run.stop("interrupted");
    await registry.close();
  }
});

test("a backup refused for a secret is reported by file name alone, and the other backups go on", { timeout: 60_000 }, async () => {
  await resetHome();
  await writeSkill(join(CLAUDE, "leaky"), "leaky");
  await writeSkill(join(CLAUDE, "clean"), "clean");
  const registry = await new FakeRegistry().start();
  const opened = await openMap(registry);
  const leaky = keyOf(opened.scan, "leaky");
  registry.backupReply = (hash) =>
    hash === leaky
      ? {
          status: 422,
          body: {
            error: "scan_blocked",
            reason: "secret",
            findings: [{ category: "credential", confidence: "high", file: "references/config.md", lineStart: 3, lineEnd: 3 }],
          },
        }
      : null;
  try {
    await post(opened.frame, { type: "save", v: 1, drafts: [] });
    const session = await waitFor(opened.frame, (m) => m.type === "session");
    registry.approve(String(session.session));
    await waitFor(opened.frame, isStatus("done"));

    const report = registry.sessions.get(String(session.session))!.result as Record<string, unknown>;
    assert.equal(report.result, "applied");
    assert.deepEqual(report.not_backed_up, [{ name: "leaky", reason: "secret", file: "config.md" }]);
    assert.deepEqual(report.counts, { backups: 1, removals: 0, fills: 0, merges: 0 });
    assert.deepEqual([...(registry.backups.get("user-b")?.keys() ?? [])], [keyOf(opened.scan, "clean")]);
    assert.ok(opened.printed.includes("leaky isn't backed up: config.md looks like it holds a secret."), opened.printed.join("\n"));
  } finally {
    await opened.run.stop("interrupted");
    await registry.close();
  }
});

test("AE3: a waiting Remove of a plugin's skill changes no file and names the plugin", { timeout: 60_000 }, async () => {
  await resetHome();
  const install = join(HOME, ".claude", "plugins", "cache", "market", "alpha", "1.0.0");
  await writeSkill(join(install, "skills", "code-review"), "code-review");
  await writeJson(join(HOME, ".claude", "plugins", "installed_plugins.json"), {
    version: 2,
    plugins: { "alpha@market": [{ scope: "user", installPath: install, version: "1.0.0" }] },
  });
  await writeJson(join(HOME, ".claude", "settings.json"), { enabledPlugins: { "alpha@market": true } });
  await connectAs("skillet_d_valid");
  const registry = await new FakeRegistry().start();
  const opened = await openMap(registry);
  const plugin = opened.scan.entries.find((e) => e.name === "code-review");
  assert.equal(plugin?.source, "plugin");
  assert.deepEqual(plugin?.from, { kind: "plugin", name: "alpha", on: true });
  registry.changes.set("waiting-plugin", {
    id: "waiting-plugin",
    user: "user-b",
    device: "dev-valid",
    kind: "remove",
    version: 1,
    body: { key: plugin!.key },
  });
  const before = readFileSync(join(install, "skills", "code-review", "SKILL.md"), "utf8");
  try {
    await post(opened.frame, { type: "save", v: 1, drafts: [] });
    await waitFor(opened.frame, isStatus("confirm"));
    await post(opened.frame, { type: "confirm", v: 1 });
    await waitFor(opened.frame, isStatus("done"));

    assert.equal(readFileSync(join(install, "skills", "code-review", "SKILL.md"), "utf8"), before);
    assert.equal(registry.changes.get("waiting-plugin")?.outcome, "kept-plugin");
    assert.equal((await mapTrashRuns()).length, 0);
    assert.ok(
      opened.printed.includes("code-review came with the alpha plugin. Turn the plugin off to remove it."),
      opened.printed.join("\n"),
    );
  } finally {
    await opened.run.stop("interrupted");
    await registry.close();
  }
});

// ---------------------------------------------------------------------------
// The lock, and resuming (KTD10)
// ---------------------------------------------------------------------------

test("a second Save waits while another holds the lock, and says why", { timeout: 60_000 }, async () => {
  await resetHome();
  await writeSkill(join(CLAUDE, "notes"), "notes");
  await connectAs("skillet_d_valid");
  const registry = await new FakeRegistry().start();
  const held = await acquireMapSaveLock();
  const opened = await openMap(registry);
  try {
    await post(opened.frame, { type: "save", v: 1, drafts: [] });
    await waitFor(opened.frame, isStatus("confirm"));
    await post(opened.frame, { type: "confirm", v: 1 });
    const deadline = Date.now() + 10_000;
    while (!opened.printed.some((line) => /Another Save is running on this machine/.test(line))) {
      assert.ok(Date.now() < deadline, opened.printed.join("\n"));
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(registry.calls("PUT", "/api/v1/backups/").length, 0, "nothing happens while the lock is held");
    await held.release();
    await waitFor(opened.frame, isStatus("done"));
    assert.equal(registry.backups.get("user-b")?.size, 1);
  } finally {
    await held.release();
    await opened.run.stop("interrupted");
    await registry.close();
  }
});

test("the registry failing midway reports a partial result and fails the run; --apply finishes without trashing twice or uploading again", { timeout: 60_000 }, async () => {
  await resetHome();
  await writeSkill(join(CLAUDE, "old-notes"), "old-notes");
  await writeSkill(join(CLAUDE, "kept"), "kept");
  const registry = await new FakeRegistry().start();
  registry.failAck = true;
  registry.failMapPut = true;
  const opened = await openMap(registry);
  let uploads = 0;
  try {
    await post(opened.frame, { type: "save", v: 1, drafts: [{ kind: "remove", key: keyOf(opened.scan, "old-notes") }] });
    const session = await waitFor(opened.frame, (m) => m.type === "session");
    registry.approve(String(session.session));
    await waitFor(opened.frame, isStatus("failed"));
    assert.equal(await opened.run.done, "finished", "a Save that changed things and stopped partway ends the run");
    assert.equal(opened.flow.failed(), true, "so the command exits non-zero");
    const report = registry.sessions.get(String(session.session))!.result as Record<string, unknown>;
    assert.equal(report.result, "partial");
    assert.ok(opened.printed.some((line) => /Run `skillet map` again to finish/.test(line)), opened.printed.join("\n"));
    assert.equal(existsSync(join(CLAUDE, "old-notes")), false);
    assert.equal((await mapTrashRuns()).length, 1);
    uploads = registry.calls("PUT", "/api/v1/backups/").length;
    assert.equal(uploads, 2);
    assert.equal([...registry.changes.values()].filter((c) => !c.outcome).length, 1, "the remove is still recorded");
  } finally {
    await opened.run.stop("interrupted");
  }

  // The app's sync (or a rerun) finishes what's recorded.
  registry.failAck = false;
  registry.failMapPut = false;
  const printed: string[] = [];
  const result = await runMapApplyOnly({ registryUrl: registry.url, rescan: scanThisMachine, wire: wireEntries, print: (line) => printed.push(line), paceMs: 5 });
  try {
    assert.equal(result.result, "applied");
    assert.equal([...registry.changes.values()][0]?.outcome, "gone");
    assert.equal((await mapTrashRuns()).length, 1, "nothing trashed twice");
    assert.equal(registry.calls("PUT", "/api/v1/backups/").length, uploads, "nothing uploaded again");
    assert.ok(existsSync(join(CLAUDE, "kept", "SKILL.md")));
  } finally {
    await registry.close();
  }
});

test("--apply on a computer that isn't connected does nothing and says so", { timeout: 30_000 }, async () => {
  await resetHome();
  const registry = await new FakeRegistry().start();
  try {
    const result = await runMapApplyOnly({ registryUrl: registry.url, rescan: scanThisMachine, wire: wireEntries, paceMs: 5 });
    assert.equal(result.result, "not-connected");
    assert.deepEqual(registry.hits, []);
  } finally {
    await registry.close();
  }
});

// ---------------------------------------------------------------------------
// Merges (U14, KTD12): written by the person's own AI tool once Save is done
// ---------------------------------------------------------------------------

/** A merge writer in process. No test here reaches a real AI tool. */
function fakeWriter(): MergeWriter & { calls: string[] } {
  const calls: string[] = [];
  let n = 0;
  const nameIn = (skill: string) => /^name:\s*(.+)$/m.exec(skill)?.[1]?.trim() ?? "unnamed";
  return {
    name: "Test Writer",
    calls,
    async merge({ job, sources }) {
      calls.push("merge");
      return `---\nname: editing-merged\ndescription: One ${job.name} skill from ${sources.length}.\n---\n\n# ${job.name}\n\nEdit plainly.\n`;
    },
    async brief() {
      calls.push("brief");
      return "Tighten this note for a stranger: the meeting moved to Friday.";
    },
    async sample({ skill, brief }) {
      calls.push("sample");
      return `Sample ${++n} by ${nameIn(skill)} for: ${brief}`;
    },
  };
}

function mergeReports(registry: FakeRegistry): Array<Record<string, unknown>> {
  return registry.calls("PUT", "/api/v1/map-merges/").map((hit) => hit.body as Record<string, unknown>);
}

test("after Save, the CLI says it is writing merges with the person's AI tool, and stores them for the blind pick", { timeout: 60_000 }, async () => {
  await resetHome();
  await writeSkill(join(CLAUDE, "plain-prose"), "plain-prose", "Edit prose so it reads plainly.");
  await writeSkill(join(CLAUDE, "copy-editor"), "copy-editor", "Copy edit prose before it ships.");
  await connectAs("skillet_d_valid");
  const registry = await new FakeRegistry().start();
  const writer = fakeWriter();
  const opened = await openMap(registry, { mergeWriter: async () => writer });
  const before = readFileSync(join(CLAUDE, "plain-prose", "SKILL.md"), "utf8");
  try {
    const prose = keyOf(opened.scan, "plain-prose");
    const copy = keyOf(opened.scan, "copy-editor");
    const drafts: KitMapDraft[] = [
      { kind: "move", key: prose, job: "writing.editing" },
      { kind: "move", key: copy, job: "writing.editing" },
      { kind: "merge", job: "writing.editing", keys: [prose, copy] },
    ];
    await post(opened.frame, { type: "save", v: 1, drafts });
    await waitFor(opened.frame, isStatus("confirm"));
    await post(opened.frame, { type: "confirm", v: 1 });
    await waitFor(opened.frame, isStatus("done"));
    await opened.flow.settled();

    const lines = opened.printed.join("\n");
    const saved = opened.printed.findIndex((line) => /Saved your map to @test-user/.test(line));
    const writing = opened.printed.indexOf("Writing 1 merge with Test Writer. This can take a few minutes.");
    assert.ok(saved !== -1 && writing > saved, `Save is done before the merges start:\n${lines}`);
    assert.ok(
      opened.printed.some((line) => line.endsWith("Wrote the Editing merge. Your 2 skills stay until it wins a blind pick on skillet.md.")),
      lines,
    );

    const merge = [...registry.changes.values()].find((c) => c.kind === "merge");
    assert.ok(merge, "Save recorded the merge first");
    assert.equal(merge.outcome, "written");
    assert.deepEqual(mergeReports(registry).map((r) => r.status), ["writing", "ready"]);
    const ready = mergeReports(registry)[1]!;
    const rounds = ready.rounds as Array<{ key: string; merged: string; original: string }>;
    assert.deepEqual(rounds.map((r) => r.key), [prose, copy], "one blind round per original");
    assert.equal(writer.calls.filter((c) => c === "sample").length, 4, "2N samples for N originals");
    const backup = registry.backups.get("user-b")?.get(String(ready.merged)) as Record<string, unknown> | undefined;
    assert.equal(backup?.origin, "merge", "the merged skill is backed up privately as a merge");
    assert.deepEqual(backup?.sources, [
      { key: prose, private: true },
      { key: copy, private: true },
    ]);
    assert.equal((await readMapMergeRecord(merge.id))?.merged, ready.merged, "this machine records the bundle it wrote");
    assert.equal(readFileSync(join(CLAUDE, "plain-prose", "SKILL.md"), "utf8"), before, "the originals stay until a blind pick");
    assert.ok(existsSync(join(CLAUDE, "copy-editor", "SKILL.md")));
    assert.equal(await opened.run.done, "finished");
  } finally {
    await opened.run.stop("interrupted");
    await registry.close();
  }
});

test("a merge recorded while the CLI had exited is written on the next --apply, the app's sync", { timeout: 60_000 }, async () => {
  await resetHome();
  await writeSkill(join(CLAUDE, "plain-prose"), "plain-prose", "Edit prose so it reads plainly.");
  await writeSkill(join(CLAUDE, "every--house-style"), "house-style", "Write in the house style.");
  await connectAs("skillet_d_valid");
  const scan = await scanThisMachine();
  const prose = scan.entries.find((e) => e.name === "plain-prose")!.key;
  const house = scan.entries.find((e) => e.name === "house-style")!.key;
  const registry = await new FakeRegistry().start();
  registry.published.set(house, { ref: "@every/house-style", name: "house-style" });
  // Save recorded the merge, then the CLI exited before it wrote it.
  registry.changes.set("merge-1", {
    id: "merge-1",
    user: "user-b",
    device: "dev-valid",
    kind: "merge",
    version: 1,
    body: { job: "writing.editing", keys: [prose, house] },
  });
  const writer = fakeWriter();
  const printed: string[] = [];
  try {
    const result = await runMapApplyOnly({
      registryUrl: registry.url,
      rescan: scanThisMachine,
      wire: wireEntries,
      print: (line) => printed.push(line),
      paceMs: 5,
      mergeWriter: async () => writer,
    });
    assert.equal(result.result, "applied");
    if (result.result !== "applied") return;
    assert.equal(result.counts.merges, 1, "the app's JSON counts the merge written");
    assert.equal(result.left.merges, 0);
    assert.equal(registry.changes.get("merge-1")?.outcome, "written");
    assert.deepEqual(mergeReports(registry).map((r) => r.status), ["writing", "ready"]);
    const merged = String(mergeReports(registry)[1]!.merged);
    const backup = registry.backups.get("user-b")?.get(merged) as Record<string, unknown> | undefined;
    assert.deepEqual(backup?.sources, [
      { key: prose, private: true },
      { key: house, ref: "@every/house-style", name: "house-style" },
    ]);
    assert.deepEqual(printed, ["Writing 1 merge with Test Writer. This can take a few minutes."]);
    assert.ok(
      saveSummary(result).some((line) => line.endsWith("Wrote the Editing merge. Your 2 skills stay until it wins a blind pick on skillet.md.")),
      saveSummary(result).join("\n"),
    );
    assert.ok(existsSync(join(CLAUDE, "plain-prose", "SKILL.md")));
  } finally {
    await registry.close();
  }
});

test("with no supported AI tool, --apply leaves the merge waiting and says why", { timeout: 60_000 }, async () => {
  await resetHome();
  await writeSkill(join(CLAUDE, "plain-prose"), "plain-prose", "Edit prose so it reads plainly.");
  await writeSkill(join(CLAUDE, "copy-editor"), "copy-editor", "Copy edit prose before it ships.");
  await connectAs("skillet_d_valid");
  const scan = await scanThisMachine();
  const keys = ["plain-prose", "copy-editor"].map((name) => scan.entries.find((e) => e.name === name)!.key);
  const registry = await new FakeRegistry().start();
  registry.changes.set("merge-1", { id: "merge-1", user: "user-b", device: "dev-valid", kind: "merge", version: 1, body: { job: "writing.editing", keys } });
  // The sidecar's bare PATH, this fixture home, and no system folders: there is no AI tool to find.
  const empty = join(ROOT, "empty-bin");
  await mkdir(empty, { recursive: true });
  try {
    const result = await runMapApplyOnly({
      registryUrl: registry.url,
      rescan: scanThisMachine,
      wire: wireEntries,
      paceMs: 5,
      mergeWriter: () => findMergeWriter({ path: empty, home: HOME, systemDirs: [] }),
    });
    assert.equal(result.result, "applied", "a merge that waits is not a failed sync");
    if (result.result !== "applied") return;
    assert.equal(result.left.merges, 1, "the merge waits");
    assert.equal(registry.changes.get("merge-1")?.outcome, undefined);
    assert.deepEqual(mergeReports(registry), [{ status: "failed", reason: "no-ai-tool" }]);
    assert.equal(registry.calls("PUT", "/api/v1/backups/").length, 0, "nothing is stored");
    assert.ok(
      saveSummary(result).some((line) =>
        line.endsWith("Couldn't write the Editing merge: this machine has no Claude Code or Codex to write it with. It waits for the next Save."),
      ),
      saveSummary(result).join("\n"),
    );
  } finally {
    await registry.close();
  }
});
