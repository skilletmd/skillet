/**
 * The loopback page `skillet map` serves (plan U6, KTD5; R2 R5).
 *
 * The server binds 127.0.0.1 under a random per-run path token, answers only a
 * Host of exactly that address, and takes writes only with the token header.
 * The page frames the web's /map/embed with no referrer, sends the scan only
 * after the frame's `ready`, and talks only to the web origin. Nothing here
 * touches the disk: the scan is a made-up payload and every server lives in
 * this process.
 */
import assert from "node:assert/strict";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import test from "node:test";
import { runInNewContext } from "node:vm";
import type { KitMapDraft, KitMapScan } from "@skillet/protocol/kit-map";
import {
  startMapServer,
  type MapFrameLink,
  type MapServer,
  type MapServerOptions,
} from "../src/map/loopback-server.js";
import { MAP_TOKEN_HEADER, shellPageScript } from "../src/map/shell-page.js";

const WEB = "https://web.test";
const KEY_A = `sha256:${"a".repeat(64)}`;
const KEY_B = `sha256:${"b".repeat(64)}`;

const SCAN: KitMapScan = {
  entries: [
    {
      key: KEY_A,
      name: "Plain Prose",
      description: "Edit prose so it reads plainly",
      source: "local",
      tools: [{ tool: "claude-code", copies: 1 }],
      job: "writing.editing",
      usage: { state: "used", reason: null },
    },
    {
      key: KEY_B,
      name: "Copy Editor",
      description: "",
      source: "local",
      tools: [{ tool: "claude-code", copies: 1 }],
      job: "writing.editing",
      usage: { state: "unused", reason: "no-recent-run" },
    },
  ],
  looked: [{ tool: "claude-code", history: "read" }],
  unchecked: [],
};

const REMOVE_B: KitMapDraft = { kind: "remove", key: KEY_B };

interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

/** A raw request, so a test can send any Host or Origin header it likes. */
function send(
  port: number,
  opts: { method?: string; path: string; headers?: Record<string, string>; body?: string },
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port, method: opts.method ?? "GET", path: opts.path, headers: opts.headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.on("error", reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

function postMessage(server: MapServer, message: unknown, headers: Record<string, string> = {}): Promise<Reply> {
  return send(server.port, {
    method: "POST",
    path: `/${server.token}/message`,
    headers: {
      "content-type": "application/json",
      [MAP_TOKEN_HEADER]: server.token,
      origin: server.origin,
      ...headers,
    },
    body: JSON.stringify(message),
  });
}

/** One long-poll: the messages queued after `after`. */
async function poll(server: MapServer, after = 0): Promise<{ messages: Array<Record<string, unknown>>; next: number }> {
  const reply = await send(server.port, { path: `/${server.token}/messages?after=${after}` });
  assert.equal(reply.status, 200, reply.body);
  return JSON.parse(reply.body) as { messages: Array<Record<string, unknown>>; next: number };
}

async function withServer(
  over: Partial<MapServerOptions>,
  fn: (server: MapServer) => Promise<void>,
): Promise<void> {
  const server = await startMapServer({
    scan: SCAN,
    webUrl: WEB,
    onSave: () => undefined,
    ...over,
  });
  try {
    await fn(server);
  } finally {
    await server.stop({ notify: false });
  }
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
async function settle(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) await tick();
}

// ---------------------------------------------------------------------------
// Address and token
// ---------------------------------------------------------------------------

test("the server binds 127.0.0.1 on a random port under a random path token", async () => {
  await withServer({}, async (server) => {
    assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]{32,}\/$/);
    assert.equal(server.origin, `http://127.0.0.1:${server.port}`);
    assert.ok(server.port > 0);
    await withServer({}, async (other) => {
      assert.notEqual(other.token, server.token, "every run mints its own token");
      assert.notEqual(other.port, server.port);
    });
  });
});

test("the page answers under its token and 404s without it", async () => {
  await withServer({}, async (server) => {
    const page = await send(server.port, { path: `/${server.token}/` });
    assert.equal(page.status, 200);
    assert.match(String(page.headers["content-type"]), /^text\/html/);
    assert.equal(page.headers["cache-control"], "no-store");
    assert.equal(page.headers["x-frame-options"], "DENY");
    assert.equal(page.headers["referrer-policy"], "no-referrer");

    for (const path of ["/", `/${server.token.slice(1)}/`, `/${server.token}x/`, "/favicon.ico", `/x/${server.token}/`]) {
      const missing = await send(server.port, { path });
      assert.equal(missing.status, 404, `${path} must 404`);
      assert.doesNotMatch(missing.body, /iframe|scan/i, `${path} must not leak the page`);
    }
    const scanWithout = await send(server.port, { path: "/scan" });
    assert.equal(scanWithout.status, 404);
  });
});

test("the page frames the web's /map/embed with no referrer, a phone viewport, and a CSP that pins the web origin", async () => {
  await withServer({}, async (server) => {
    const page = await send(server.port, { path: `/${server.token}/` });
    const html = page.body;
    assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
    assert.match(html, /<iframe[^>]+src="https:\/\/web\.test\/map\/embed"/);
    assert.match(html, /<iframe[^>]+referrerpolicy="no-referrer"/);

    const csp = String(page.headers["content-security-policy"]);
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /frame-src https:\/\/web\.test(;|$)/);
    assert.match(csp, /connect-src 'self'/);
    assert.match(csp, /frame-ancestors 'none'/);
    const nonce = /script-src 'nonce-([^']+)'/.exec(csp)?.[1];
    assert.ok(nonce, "the inline script runs by nonce, not unsafe-inline");
    assert.ok(html.includes(`<script nonce="${nonce}">`), "the page's script carries the CSP nonce");
    assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  });
});

test("the scan is served under the token, with the message cursor", async () => {
  await withServer({}, async (server) => {
    const reply = await send(server.port, { path: `/${server.token}/scan` });
    assert.equal(reply.status, 200);
    assert.match(String(reply.headers["content-type"]), /^application\/json/);
    const body = JSON.parse(reply.body) as { scan: KitMapScan; cursor: number };
    assert.deepEqual(body.scan, SCAN);
    assert.equal(body.cursor, 0);
  });
});

// ---------------------------------------------------------------------------
// Host and token checks
// ---------------------------------------------------------------------------

test("a request with a foreign Host header is rejected", async () => {
  await withServer({}, async (server) => {
    for (const host of ["evil.example", `evil.example:${server.port}`, `localhost:${server.port}`, `127.0.0.1:${server.port + 1}`]) {
      const page = await send(server.port, { path: `/${server.token}/`, headers: { host } });
      assert.equal(page.status, 421, `Host ${host} must be rejected`);
      assert.doesNotMatch(page.body, /iframe/);
      const write = await postMessage(server, { type: "drafts", v: 1, drafts: [REMOVE_B] }, { host });
      assert.equal(write.status, 421);
    }
    assert.deepEqual(server.drafts(), [], "a rebinding page can't inject drafts");
  });
});

test("a write without the token header is rejected, so a plain cross-site POST can't inject drafts", async () => {
  await withServer({}, async (server) => {
    const body = JSON.stringify({ type: "drafts", v: 1, drafts: [REMOVE_B] });
    // What an <form method=post enctype=text/plain> on another site can send.
    const crossSite = await send(server.port, {
      method: "POST",
      path: `/${server.token}/message`,
      headers: { "content-type": "text/plain", origin: "https://evil.example" },
      body,
    });
    assert.equal(crossSite.status, 403);

    const noHeader = await send(server.port, {
      method: "POST",
      path: `/${server.token}/message`,
      headers: { "content-type": "application/json", origin: server.origin },
      body,
    });
    assert.equal(noHeader.status, 403);

    const wrongToken = await postMessage(server, JSON.parse(body), { [MAP_TOKEN_HEADER]: `${server.token.slice(1)}x` });
    assert.equal(wrongToken.status, 403);

    const foreignOrigin = await postMessage(server, JSON.parse(body), { origin: "https://evil.example" });
    assert.equal(foreignOrigin.status, 403);

    const crossSiteFetch = await postMessage(server, JSON.parse(body), { "sec-fetch-site": "cross-site" });
    assert.equal(crossSiteFetch.status, 403);

    assert.deepEqual(server.drafts(), []);

    const ok = await postMessage(server, JSON.parse(body));
    assert.equal(ok.status, 200);
    assert.deepEqual(server.drafts(), [REMOVE_B]);
  });
});

test("writes are checked against the scan: unknown keys and other message types are refused", async () => {
  await withServer({}, async (server) => {
    const unknownKey = await postMessage(server, {
      type: "drafts",
      v: 1,
      drafts: [{ kind: "remove", key: `sha256:${"c".repeat(64)}` }],
    });
    assert.equal(unknownKey.status, 400);
    // The frame never sends these; only the loopback page's own messages go out.
    for (const message of [
      { type: "scan", v: 1, scan: SCAN },
      { type: "status", v: 1, state: "done" },
      { type: "drafts", v: 2, drafts: [] },
      { nope: true },
    ]) {
      const reply = await postMessage(server, message);
      assert.equal(reply.status, 400, JSON.stringify(message));
    }
    const notJson = await send(server.port, {
      method: "POST",
      path: `/${server.token}/message`,
      headers: { "content-type": "application/json", [MAP_TOKEN_HEADER]: server.token },
      body: "{",
    });
    assert.equal(notJson.status, 400);
    assert.deepEqual(server.drafts(), []);
  });
});

test("reads take only GET and the message endpoint takes only POST", async () => {
  await withServer({}, async (server) => {
    const postPage = await send(server.port, {
      method: "POST",
      path: `/${server.token}/`,
      headers: { [MAP_TOKEN_HEADER]: server.token, "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(postPage.status, 405);
    const getMessage = await send(server.port, { path: `/${server.token}/message` });
    assert.equal(getMessage.status, 405);
  });
});

// ---------------------------------------------------------------------------
// Ready, save, confirm, stop
// ---------------------------------------------------------------------------

test("with no ready from the frame within the wait after the page loads, onNoReady fires once", async () => {
  let fired = 0;
  await withServer({ readyWaitMs: 40, onNoReady: () => fired++ }, async (server) => {
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(fired, 0, "the wait starts when the page loads, not when the server starts");
    await send(server.port, { path: `/${server.token}/` });
    await send(server.port, { path: `/${server.token}/` });
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.equal(fired, 1);
  });
});

test("a ready from the frame cancels the no-ready summary", async () => {
  let fired = 0;
  await withServer({ readyWaitMs: 500, onNoReady: () => fired++ }, async (server) => {
    await send(server.port, { path: `/${server.token}/` });
    const ready = await postMessage(server, { type: "ready", v: 1 });
    assert.equal(ready.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 650));
    assert.equal(fired, 0);
  });
});

test("Save hands the drafts and a link to the save handler; the link reaches the frame and hears its confirm", async () => {
  let link: MapFrameLink | null = null;
  let saved: KitMapDraft[] | null = null;
  let confirmed: Promise<boolean> | null = null;
  await withServer(
    {
      onSave: (drafts, frame) => {
        saved = drafts;
        link = frame;
        frame.status("confirm", { handle: "test-handle" });
        confirmed = frame.confirmed();
      },
    },
    async (server) => {
      const reply = await postMessage(server, { type: "save", v: 1, drafts: [REMOVE_B] });
      assert.equal(reply.status, 202);
      await settle();
      assert.deepEqual(saved, [REMOVE_B]);
      assert.ok(link);

      const first = await poll(server, 0);
      assert.deepEqual(first.messages, [{ type: "status", v: 1, state: "confirm", handle: "test-handle" }]);

      const answer = await postMessage(server, { type: "confirm", v: 1 });
      assert.equal(answer.status, 200);
      assert.equal(await confirmed, true);

      link!.session({ session: "sess_test1", expiresAt: 1_900_000_000_000, proof: "p".repeat(43) });
      link!.status("failed", { reason: "not-ready" });
      const second = await poll(server, first.next);
      assert.deepEqual(second.messages, [
        { type: "session", v: 1, session: "sess_test1", expiresAt: 1_900_000_000_000, proof: "p".repeat(43) },
        { type: "status", v: 1, state: "failed", reason: "not-ready" },
      ]);
      assert.throws(() => link!.status("confirm"), "a confirm status needs the account handle");
    },
  );
});

test("one Save runs at a time; a second press while it runs is refused", async () => {
  let calls = 0;
  let release: () => void = () => undefined;
  await withServer(
    {
      onSave: () => {
        calls++;
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      },
    },
    async (server) => {
      assert.equal((await postMessage(server, { type: "save", v: 1, drafts: [] })).status, 202);
      await settle();
      assert.equal(server.saving(), true);
      assert.equal((await postMessage(server, { type: "save", v: 1, drafts: [] })).status, 409);
      release();
      await settle();
      assert.equal(server.saving(), false);
      assert.equal((await postMessage(server, { type: "save", v: 1, drafts: [] })).status, 202);
      await settle();
      assert.equal(calls, 2);
      release();
    },
  );
});

test("a save handler that throws leaves the frame a failed status, not a spinner", async () => {
  await withServer(
    {
      onSave: () => {
        throw new Error("boom");
      },
      onSaveError: () => undefined,
    },
    async (server) => {
      await postMessage(server, { type: "save", v: 1, drafts: [] });
      await settle();
      const { messages } = await poll(server, 0);
      assert.deepEqual(messages, [{ type: "status", v: 1, state: "failed", reason: "error" }]);
    },
  );
});

test("stop sends status ended to a waiting page, then closes the server", async () => {
  const server = await startMapServer({ scan: SCAN, webUrl: WEB, onSave: () => undefined });
  const waiting = poll(server, 0);
  await settle();
  await server.stop({ notify: true });
  const { messages } = await waiting;
  assert.deepEqual(messages, [{ type: "status", v: 1, state: "ended" }]);
  await assert.rejects(send(server.port, { path: `/${server.token}/` }), /ECONNREFUSED|socket hang up|ECONNRESET/);
  // Stopping twice is harmless.
  await server.stop({ notify: true });
});

test("stopping aborts the link and answers a pending confirm with false", async () => {
  let link: MapFrameLink | null = null;
  const server = await startMapServer({
    scan: SCAN,
    webUrl: WEB,
    onSave: (_drafts, frame) => {
      link = frame;
      frame.status("confirm", { handle: "test-handle" });
    },
  });
  await postMessage(server, { type: "save", v: 1, drafts: [] });
  await settle();
  assert.ok(link);
  const answer = link!.confirmed();
  await server.stop({ notify: false });
  assert.equal(await answer, false);
  assert.equal(link!.signal.aborted, true);
});

// ---------------------------------------------------------------------------
// The page's script, run against a fake window
// ---------------------------------------------------------------------------

interface FakeEvent {
  source: unknown;
  origin: string;
  data: unknown;
}

interface FakeFetch {
  url: string;
  init?: { method?: string; headers?: Record<string, string>; body?: string };
}

function loadPage(opts: { readyWaitMs?: number } = {}) {
  const token = "T".repeat(43);
  const posted: Array<{ message: unknown; target: string }> = [];
  const fetches: FakeFetch[] = [];
  const listeners: Array<(event: FakeEvent) => void> = [];
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const frameWindow = { postMessage: (message: unknown, target: string) => posted.push({ message, target }) };
  const frame = { contentWindow: frameWindow, hidden: false };
  const note = { textContent: "", hidden: true };
  // Polls wait here until the test answers them.
  const polls: Array<{ resolve: (value: unknown) => void; reject: (err: Error) => void }> = [];

  const json = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  const fetch = (url: string, init?: FakeFetch["init"]) => {
    fetches.push({ url, init });
    if (url === `/${token}/scan`) return Promise.resolve(json({ scan: SCAN, cursor: 0 }));
    if (url.startsWith(`/${token}/messages`)) {
      return new Promise((resolve, reject) => polls.push({ resolve, reject }));
    }
    if (url === `/${token}/message`) return Promise.resolve(json({ ok: true }));
    return Promise.resolve(json(null, 404));
  };

  const context = {
    window: {
      addEventListener: (type: string, fn: (event: FakeEvent) => void) => {
        if (type === "message") listeners.push(fn);
      },
    },
    document: {
      getElementById: (id: string) => (id === "map" ? frame : id === "note" ? note : null),
    },
    fetch,
    setTimeout: (fn: () => void, ms: number) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimeout: () => undefined,
  };
  runInNewContext(shellPageScript({ webOrigin: WEB, token, readyWaitMs: opts.readyWaitMs ?? 10_000 }), context);

  const dispatch = (event: FakeEvent) => {
    for (const listener of listeners) listener(event);
  };
  return { token, posted, fetches, timers, frame, frameWindow, note, polls, dispatch, json };
}

/** Objects the page made carry its realm's prototypes; compare their data. */
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value)) as unknown;

const writes = (page: ReturnType<typeof loadPage>) =>
  page.fetches.filter((f) => f.url === `/${page.token}/message`);

test("the page's bridge ignores messages from any origin but the web's, and from any window but its frame", async () => {
  const page = loadPage();
  const elsewhere = { postMessage: () => undefined };
  page.dispatch({ source: page.frameWindow, origin: "https://evil.example", data: { type: "ready", v: 1 } });
  page.dispatch({ source: page.frameWindow, origin: "http://127.0.0.1:9999", data: { type: "ready", v: 1 } });
  page.dispatch({ source: elsewhere, origin: WEB, data: { type: "ready", v: 1 } });
  page.dispatch({ source: page.frameWindow, origin: "https://evil.example", data: { type: "drafts", v: 1, drafts: [REMOVE_B] } });
  page.dispatch({ source: page.frameWindow, origin: "https://evil.example", data: { type: "save", v: 1, drafts: [REMOVE_B] } });
  await settle();
  assert.deepEqual(page.posted, [], "nothing goes to the frame before its own ready");
  assert.deepEqual(writes(page), [], "nothing from another origin reaches the CLI");
});

test("the page sends the scan only after ready from the web origin, and only to the web origin", async () => {
  const page = loadPage();
  await settle();
  assert.deepEqual(page.posted, []);
  page.dispatch({ source: page.frameWindow, origin: WEB, data: { type: "ready", v: 1 } });
  await settle();
  assert.equal(page.posted.length, 1);
  assert.deepEqual(plain(page.posted[0]), { message: { type: "scan", v: 1, scan: SCAN }, target: WEB });
  // It tells the CLI the frame is up, with the token header.
  const [ready] = writes(page);
  assert.ok(ready);
  assert.equal(ready.init?.method, "POST");
  assert.equal(ready.init?.headers?.[MAP_TOKEN_HEADER], page.token);
  assert.deepEqual(JSON.parse(ready.init?.body ?? "null"), { type: "ready", v: 1 });

  // A frame that reloads says ready again and gets the scan again.
  page.dispatch({ source: page.frameWindow, origin: WEB, data: { type: "ready", v: 1 } });
  await settle();
  assert.equal(page.posted.filter((p) => (p.message as { type: string }).type === "scan").length, 2);
});

test("the page forwards the frame's drafts, save and confirm to the CLI with the token header", async () => {
  const page = loadPage();
  page.dispatch({ source: page.frameWindow, origin: WEB, data: { type: "ready", v: 1 } });
  await settle();
  for (const data of [
    { type: "drafts", v: 1, drafts: [REMOVE_B] },
    { type: "save", v: 1, drafts: [REMOVE_B] },
    { type: "confirm", v: 1 },
  ]) {
    page.dispatch({ source: page.frameWindow, origin: WEB, data });
  }
  // A type the frame never sends is not forwarded.
  page.dispatch({ source: page.frameWindow, origin: WEB, data: { type: "proof", v: 1 } });
  await settle();
  const bodies = writes(page).map((f) => JSON.parse(f.init?.body ?? "null") as { type: string });
  assert.deepEqual(
    bodies.map((b) => b.type),
    ["ready", "drafts", "save", "confirm"],
  );
  for (const write of writes(page)) {
    assert.equal(write.init?.headers?.[MAP_TOKEN_HEADER], page.token);
    assert.equal(write.init?.headers?.["content-type"], "application/json");
  }
});

test("the page passes the CLI's messages to the frame, and says ended when the CLI goes away", async () => {
  const page = loadPage();
  page.dispatch({ source: page.frameWindow, origin: WEB, data: { type: "ready", v: 1 } });
  await settle();
  assert.equal(page.polls.length, 1, "the page polls once the scan is out");
  page.polls[0]!.resolve(page.json({ messages: [{ type: "status", v: 1, state: "failed", reason: "not-ready" }], next: 1 }));
  await settle();
  assert.deepEqual(plain(page.posted.at(-1)), { message: { type: "status", v: 1, state: "failed", reason: "not-ready" }, target: WEB });
  assert.equal(page.polls.length, 2);
  assert.match(page.fetches.filter((f) => f.url.includes("/messages")).at(-1)!.url, /after=1$/);
  page.polls[1]!.reject(new Error("connection refused"));
  await settle();
  assert.deepEqual(plain(page.posted.at(-1)), { message: { type: "status", v: 1, state: "ended" }, target: WEB });
  assert.equal(page.polls.length, 2, "the page stops polling a server that's gone");
});

test("with no ready within the wait, the page says the map couldn't load; a late ready brings the map back", async () => {
  const page = loadPage({ readyWaitMs: 10_000 });
  const timer = page.timers.find((t) => t.ms === 10_000);
  assert.ok(timer, "the page waits 10 seconds for ready");
  timer.fn();
  assert.equal(page.note.hidden, false);
  assert.match(page.note.textContent, /couldn't load/);
  assert.match(page.note.textContent, /terminal/);
  assert.equal(page.frame.hidden, true);
  page.dispatch({ source: page.frameWindow, origin: WEB, data: { type: "ready", v: 1 } });
  await settle();
  assert.equal(page.note.hidden, true);
  assert.equal(page.frame.hidden, false);
});
