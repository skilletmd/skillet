/**
 * The server behind `skillet map`'s loopback page (plan U6, KTD5; R2 R5).
 *
 * It binds 127.0.0.1 on a random port and answers only under a random per-run
 * path token, so no other page can find it. Every request must name exactly
 * that address in its Host header, which stops a DNS-rebinding page, and every
 * write must carry the token in {@link MAP_TOKEN_HEADER}, which a plain
 * cross-site form or fetch can't send without a preflight this server never
 * answers. The same pattern guards the MCP loopback transport
 * (packages/mcp/src/transport/http.ts), except that this token lives only in
 * this process: nothing is written to disk.
 *
 * Routes, all under `/<token>/`:
 *   GET  /            the page (shell-page.ts)
 *   GET  scan         the scan the frame draws, and the message cursor
 *   GET  messages     a long-poll for `session` and `status`, after a cursor
 *   POST message      what the frame sends: `ready`, `drafts`, `save`, `confirm`
 *
 * Drafts stay in this process. Save hands them to the injected save handler
 * with a link to the frame; the CLI changes nothing on its own (R5).
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import {
  KIT_MAP_VERSION,
  parseKitMapMessage,
  type KitMapDraft,
  type KitMapScan,
  type KitMapSessionMessage,
  type KitMapStatusMessage,
  type KitMapStatusState,
} from "@skillet/protocol/kit-map";
import { MAP_TOKEN_HEADER, READY_WAIT_MS, shellPageCsp, shellPageHtml, webOrigin } from "./shell-page.js";

const HOST = "127.0.0.1";
/** How long a poll waits for news before answering empty. */
const POLL_WAIT_MS = 25_000;
/** How long stopping waits for the page to take `ended`. */
const STOP_GRACE_MS = 1_000;
/** How long stopping waits for open connections before cutting them. */
const CLOSE_GRACE_MS = 2_000;
/** A draft list can be long; nothing legitimate comes near this. */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

const COMMON_HEADERS: Readonly<Record<string, string>> = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cross-origin-resource-policy": "same-origin",
};

/**
 * What a save handler gets: a way to talk to the frame while Save runs. Every
 * message is checked against `@skillet/protocol/kit-map` before it goes out,
 * so a malformed one throws here instead of being dropped by the frame.
 */
export interface MapFrameLink {
  /** Hands the frame the map session Save opened, for the save tab. */
  session(session: { session: string; expiresAt: number; proof: string }): void;
  /** Says where Save is. `confirm` needs the account `handle`; nothing else may carry one. */
  status(state: KitMapStatusState, extra?: { reason?: string; handle?: string }): void;
  /**
   * Resolves true when the person confirms the account the latest `confirm`
   * status named, or false if the run stops first or no confirm is pending.
   */
  confirmed(): Promise<boolean>;
  /** The run is over: stop serving, without telling the frame `ended`. */
  finish(): void;
  /** Aborts when the run stops. */
  readonly signal: AbortSignal;
}

/** Runs when the person presses Save. One runs at a time. */
export type MapSaveHandler = (drafts: KitMapDraft[], link: MapFrameLink) => void | Promise<void>;

export interface MapServerOptions {
  /** What the frame draws. It holds no path. */
  scan: KitMapScan;
  /** The site the frame comes from (`webBaseUrl()`). */
  webUrl: string;
  onSave: MapSaveHandler;
  /** The page loaded, but the frame said no `ready` within `readyWaitMs`. Called once. */
  onNoReady?: () => void;
  /** The person did something in the map: drafted, pressed Save, confirmed, or a Save ended. */
  onActivity?: () => void;
  /** A save handler called `finish`. */
  onFinish?: () => void;
  /** A save handler threw; the frame has already been told `failed`. */
  onSaveError?: (err: unknown) => void;
  readyWaitMs?: number;
  pollWaitMs?: number;
}

export interface MapServer {
  /** `http://127.0.0.1:<port>/<token>/`, the address to open. */
  readonly url: string;
  /** `http://127.0.0.1:<port>`. */
  readonly origin: string;
  readonly port: number;
  readonly token: string;
  /** The drafts the frame sent last, checked against the scan. */
  drafts(): KitMapDraft[];
  /** Whether a save handler is running. */
  saving(): boolean;
  /**
   * Tells the frame `ended` (unless `notify` is false), gives the page a moment
   * to take it, and closes. Safe to call more than once.
   */
  stop(opts?: { notify?: boolean }): Promise<void>;
}

type Outgoing = KitMapSessionMessage | KitMapStatusMessage;

interface Poller {
  after: number;
  res: ServerResponse;
  timer: NodeJS.Timeout;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

class BodyTooLarge extends Error {}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new BodyTooLarge());
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(
  res: ServerResponse,
  status: number,
  body: string,
  headers: Record<string, string> = {},
): void {
  if (res.headersSent) return;
  res.writeHead(status, {
    ...COMMON_HEADERS,
    "content-type": "text/plain; charset=utf-8",
    ...headers,
    "content-length": String(Buffer.byteLength(body)),
  });
  res.end(body);
}

function sendJson(res: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}): void {
  send(res, status, JSON.stringify(value), { ...headers, "content-type": "application/json; charset=utf-8" });
}

const STATUS_TEXT: Readonly<Record<number, string>> = {
  400: "Bad request",
  403: "Forbidden",
  404: "Not found",
  405: "Method not allowed",
  409: "Save is already running",
  413: "Too large",
  415: "Send JSON",
  421: "Misdirected request",
  500: "Server error",
};

function sendStatus(res: ServerResponse, status: number, headers: Record<string, string> = {}): void {
  // A body even on success: Chromium reports a fetch answered 204 as aborted,
  // which reads as a failure in DevTools and in screenshot tooling.
  if (status === 200 || status === 202) return sendJson(res, status, { ok: true }, headers);
  send(res, status, STATUS_TEXT[status] ?? "Error", headers);
}

type Route = "page" | "scan" | "messages" | "message" | null;

/** Serve the map page and its bridge on 127.0.0.1 (see the module comment). */
export function startMapServer(opts: MapServerOptions): Promise<MapServer> {
  const token = randomBytes(32).toString("base64url");
  const tokenBytes = Buffer.from(token, "utf8");
  const web = webOrigin(opts.webUrl);
  const readyWaitMs = opts.readyWaitMs ?? READY_WAIT_MS;
  const pollWaitMs = opts.pollWaitMs ?? POLL_WAIT_MS;
  const entries = opts.scan.entries;

  const log: Outgoing[] = [];
  const pollers = new Set<Poller>();
  const deliveredWaiters: Array<{ target: number; resolve: () => void }> = [];
  let delivered = 0;
  let polled = false;
  let drafts: KitMapDraft[] = [];
  let pageServed = false;
  let ready = false;
  let readyTimer: NodeJS.Timeout | null = null;
  let saving = false;
  let stopped = false;
  let stopPromise: Promise<void> | null = null;
  let pendingConfirm: Deferred<boolean> | null = null;
  const stopping = new AbortController();
  let port = 0;
  let host = "";
  let origin = "";

  const sameToken = (candidate: string): boolean => {
    const bytes = Buffer.from(candidate, "utf8");
    return bytes.length === tokenBytes.length && timingSafeEqual(bytes, tokenBytes);
  };

  const answer = (poller: Poller): void => {
    clearTimeout(poller.timer);
    pollers.delete(poller);
    const next = log.length;
    delivered = Math.max(delivered, next);
    sendJson(poller.res, 200, { messages: log.slice(poller.after), next }, stopped ? { connection: "close" } : {});
    for (let i = deliveredWaiters.length - 1; i >= 0; i--) {
      const waiter = deliveredWaiters[i]!;
      if (delivered >= waiter.target) {
        deliveredWaiters.splice(i, 1);
        waiter.resolve();
      }
    }
  };

  const flush = (): void => {
    for (const poller of [...pollers]) if (log.length > poller.after) answer(poller);
  };

  /** Check a message against the protocol and queue it for the page. */
  const emit = (message: Record<string, unknown>): void => {
    const parsed = parseKitMapMessage(message);
    if (parsed === null || (parsed.type !== "session" && parsed.type !== "status")) {
      throw new Error(`not a message the loopback page sends: ${JSON.stringify(message)}`);
    }
    if (stopped) return;
    log.push(parsed);
    flush();
  };

  const status = (state: KitMapStatusState, extra: { reason?: string; handle?: string } = {}): void => {
    emit({
      type: "status",
      v: KIT_MAP_VERSION,
      state,
      ...(extra.reason !== undefined ? { reason: extra.reason } : {}),
      ...(extra.handle !== undefined ? { handle: extra.handle } : {}),
    });
    if (state === "confirm" && !stopped) {
      pendingConfirm?.resolve(false);
      pendingConfirm = deferred<boolean>();
    }
  };

  const link: MapFrameLink = {
    session: ({ session, expiresAt, proof }) =>
      emit({ type: "session", v: KIT_MAP_VERSION, session, expiresAt, proof }),
    status,
    confirmed: () => pendingConfirm?.promise ?? Promise.resolve(false),
    finish: () => opts.onFinish?.(),
    signal: stopping.signal,
  };

  const startSave = (saveDrafts: KitMapDraft[]): boolean => {
    if (saving || stopped) return false;
    saving = true;
    drafts = saveDrafts;
    opts.onActivity?.();
    void (async () => {
      try {
        await opts.onSave(saveDrafts, link);
      } catch (err) {
        opts.onSaveError?.(err);
        status("failed", { reason: "error" });
      } finally {
        saving = false;
        opts.onActivity?.();
      }
    })();
    return true;
  };

  const servePage = (res: ServerResponse): void => {
    const nonce = randomBytes(18).toString("base64url");
    const html = shellPageHtml({ webUrl: opts.webUrl, token, nonce, readyWaitMs });
    send(res, 200, html, {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": shellPageCsp({ webOrigin: web, nonce }),
      "x-frame-options": "DENY",
    });
    if (pageServed) return;
    pageServed = true;
    if (!ready && opts.onNoReady) {
      readyTimer = setTimeout(() => {
        readyTimer = null;
        if (!ready && !stopped) opts.onNoReady?.();
      }, readyWaitMs);
    }
  };

  const servePoll = (url: URL, res: ServerResponse): void => {
    const raw = url.searchParams.get("after") ?? "0";
    if (!/^\d{1,9}$/.test(raw)) return sendStatus(res, 400);
    polled = true;
    const poller: Poller = {
      after: Math.min(Number(raw), log.length),
      res,
      timer: setTimeout(() => answer(poller), pollWaitMs),
    };
    pollers.add(poller);
    // The page went away (closed tab, reload): stop holding its request.
    res.on("close", () => {
      if (!pollers.has(poller)) return;
      clearTimeout(poller.timer);
      pollers.delete(poller);
    });
    if (log.length > poller.after || stopped) answer(poller);
  };

  const serveWrite = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const header = req.headers[MAP_TOKEN_HEADER];
    if (typeof header !== "string" || !sameToken(header)) return sendStatus(res, 403);
    const from = req.headers.origin;
    if (from !== undefined && from !== origin) return sendStatus(res, 403);
    const site = req.headers["sec-fetch-site"];
    if (site !== undefined && site !== "same-origin") return sendStatus(res, 403);
    const type = req.headers["content-type"];
    if (typeof type !== "string" || !/^application\/json\s*(;|$)/i.test(type.trim())) return sendStatus(res, 415);

    let value: unknown;
    try {
      value = JSON.parse(await readBody(req));
    } catch (err) {
      return sendStatus(res, err instanceof BodyTooLarge ? 413 : 400);
    }
    const message = parseKitMapMessage(value, entries);
    if (message === null) return sendStatus(res, 400);
    switch (message.type) {
      case "ready":
        ready = true;
        if (readyTimer) {
          clearTimeout(readyTimer);
          readyTimer = null;
        }
        return sendStatus(res, 200);
      case "drafts":
        drafts = message.drafts;
        opts.onActivity?.();
        return sendStatus(res, 200);
      case "save":
        return sendStatus(res, startSave(message.drafts) ? 202 : 409);
      case "confirm":
        opts.onActivity?.();
        pendingConfirm?.resolve(true);
        pendingConfirm = null;
        return sendStatus(res, 200);
      default:
        // scan, session and status are the loopback page's to send; proof and
        // proof-request belong to the save tab.
        return sendStatus(res, 400);
    }
  };

  const route = (url: URL): Route => {
    const parts = url.pathname.split("/");
    if (parts[0] !== "" || parts.length < 2 || parts.length > 3 || !sameToken(parts[1] ?? "")) return null;
    const leaf = parts[2] ?? "";
    if (leaf === "") return "page";
    if (leaf === "scan" || leaf === "messages" || leaf === "message") return leaf;
    return null;
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // DNS-rebinding guard: only this exact address, never a name that points here.
    if (req.headers.host !== host) return sendStatus(res, 421);
    let url: URL;
    try {
      url = new URL(req.url ?? "/", origin);
    } catch {
      return sendStatus(res, 404);
    }
    const where = route(url);
    if (where === null) return sendStatus(res, 404);
    if (where === "message") {
      if (req.method !== "POST") return sendStatus(res, 405, { allow: "POST" });
      return serveWrite(req, res);
    }
    if (req.method !== "GET") return sendStatus(res, 405, { allow: "GET" });
    if (where === "page") return servePage(res);
    if (where === "scan") return sendJson(res, 200, { scan: opts.scan, cursor: log.length });
    return servePoll(url, res);
  };

  const server = createServer((req, res) => {
    // A response still going out when the server stops leaves a keep-alive
    // socket behind; close it as soon as it's idle so stopping doesn't wait.
    res.on("finish", () => {
      if (stopped && typeof server.closeIdleConnections === "function") {
        setImmediate(() => server.closeIdleConnections());
      }
    });
    handle(req, res).catch(() => sendStatus(res, 500));
  });

  const waitDelivered = (target: number, ms: number): Promise<void> =>
    new Promise((resolve) => {
      if (delivered >= target) return resolve();
      const waiter = { target, resolve: () => (clearTimeout(timer), resolve()) };
      const timer = setTimeout(() => {
        const at = deliveredWaiters.indexOf(waiter);
        if (at !== -1) deliveredWaiters.splice(at, 1);
        resolve();
      }, ms);
      deliveredWaiters.push(waiter);
    });

  const close = (): Promise<void> =>
    new Promise((resolve) => {
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        clearTimeout(force);
        resolve();
      };
      const force = setTimeout(() => {
        if (typeof server.closeAllConnections === "function") server.closeAllConnections();
        finish();
      }, CLOSE_GRACE_MS);
      server.close(() => finish());
      if (typeof server.closeIdleConnections === "function") server.closeIdleConnections();
    });

  const stop = ({ notify = true }: { notify?: boolean } = {}): Promise<void> => {
    stopPromise ??= (async () => {
      if (readyTimer) {
        clearTimeout(readyTimer);
        readyTimer = null;
      }
      if (notify) status("ended");
      stopped = true;
      stopping.abort();
      pendingConfirm?.resolve(false);
      pendingConfirm = null;
      if (notify && polled) await waitDelivered(log.length, STOP_GRACE_MS);
      for (const poller of [...pollers]) answer(poller);
      await close();
    })();
    return stopPromise;
  };

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, HOST, () => {
      server.off("error", reject);
      port = (server.address() as AddressInfo).port;
      host = `${HOST}:${port}`;
      origin = `http://${host}`;
      resolve({
        url: `${origin}/${token}/`,
        origin,
        port,
        token,
        drafts: () => [...drafts],
        saving: () => saving,
        stop,
      });
    });
  });
}
