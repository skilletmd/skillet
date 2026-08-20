// U3 (key-rotation recovery plan): `skillet pin accept` works end-to-end for
// unclaimed (platform-attested) handles, keeps the consent boundary (`--yes`
// is consent; `--token` is credentials only), and is idempotent — an accept on
// an already-matching pin still invalidates the caches that can mask a
// rotation (etag entries + per-skill re-verify flag).
//
// The CLI is spawned against a local fake registry that serves the sync
// manifest + skill manifest with a platform identity, the way the real
// registry answers for a mirror handle after the manifest-route fix (U1).
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer, type Server } from "node:http";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "dist", "cli.cjs");
const execFileAsync = promisify(execFile);

/** Async spawn — a sync spawn would block this process's event loop and
 *  deadlock the in-process fake registry server. */
async function runCli(
  args: string[],
  env: Record<string, string | undefined>,
): Promise<{ status: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI, ...args], {
      encoding: "utf8",
      env,
      timeout: 30_000,
    });
    return { status: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { status: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

function ed25519(): { keyId: string; pub: string } {
  const { publicKey } = generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" }) as { x: string };
  const raw = Buffer.from(jwk.x, "base64url");
  return { keyId: raw.toString("hex"), pub: raw.toString("base64") };
}

const platformKey = ed25519();
const oldKey = ed25519();

let server: Server;
let registryUrl: string;

before(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? "";
    if (url.includes("/sync/manifest")) {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          schema_version: 1,
          etag: "sha256:" + "0".repeat(64),
          sync_interval_seconds: null,
          account_scope: "user",
          items: [
            {
              ref: "@mirror-brand/tool",
              version: 1,
              content_hash: "sha256:" + "11".repeat(32),
              signature: { alg: "ed25519", key_id: platformKey.keyId, sig: "x" },
              author_key_id: platformKey.keyId,
              policy: "manual",
              source_kit: null,
              external_author: true,
            },
          ],
        }),
      );
      return;
    }
    if (url.endsWith("/manifest")) {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          author: "mirror-brand",
          slug: "tool",
          skill_id: "mirror-brand:tool",
          latest_hash: "11".repeat(32),
          install_count: 0,
          author_key_id: platformKey.keyId,
          author_public_key: platformKey.pub,
          versions: [
            {
              hash: "11".repeat(32),
              published_at: 100,
              url: "/api/v1/skills/mirror-brand/tool/versions/" + "11".repeat(32),
              signature: { alg: "ed25519", key_id: platformKey.keyId, sig: "x" },
            },
          ],
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (addr === null || typeof addr === "string") throw new Error("no port");
  registryUrl = `http://127.0.0.1:${addr.port}`;
});

after(() => {
  server.close();
});

interface Sandbox {
  skilletDir: string;
  configHome: string;
  pinPath: string;
  etagPath: string;
  statePath: string;
  env: Record<string, string | undefined>;
}

/** Fresh SKILLET_DIR + XDG_CONFIG_HOME with a pinned key, a state entry for
 *  the mirror handle, and a warm etag cache — the masked post-rotation state. */
function seedSandbox(pinnedKey: { keyId: string; pub: string }): Sandbox {
  const root = mkdtempSync(join(tmpdir(), "skillet-pin-accept-"));
  const skilletDir = join(root, ".skillet");
  const configHome = join(root, ".config");
  const pinDir = join(configHome, "skillet", "pinned");
  mkdirSync(skilletDir, { recursive: true });
  mkdirSync(pinDir, { recursive: true });
  const pinPath = join(pinDir, "mirror-brand.pub.json");
  writeFileSync(
    pinPath,
    JSON.stringify({
      key_id: pinnedKey.keyId,
      alg: "ed25519",
      pub: pinnedKey.pub,
      pinned_at: "2026-07-01T00:00:00.000Z",
      first_seen_version: 1,
    }),
  );
  const statePath = join(skilletDir, "state.json");
  writeFileSync(
    statePath,
    JSON.stringify({
      version: 1,
      skills: {
        "@mirror-brand/tool": {
          slug: "@mirror-brand/tool",
          owner: "mirror-brand",
          name: "tool",
          description: "x",
          version: 1,
          hash: "sha256:" + "11".repeat(32),
          source: "registry",
          registryUrl,
          authorKeyId: pinnedKey.keyId,
          authorPubBase64: pinnedKey.pub,
          importedAt: "2026-07-01T00:00:00Z",
          updatedAt: "2026-07-01T00:00:00Z",
        },
      },
    }),
  );
  const etagPath = join(skilletDir, "etag-cache.json");
  writeFileSync(
    etagPath,
    JSON.stringify({
      version: 1,
      entries: { "@mirror-brand/tool": '"warm"' },
      union: { [`${registryUrl}|dev|device`]: '"warm-union"' },
    }),
  );
  return {
    skilletDir,
    configHome,
    pinPath,
    etagPath,
    statePath,
    env: {
      ...process.env,
      SKILLET_DIR: skilletDir,
      XDG_CONFIG_HOME: configHome,
      SKILLET_REGISTRY_URL: registryUrl,
      SKILLET_TOKEN: undefined,
    },
  };
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

interface StateShape {
  skills: Record<string, { needsKeyReverify?: boolean; authorKeyId?: string }>;
}
interface EtagShape {
  entries: Record<string, string>;
  union?: Record<string, string>;
}
interface PinShape {
  key_id: string;
}

test("pin accept --yes re-pins an unclaimed handle to the platform key and invalidates", async () => {
  const sb = seedSandbox(oldKey);
  const res = await runCli(
    ["pin", "accept", "mirror-brand", "--yes", "--token", "skillet_d_test"],
    sb.env,
  );
  assert.equal(res.status, 0, res.stderr + res.stdout);
  assert.match(res.stdout, /Re-pinned @mirror-brand/);

  assert.equal(readJson<PinShape>(sb.pinPath).key_id, platformKey.keyId);
  const state = readJson<StateShape>(sb.statePath);
  assert.equal(state.skills["@mirror-brand/tool"].needsKeyReverify, true);
  const etag = readJson<EtagShape>(sb.etagPath);
  assert.equal(etag.entries["@mirror-brand/tool"], undefined);
  assert.deepEqual(etag.union ?? {}, {});
});

test("non-TTY pin accept without --yes refuses even with --token (credentials are not consent)", async () => {
  const sb = seedSandbox(oldKey);
  const res = await runCli(["pin", "accept", "mirror-brand", "--token", "skillet_d_test"], sb.env);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /Re-run with --yes/);
  // Nothing changed: pin still old, no flag, etag intact.
  assert.equal(readJson<PinShape>(sb.pinPath).key_id, oldKey.keyId);
  const state = readJson<StateShape>(sb.statePath);
  assert.equal(state.skills["@mirror-brand/tool"].needsKeyReverify, undefined);
  assert.equal(readJson<EtagShape>(sb.etagPath).entries["@mirror-brand/tool"], '"warm"');
});

test("pin accept on an already-matching pin still invalidates (idempotent recovery)", async () => {
  const sb = seedSandbox(platformKey);
  const res = await runCli(["pin", "accept", "mirror-brand", "--token", "skillet_d_test"], sb.env);
  assert.equal(res.status, 0, res.stderr + res.stdout);
  assert.match(res.stdout, /already pinned to the registry key/);

  const state = readJson<StateShape>(sb.statePath);
  assert.equal(state.skills["@mirror-brand/tool"].needsKeyReverify, true);
  const etag = readJson<EtagShape>(sb.etagPath);
  assert.equal(etag.entries["@mirror-brand/tool"], undefined);
});

test("pin accept sandbox never touches the suite XDG pin dir", () => {
  // The scrub-env preload sandboxes XDG_CONFIG_HOME for the whole suite; the
  // per-test sandboxes above override it per spawn. Guard the invariant that
  // the suite-level dir stays empty — a regression here means a test wrote
  // pins outside its sandbox.
  const suitePinDir = join(process.env["XDG_CONFIG_HOME"] ?? "", "skillet", "pinned");
  assert.equal(existsSync(suitePinDir), false);
});
