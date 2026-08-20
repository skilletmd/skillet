/**
 * Public web origin proxy: round-robins to N `next start` workers.
 *
 * Cloudflare (and local curls) hit WEB_PORT (default 3480). Workers bind
 * WEB_WORKER_BASE..+N-1 (default 3482, 3483). One Node event loop per worker
 * so logged-in browse stampedes do not queue forever behind a single process.
 *
 * When the client disconnects (rapid Browse navigation / CF abort), we destroy
 * the upstream request so Next workers are not left rendering abandoned pages.
 *
 * Browse admission: cap concurrent /browse* forwards. Surplus get a fast 429 so
 * Auth.js stampedes cannot fill workers until Cloudflare returns sitewide 503s.
 *
 * Env:
 *   WEB_PORT / PORT              listen port (3480)
 *   WEB_WORKER_BASE              first worker port (3482)
 *   WEB_WORKERS                  worker count (2)
 *   WEB_WORKER_HOST              upstream host (127.0.0.1)
 *   WEB_UPSTREAM_TIMEOUT_MS      upstream socket timeout (default 25000; was 120s)
 *   WEB_BROWSE_MAX_INFLIGHT      max concurrent /browse* upstreams (default 4*workers, min 4)
 */
const http = require("node:http");

const DEFAULT_UPSTREAM_TIMEOUT_MS = 25_000;
const DEFAULT_BROWSE_MAX_PER_WORKER = 4;

/** True for Browse document paths (/browse, /browse/...), including ?query. */
function isBrowseProxyPath(urlPath) {
  if (typeof urlPath !== "string" || urlPath.length === 0) return false;
  let pathname = urlPath;
  try {
    pathname = new URL(urlPath, "http://web.local").pathname;
  } catch {
    const q = urlPath.indexOf("?");
    pathname = q >= 0 ? urlPath.slice(0, q) : urlPath;
  }
  return pathname === "/browse" || pathname.startsWith("/browse/");
}

/**
 * @param {{
 *   listenPort?: number,
 *   workerBase?: number,
 *   workerCount?: number,
 *   workerHost?: string,
 *   upstreamTimeoutMs?: number,
 *   browseMaxInflight?: number,
 * }} [config]
 */
function createOriginProxyServer(config = {}) {
  const listenPort = Number(
    config.listenPort ?? process.env.WEB_PORT ?? process.env.PORT ?? "3480",
  );
  const workerBase = Number(config.workerBase ?? process.env.WEB_WORKER_BASE ?? "3482");
  const workerCount = Math.max(
    1,
    Math.floor(Number(config.workerCount ?? process.env.WEB_WORKERS ?? "2")) || 2,
  );
  const workerHost =
    (config.workerHost ?? process.env.WEB_WORKER_HOST ?? "127.0.0.1").trim() || "127.0.0.1";
  const upstreamTimeoutMs = Math.max(
    1_000,
    Number(config.upstreamTimeoutMs ?? process.env.WEB_UPSTREAM_TIMEOUT_MS ?? DEFAULT_UPSTREAM_TIMEOUT_MS) ||
      DEFAULT_UPSTREAM_TIMEOUT_MS,
  );

  const browseMaxRaw = config.browseMaxInflight ?? process.env.WEB_BROWSE_MAX_INFLIGHT;
  const browseMaxInflight =
    browseMaxRaw != null && String(browseMaxRaw).trim() !== ""
      ? Math.max(1, Math.floor(Number(browseMaxRaw)) || 1)
      : Math.max(4, workerCount * DEFAULT_BROWSE_MAX_PER_WORKER);

  const upstreams = Array.from({ length: workerCount }, (_, i) => workerBase + i);
  let rr = 0;
  let browseInflight = 0;

  function pickUpstream() {
    const port = upstreams[rr % upstreams.length];
    rr += 1;
    return port;
  }

  function proxy(req, res) {
    const browse = isBrowseProxyPath(req.url || "/");
    if (browse && browseInflight >= browseMaxInflight) {
      res.writeHead(429, {
        "content-type": "text/plain; charset=utf-8",
        "retry-after": "1",
        "cache-control": "no-store",
      });
      res.end("web origin proxy: browse capacity exceeded\n");
      return;
    }

    if (browse) browseInflight += 1;
    let browseReleased = false;
    const releaseBrowse = () => {
      if (!browse || browseReleased) return;
      browseReleased = true;
      browseInflight = Math.max(0, browseInflight - 1);
    };

    const port = pickUpstream();
    const headers = { ...req.headers, host: req.headers.host || `127.0.0.1:${listenPort}` };
    // Preserve CF / client IP headers for TRUST_CF_CONNECTING_IP on workers.
    const opts = {
      protocol: "http:",
      hostname: workerHost,
      port,
      path: req.url,
      method: req.method,
      headers,
      timeout: upstreamTimeoutMs,
    };

    /** @type {import('node:http').IncomingMessage | null} */
    let upRes = null;
    let finished = false;

    const upstream = http.request(opts, (incoming) => {
      upRes = incoming;
      if (finished || res.writableEnded || res.destroyed) {
        incoming.destroy();
        releaseBrowse();
        return;
      }
      res.writeHead(incoming.statusCode || 502, incoming.headers);
      incoming.pipe(res);
      incoming.on("error", () => {
        if (!res.writableEnded) res.destroy();
      });
    });

    const destroyUpstream = () => {
      if (upRes && !upRes.destroyed) upRes.destroy();
      if (!upstream.destroyed) upstream.destroy();
    };

    // Client left (rapid navigation / CF abort): stop burning the Next worker.
    const onClientGone = () => {
      if (finished || res.writableEnded) return;
      destroyUpstream();
    };
    req.on("aborted", onClientGone);
    res.on("close", () => {
      releaseBrowse();
      onClientGone();
    });
    res.on("finish", () => {
      finished = true;
      releaseBrowse();
    });

    upstream.on("timeout", () => {
      upstream.destroy(new Error("upstream timeout"));
    });

    upstream.on("error", (err) => {
      releaseBrowse();
      if (finished || res.writableEnded || res.destroyed) return;
      if (res.headersSent) {
        res.destroy(err);
        return;
      }
      res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      res.end(`web origin proxy: upstream :${port} unavailable (${err.message})\n`);
    });

    req.pipe(upstream);
  }

  const server = http.createServer(proxy);
  return {
    server,
    listenPort,
    upstreams,
    workerHost,
    upstreamTimeoutMs,
    browseMaxInflight,
  };
}

function main() {
  const { server, listenPort, upstreams, workerHost, browseMaxInflight } = createOriginProxyServer();

  server.on("error", (err) => {
    console.error("[web-origin-proxy] listen error", err);
    process.exit(1);
  });

  server.listen(listenPort, "0.0.0.0", () => {
    console.log(
      `[web-origin-proxy] listening :${listenPort} → ${workerHost}:{${upstreams.join(",")}} browseMax=${browseMaxInflight}`,
    );
  });
}

module.exports = {
  createOriginProxyServer,
  DEFAULT_UPSTREAM_TIMEOUT_MS,
  DEFAULT_BROWSE_MAX_PER_WORKER,
  isBrowseProxyPath,
};

if (require.main === module) {
  main();
}
