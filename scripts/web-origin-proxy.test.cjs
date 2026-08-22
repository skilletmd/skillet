/**
 * Origin proxy regressions for Browse stampede / client abort.
 *
 *   node --test scripts/web-origin-proxy.test.cjs
 */
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const {
  createOriginProxyServer,
  DEFAULT_UPSTREAM_TIMEOUT_MS,
  isBrowseProxyPath,
  withVaryAccept,
} = require("./web-origin-proxy.js");

function listen(server, host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("expected TCP address"));
        return;
      }
      resolve(addr.port);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

/**
 * Resolve once headers (and an optional short body) arrive. Upstream may hold
 * the socket open; we must not wait for `end` in that case.
 */
function get(port, path, { expectComplete = false } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: "GET",
        headers: { accept: "text/html" },
      },
      (res) => {
        const chunks = [];
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        };
        res.on("data", (c) => {
          chunks.push(c);
          if (!expectComplete) finish();
        });
        res.on("end", finish);
        // Shed responses (429) may be empty-bodied; still settle on end.
        if (expectComplete || (res.statusCode && res.statusCode >= 400)) {
          // wait for end / data
        } else if (res.statusCode === 200) {
          // held upstream: settle on first chunk via data handler
        }
      },
    );
    req.on("error", reject);
    req.setTimeout(3000, () => {
      req.destroy(new Error(`get ${path} timed out`));
    });
    req.end();
  });
}

describe("isBrowseProxyPath", () => {
  it("matches Browse document paths only", () => {
    assert.equal(isBrowseProxyPath("/browse"), true);
    assert.equal(isBrowseProxyPath("/browse/mobile/people"), true);
    assert.equal(isBrowseProxyPath("/browse?q=x"), true);
    assert.equal(isBrowseProxyPath("/feed"), false);
    assert.equal(isBrowseProxyPath("/skills"), false);
    assert.equal(isBrowseProxyPath("/api/auth/session"), false);
  });
});

describe("web-origin-proxy client abort", () => {
  /** @type {import('node:http').Server} */
  let upstream;
  /** @type {ReturnType<typeof createOriginProxyServer>} */
  let proxy;
  let proxyPort = 0;
  /** @type {Set<import('node:http').IncomingMessage>} */
  const liveUpstreamReqs = new Set();
  let peakUpstream = 0;
  /** @type {import('node:http').ServerResponse[]} */
  let heldResponses = [];

  before(async () => {
    upstream = http.createServer((req, res) => {
      liveUpstreamReqs.add(req);
      peakUpstream = Math.max(peakUpstream, liveUpstreamReqs.size);
      heldResponses.push(res);
      const drop = () => {
        liveUpstreamReqs.delete(req);
      };
      req.on("close", drop);
      req.on("aborted", drop);
      res.writeHead(200, { "content-type": "text/plain" });
      res.write("partial\n");
    });
    const upstreamPort = await listen(upstream);

    proxy = createOriginProxyServer({
      listenPort: 0,
      workerBase: upstreamPort,
      workerCount: 1,
      workerHost: "127.0.0.1",
      upstreamTimeoutMs: 30_000,
      // Abort test holds one Browse request; keep admission out of the way.
      browseMaxInflight: 32,
    });
    proxyPort = await listen(proxy.server);
  });

  after(async () => {
    for (const res of heldResponses) {
      if (!res.writableEnded && !res.destroyed) {
        try {
          res.end("done\n");
        } catch {
          // already torn down
        }
      }
    }
    heldResponses = [];
    if (proxy?.server.listening) await close(proxy.server);
    if (upstream?.listening) await close(upstream);
  });

  it("destroys the upstream when the client aborts mid-response", async () => {
    liveUpstreamReqs.clear();
    peakUpstream = 0;

    await new Promise((resolve, reject) => {
      const clientReq = http.request(
        {
          hostname: "127.0.0.1",
          port: proxyPort,
          path: "/browse/mobile",
          method: "GET",
          headers: { accept: "text/html" },
        },
        (res) => {
          res.on("data", () => {});
          setTimeout(() => {
            clientReq.destroy();
          }, 40);
        },
      );
      clientReq.on("error", () => {
        resolve();
      });
      clientReq.on("close", () => resolve());
      clientReq.end();
      setTimeout(() => reject(new Error("client abort timed out")), 3000);
    });

    const deadline = Date.now() + 2000;
    while (liveUpstreamReqs.size > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }

    assert.ok(peakUpstream >= 1, "upstream should have accepted the proxied request");
    assert.equal(
      liveUpstreamReqs.size,
      0,
      "client abort must tear down upstream so Next is not left rendering",
    );
  });

  it("defaults upstream timeout well under the old 120s hold", () => {
    assert.equal(DEFAULT_UPSTREAM_TIMEOUT_MS, 25_000);
    const fresh = createOriginProxyServer({
      listenPort: 0,
      workerBase: 39999,
      workerCount: 1,
    });
    assert.equal(fresh.upstreamTimeoutMs, 25_000);
  });
});

describe("web-origin-proxy browse admission", () => {
  /** @type {import('node:http').Server} */
  let upstream;
  /** @type {ReturnType<typeof createOriginProxyServer>} */
  let proxy;
  let proxyPort = 0;
  let upstreamHits = 0;
  /** @type {import('node:http').ServerResponse[]} */
  let held = [];

  before(async () => {
    upstream = http.createServer((req, res) => {
      upstreamHits += 1;
      held.push(res);
      res.writeHead(200, { "content-type": "text/plain" });
      res.write("held\n");
      // Stay open until the test ends or releases.
    });
    const upstreamPort = await listen(upstream);

    proxy = createOriginProxyServer({
      listenPort: 0,
      workerBase: upstreamPort,
      workerCount: 1,
      workerHost: "127.0.0.1",
      browseMaxInflight: 1,
    });
    proxyPort = await listen(proxy.server);
  });

  after(async () => {
    for (const res of held) {
      if (!res.writableEnded && !res.destroyed) {
        try {
          res.end("done\n");
        } catch {
          // torn down
        }
      }
    }
    held = [];
    if (proxy?.server.listening) await close(proxy.server);
    if (upstream?.listening) await close(upstream);
  });

  it("rejects surplus Browse requests with 429 before opening upstream", async () => {
    upstreamHits = 0;

    const first = http.request(
      {
        hostname: "127.0.0.1",
        port: proxyPort,
        path: "/browse/database/people",
        method: "GET",
      },
      (res) => {
        res.on("data", () => {});
      },
    );
    first.end();

    // Wait until the first request is held upstream.
    const deadline = Date.now() + 2000;
    while (upstreamHits < 1 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(upstreamHits, 1);

    const shed = await get(proxyPort, "/browse/mobile");
    assert.equal(shed.status, 429);
    assert.equal(shed.headers["retry-after"], "1");
    assert.match(shed.body, /browse capacity/i);
    assert.equal(upstreamHits, 1, "shed Browse must not touch Next");

    // Non-Browse stays admitted while Browse is saturated.
    const feed = await get(proxyPort, "/feed");
    assert.equal(feed.status, 200);
    assert.equal(upstreamHits, 2);

    // Release the held Browse slot, then a new Browse must get through.
    const heldBrowse = held[0];
    assert.ok(heldBrowse);
    heldBrowse.end("done\n");

    const reopenDeadline = Date.now() + 2000;
    while (Date.now() < reopenDeadline) {
      const again = await get(proxyPort, "/browse");
      if (again.status === 200) {
        assert.ok(upstreamHits >= 3);
        return;
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.fail("Browse should admit again after an in-flight slot frees");
  });

  it("defaults browse max inflight from worker count when unset", () => {
    const fresh = createOriginProxyServer({
      listenPort: 0,
      workerBase: 39999,
      workerCount: 2,
    });
    assert.equal(fresh.browseMaxInflight, 8);
  });
});

// Every page has a Markdown twin at the same URL, so an HTML document leaving
// this origin must tell caches it varies on Accept. Next overwrites `Vary` when
// it serves a prerendered app-router page, so `proxy.ts` cannot be the last
// word — this hop is.
describe("Vary: Accept on HTML documents", () => {
  it("appends Accept to whatever Vary Next produced", () => {
    const out = withVaryAccept({
      "content-type": "text/html; charset=utf-8",
      vary: "rsc, next-router-state-tree, Accept-Encoding",
    });
    assert.equal(out.vary, "rsc, next-router-state-tree, Accept-Encoding, Accept");
  });

  it("sets Vary when the upstream had none", () => {
    assert.equal(withVaryAccept({ "content-type": "text/html" }).vary, "Accept");
  });

  it("is idempotent, case-insensitively", () => {
    for (const vary of ["Accept", "accept, Accept-Encoding"]) {
      const headers = { "content-type": "text/html", vary };
      assert.equal(withVaryAccept(headers).vary, vary);
    }
  });

  it("leaves Vary: * alone", () => {
    assert.equal(withVaryAccept({ "content-type": "text/html", vary: "*" }).vary, "*");
  });

  it("touches nothing that is not an HTML document", () => {
    for (const type of ["application/json", "text/markdown; charset=utf-8", "image/png", undefined]) {
      const headers = { "content-type": type, vary: "Accept-Encoding" };
      assert.equal(withVaryAccept(headers).vary, "Accept-Encoding", String(type));
    }
  });

  it("normalizes an array-valued Vary from the upstream", () => {
    const out = withVaryAccept({
      "content-type": "text/html",
      vary: ["rsc", "Accept-Encoding"],
    });
    assert.equal(out.vary, "rsc, Accept-Encoding, Accept");
  });

  it("reaches the wire", async () => {
    const upstream = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", vary: "rsc" });
      res.end("<html></html>");
    });
    const upstreamPort = await listen(upstream);
    const { server } = createOriginProxyServer({ listenPort: 0, workerBase: upstreamPort, workerCount: 1 });
    const proxyPort = await listen(server);
    try {
      const res = await get(proxyPort, "/docs", { expectComplete: true });
      assert.equal(res.headers.vary, "rsc, Accept");
    } finally {
      await close(server);
      await close(upstream);
    }
  });
});
