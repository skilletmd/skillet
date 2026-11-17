/**
 * The loopback page `skillet map` serves on 127.0.0.1 (plan U6, KTD5).
 *
 * It holds one thing: a frame of the web's /map/embed, loaded with no referrer
 * so the page's per-run token never reaches the site or its analytics. Its
 * script is the loopback end of the postMessage bridge
 * (packages/web/src/components/map/embed-bridge.ts is the other):
 *
 * - It listens before the frame exists, takes a message only from the frame's
 *   own window and only from the web origin, and posts only to that origin.
 * - It sends `scan` only after the frame says `ready`, and again on every
 *   `ready` (a frame that reloads asks again).
 * - It forwards the frame's `drafts`, `save` and `confirm` to the CLI with the
 *   token header, and long-polls the CLI for `session` and `status`. When the
 *   CLI stops answering it tells the frame `ended`.
 * - With no `ready` within ten seconds it says the map couldn't load; the
 *   terminal prints the marks as text on its own clock (loopback-server.ts).
 *
 * The script is plain ES2017 with no imports, run by the person's browser, and
 * allowed by a per-response nonce.
 */
import { KIT_MAP_VERSION } from "@skillet/protocol/kit-map";

/** The header every write to the loopback server must carry, holding the run's token. */
export const MAP_TOKEN_HEADER = "x-skillet-map-token";

/** How long the page waits for the frame's `ready` before saying the map couldn't load. */
export const READY_WAIT_MS = 10_000;

/** The line people paste, as the frame shows it. */
const MAP_COMMAND = "npx -y skilletmd map";

export interface ShellPageInput {
  /** The site the map comes from, such as https://skillet.md. A path or trailing slash is ignored. */
  webUrl: string;
  /** The run's token: the page's path and the value of {@link MAP_TOKEN_HEADER}. */
  token: string;
  /** This response's nonce for the inline script and style. */
  nonce: string;
  readyWaitMs?: number;
}

/** The web's origin, which is all the page ever talks to. */
export function webOrigin(webUrl: string): string {
  return new URL(webUrl).origin;
}

/** Text for an HTML attribute or element body. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Characters a JSON value can hold that could end a <script> element or a line. */
const SCRIPT_UNSAFE = new Set([0x3c, 0x3e, 0x26, 0x2028, 0x2029]);

/** A value inlined into the script, safe inside a <script> element. */
function scriptValue(value: unknown): string {
  let out = "";
  for (const ch of JSON.stringify(value)) {
    const code = ch.charCodeAt(0);
    out += SCRIPT_UNSAFE.has(code) ? `\\u${code.toString(16).padStart(4, "0")}` : ch;
  }
  return out;
}

/** The page's Content-Security-Policy: nothing but its own script and style, its own origin, and the web's frame. */
export function shellPageCsp(input: { webOrigin: string; nonce: string }): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${input.nonce}'`,
    `style-src 'nonce-${input.nonce}'`,
    "connect-src 'self'",
    `frame-src ${input.webOrigin}`,
    "img-src data:",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** The page's script: the loopback end of the bridge (see the module comment). */
export function shellPageScript(input: { webOrigin: string; token: string; readyWaitMs: number }): string {
  return `(function () {
  "use strict";
  var WEB = ${scriptValue(input.webOrigin)};
  var BASE = ${scriptValue(`/${input.token}/`)};
  var TOKEN = ${scriptValue(input.token)};
  var HEADER = ${scriptValue(MAP_TOKEN_HEADER)};
  var V = ${scriptValue(KIT_MAP_VERSION)};
  var LOST = ${scriptValue("The map couldn't load. Your terminal lists what Skillet found.")};
  var CLOSED = ${scriptValue(`This map closed. Run ${MAP_COMMAND} to open it again.`)};
  var FORWARD = { drafts: true, save: true, confirm: true };
  var ready = false;
  var polling = false;
  var ended = false;

  function byId(id) { return document.getElementById(id); }
  function frameWindow() { var f = byId("map"); return f ? f.contentWindow : null; }
  function toFrame(message) { var w = frameWindow(); if (w) w.postMessage(message, WEB); }
  function show(text) {
    var note = byId("note");
    var frame = byId("map");
    if (note) { note.textContent = text || ""; note.hidden = !text; }
    if (frame) frame.hidden = !!text;
  }
  function toCli(message) {
    var headers = { "content-type": "application/json" };
    headers[HEADER] = TOKEN;
    return fetch(BASE + "message", {
      method: "POST",
      headers: headers,
      body: JSON.stringify(message),
      cache: "no-store",
      credentials: "omit"
    }).catch(function () {});
  }
  function end() {
    if (ended) return;
    ended = true;
    toFrame({ type: "status", v: V, state: "ended" });
  }
  function poll(after) {
    if (ended) return;
    fetch(BASE + "messages?after=" + after, { cache: "no-store", credentials: "omit" })
      .then(function (res) { if (!res.ok) throw new Error("poll " + res.status); return res.json(); })
      .then(function (body) {
        var list = body && Array.isArray(body.messages) ? body.messages : [];
        for (var i = 0; i < list.length; i++) {
          toFrame(list[i]);
          if (list[i] && list[i].type === "status" && list[i].state === "ended") ended = true;
        }
        poll(typeof body.next === "number" ? body.next : after);
      })
      .catch(end);
  }

  var scan = fetch(BASE + "scan", { cache: "no-store", credentials: "omit" })
    .then(function (res) { if (!res.ok) throw new Error("scan " + res.status); return res.json(); });
  scan.catch(function () {});

  window.addEventListener("message", function (event) {
    var w = frameWindow();
    if (!w || event.source !== w || event.origin !== WEB) return;
    var data = event.data;
    if (data === null || typeof data !== "object" || typeof data.type !== "string") return;
    if (data.type === "ready") {
      ready = true;
      show("");
      toCli({ type: "ready", v: data.v });
      scan.then(function (body) {
        toFrame({ type: "scan", v: V, scan: body.scan });
        if (!polling) { polling = true; poll(body.cursor); }
      }, function () { show(CLOSED); });
      return;
    }
    if (FORWARD[data.type] === true) toCli(data);
  });

  setTimeout(function () { if (!ready) show(LOST); }, ${scriptValue(input.readyWaitMs)});
})();`;
}

/** The whole page. */
export function shellPageHtml(input: ShellPageInput): string {
  const origin = webOrigin(input.webUrl);
  const nonce = escapeHtml(input.nonce);
  const script = shellPageScript({
    webOrigin: origin,
    token: input.token,
    readyWaitMs: input.readyWaitMs ?? READY_WAIT_MS,
  });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Your kit map</title>
<link rel="icon" href="data:,">
<style nonce="${nonce}">
:root { color-scheme: light dark; }
html, body { margin: 0; height: 100%; background: Canvas; color: CanvasText; }
body { font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
iframe { display: block; width: 100%; height: 100%; border: 0; }
#note { margin: 0; padding: 40px 16px; max-width: 560px; }
[hidden] { display: none !important; }
</style>
<script nonce="${nonce}">${script}</script>
</head>
<body>
<p id="note" role="status" hidden></p>
<iframe id="map" src="${escapeHtml(`${origin}/map/embed`)}" referrerpolicy="no-referrer" allow="clipboard-write" title="Your kit map"></iframe>
</body>
</html>
`;
}
