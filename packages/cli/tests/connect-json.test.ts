import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "dist", "cli.cjs");

test("connect --json success omits session/device tokens", async () => {
  // Stub just enough registry for /connect/claim to succeed. The tokens the
  // server hands back must be persisted to SKILLET_DIR but never echoed on
  // stdout — stdout lands in logs and tray transcripts.
  const server = createServer((req, res) => {
    if (req.method === "POST" && req.url === "/api/v1/connect/claim") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          session_token: "skillet_s_test_secret",
          device_token: "skillet_d_test_secret",
          device_id: "11111111-2222-3333-4444-555555555555",
          handle: "tester",
          user_id: "66666666-7777-8888-9999-000000000000",
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as { port: number };
  const skilletDir = mkdtempSync(join(tmpdir(), "skillet-connect-json-"));
  try {
    // Async spawn: spawnSync would block the event loop and starve the stub
    // server above, so the CLI's claim request would never get a response.
    const child = spawn(
      process.execPath,
      [CLI, "connect", "ABCD2345", "--json", "--registry", `http://127.0.0.1:${addr.port}`],
      { env: { ...process.env, SKILLET_DIR: skilletDir } },
    );
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    await new Promise<void>((resolve) => child.on("close", () => resolve()));
    const body = JSON.parse(stdout.trim()) as Record<string, unknown>;
    assert.equal(body.ok, true);
    assert.equal(body.device_id, "11111111-2222-3333-4444-555555555555");
    assert.equal(body.handle, "tester");
    assert.ok(!("session_token" in body), "session_token must not reach stdout");
    assert.ok(!("device_token" in body), "device_token must not reach stdout");
    assert.ok(!stdout.includes("test_secret"), "no token material on stdout");
  } finally {
    server.close();
    rmSync(skilletDir, { recursive: true, force: true });
  }
});

test("connect --json writes error envelope to stdout", () => {
  // Point at an unreachable registry so the failure is deterministic. The old test
  // hit the default (prod) registry over the network and asserted its exact
  // "Invalid or expired code" text, which made it flaky in the full workspace run
  // (network variance / registry availability). `connect`'s catch writes the same
  // --json envelope on ANY error, so an unreachable URL exercises the contract
  // this test cares about — the error envelope shape — with no network dependency.
  const res = spawnSync(
    process.execPath,
    [CLI, "connect", "ABCD2345", "--json", "--registry", "http://127.0.0.1:1"],
    { encoding: "utf8" },
  );
  // Windows: libuv can assert on process exit after stdout is written; JSON is still authoritative.
  if (process.platform !== "win32") {
    assert.equal(res.status, 1);
  }
  const body = JSON.parse(res.stdout.trim()) as { ok: boolean; error?: string };
  assert.equal(body.ok, false);
  assert.equal(typeof body.error, "string");
  assert.ok((body.error ?? "").length > 0, "error envelope carries a message");
});
