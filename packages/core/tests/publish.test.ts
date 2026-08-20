/**
 * Publish: privacy gate, signature, identical-content rejection, stale-base 409,
 * and end-state of the kit entry.
 *
 * Uses the bundle-based protocol: POST body has `files` (BundleFiles) +
 * `signature` §4 envelope. Mocks the registry fetch layer so no server needed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  canonicalContentHash,
  encodeBundle,
  decodeBundle,
  type BundleFiles,
} from "@skillet/protocol";
import { verifyEnvelope } from "../src/signing/envelope.js";

interface MockCall {
  url: string;
  method: string;
  body: unknown;
}

function mockFetch(
  responder: (call: MockCall) => { status: number; body: unknown }
): { fetch: typeof fetch; calls: MockCall[] } {
  const calls: MockCall[] = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const call: MockCall = {
      url,
      method: init?.method ?? "GET",
      body:
        typeof init?.body === "string"
          ? JSON.parse(init.body)
          : null,
    };
    calls.push(call);
    const { status, body } = responder(call);
    const text = body == null ? "" : JSON.stringify(body);
    return new Response(text, {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch: fetchImpl as typeof fetch, calls };
}

const CLEAN_SKILL = `---
name: my-skill
description: A test skill.
---

# my-skill

This skill does something useful.
`;

async function seedSkill(slug: string, content: string): Promise<string> {
  const { upsertSkill, skillContentDir, skillContentPath } = await import(
    "../src/kit/store.js"
  );
  await mkdir(skillContentDir(slug), { recursive: true });
  await writeFile(skillContentPath(slug), content, "utf8");
  const bundle = new Map([["SKILL.md", Buffer.from(content, "utf8")]]);
  const hash = canonicalContentHash(bundle);
  await upsertSkill({
    slug,
    name: slug,
    description: "",
    version: 1,
    hash,
    source: "local",
    importedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  return hash;
}

async function seedIdentityAndKey(
  configDir: string,
  registryUrl = "https://r.test"
): Promise<{ keyId: string }> {
  const { generateAuthorKey, saveAuthorKey } = await import(
    "../src/signing/index.js"
  );
  const { saveIdentity } = await import("../src/identity/index.js");
  const key = generateAuthorKey();
  await saveAuthorKey(key, configDir);
  await saveIdentity({
    handle: "taylor",
    keyId: key.keyId,
    registryUrl,
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  return { keyId: key.keyId };
}

async function seedSessionToken(token: string): Promise<void> {
  const { sessionFilePath } = await import("../src/session-token.js");
  await writeFile(sessionFilePath(), JSON.stringify({ session_token: token }), "utf8");
}

describe("publish", () => {
  let skilletDir: string;
  let configDir: string;

  beforeEach(async () => {
    skilletDir = await mkdtemp(join(tmpdir(), "skillet-pub-skillet-"));
    configDir = await mkdtemp(join(tmpdir(), "skillet-pub-cfg-"));
    process.env["SKILLET_DIR"] = skilletDir;
    vi.resetModules();
  });

  afterEach(async () => {
    await rm(skilletDir, { recursive: true, force: true });
    await rm(configDir, { recursive: true, force: true });
    delete process.env["SKILLET_DIR"];
  });

  it("refuses to publish when no identity is on disk", async () => {
    const { publish, PublishError } = await import("../src/commands/publish.js");
    const { fetch, calls } = mockFetch(() => ({ status: 500, body: null }));
    await seedSkill("my-skill", CLEAN_SKILL);

    await expect(
      publish("my-skill", { configDir, fetchImpl: fetch })
    ).rejects.toMatchObject({
      name: "PublishError",
      code: "not_logged_in",
    });
    expect(calls).toHaveLength(0);
    void PublishError;
  });

  it("refuses to publish a slug that is not in the kit", async () => {
    const { publish } = await import("../src/commands/publish.js");
    await seedIdentityAndKey(configDir);
    const { fetch, calls } = mockFetch(() => ({ status: 500, body: null }));

    await expect(
      publish("missing", { configDir, fetchImpl: fetch })
    ).rejects.toMatchObject({ code: "skill_not_found" });
    expect(calls).toHaveLength(0);
  });

  it("no client scan: a token that the old regex flagged now POSTs — the registry is the gate (U4/R4)", async () => {
    const { publish } = await import("../src/commands/publish.js");
    await seedIdentityAndKey(configDir);
    // This ghp_ token would have hard-blocked the retired client scan. With the
    // client gate gone, publish() forwards it to the registry, which (for a real
    // secret) would 422 — here the mock accepts it, proving no local pre-check
    // aborts before the POST. Placeholders pass the registry benign-corpus, so
    // desktop == web.
    await seedSkill("leaky", `# leaky\n\nuse ghp_${"a".repeat(36)} for auth.\n`);
    const { fetch, calls } = mockFetch((call) => {
      if (call.url.endsWith("/manifest")) return { status: 404, body: { error: "not_found" } };
      return {
        status: 201,
        body: {
          hash: "sha256:abc",
          skill_id: "taylor:leaky",
          version_url: "/api/v1/skills/taylor/leaky/versions/sha256:abc",
        },
      };
    });

    const res = await publish("leaky", { configDir, fetchImpl: fetch, visibility: "public" });
    expect(res.alreadyExists).toBe(false);
    // The bytes reached the registry — no client pre-check aborted (KTD3).
    expect(calls.some((c) => c.method === "POST" && /\/skills$/.test(c.url))).toBe(true);
  });

  it("the registry gate (not the client) blocks a real secret with scan_blocked (U4/R5)", async () => {
    const { publish } = await import("../src/commands/publish.js");
    await seedIdentityAndKey(configDir);
    await seedSkill("leaky", `# leaky\n\nuse ghp_${"a".repeat(36)} for auth.\n`);
    const { fetch } = mockFetch((call) => {
      if (call.url.endsWith("/manifest")) return { status: 404, body: { error: "not_found" } };
      // Registry refuses a real secret at the publish route.
      return {
        status: 422,
        body: {
          error: "scan_blocked",
          reason: "secret",
          status: "quarantined",
          message: "Publish blocked: a credential was detected.",
          findings: [
            { category: "github-pat", confidence: "high", file: "SKILL.md", lineStart: 3, lineEnd: 3, why: "token" },
          ],
        },
      };
    });

    await expect(
      publish("leaky", { configDir, fetchImpl: fetch, visibility: "public" })
    ).rejects.toMatchObject({ code: "scan_blocked" });
  });

  it("surfaces the registry flagged verdict on a successful publish (U4)", async () => {
    const { publish } = await import("../src/commands/publish.js");
    await seedIdentityAndKey(configDir);
    await seedSkill("my-skill", CLEAN_SKILL);
    const { fetch } = mockFetch((call) => {
      if (call.url.endsWith("/manifest")) return { status: 404, body: { error: "not_found" } };
      return {
        status: 201,
        body: {
          hash: "sha256:def",
          skill_id: "taylor:my-skill",
          version_url: "/api/v1/skills/taylor/my-skill/versions/sha256:def",
          scan: {
            status: "flagged",
            findings: [
              { category: "obfuscation", confidence: "medium", file: "SKILL.md", lineStart: 6, lineEnd: 6, why: "base64" },
            ],
          },
        },
      };
    });

    const res = await publish("my-skill", { configDir, fetchImpl: fetch });
    expect(res.serverScan?.status).toBe("flagged");
    expect(res.serverScan?.findings).toHaveLength(1);
  });

  it("publishes a clean skill, signs with the §4 envelope, and updates the kit entry", async () => {
    const { publish } = await import("../src/commands/publish.js");
    const { readState } = await import("../src/kit/store.js");
    const { loadAuthorKeyById } = await import("../src/signing/index.js");
    const { keyId } = await seedIdentityAndKey(configDir);
    const contentHash = await seedSkill("my-skill", CLEAN_SKILL);

    const { fetch, calls } = mockFetch((call) => {
      if (call.url.endsWith("/manifest")) {
        return { status: 404, body: { error: "not_found" } };
      }
      expect(call.url).toMatch(/\/skills$/);
      expect(call.method).toBe("POST");
      const body = call.body as {
        author: string;
        slug: string;
        files: BundleFiles;
        base_hash: string | null;
        signature: { alg: string; key_id: string; sig: string };
      };
      expect(body).toMatchObject({
        author: "taylor",
        slug: "my-skill",
        base_hash: null,
      });
      expect(body.signature.alg).toBe("ed25519");
      expect(body.signature.key_id).toBe(keyId);
      expect(typeof body.signature.sig).toBe("string");
      // Verify files contains SKILL.md
      expect(body.files["SKILL.md"]).toBeDefined();
      return {
        status: 201,
        body: {
          hash: contentHash,
          skill_id: "taylor:my-skill",
          version_url: `/api/v1/skills/taylor/my-skill/versions/${contentHash}`,
        },
      };
    });

    const result = await publish("my-skill", { configDir, fetchImpl: fetch });

    expect(result.hash).toBe(contentHash);
    expect(result.hashRef).toBe(contentHash); // canonicalContentHash already has sha256: prefix
    expect(result.alreadyExists).toBe(false);
    expect(calls.map((c) => c.url)).toEqual([
      "https://r.test/api/v1/skills/taylor/my-skill/manifest",
      "https://r.test/api/v1/skills",
    ]);

    // Verify the §4 v2 envelope binds ref + version + content hash.
    const postBody = calls[1]!.body as {
      signature: { key_id: string; sig: string; sig_version?: number };
    };
    const key = await loadAuthorKeyById(configDir, keyId);
    expect(postBody.signature.sig_version).toBe(2);
    expect(() =>
      verifyEnvelope(contentHash, postBody.signature as import("../src/signing/envelope.js").Ed25519Signature, key.publicKey, {
        expectedKeyId: keyId,
        binding: {
          ref: "@taylor/my-skill",
          version: 2,
          authorKeyId: keyId,
        },
      }),
    ).not.toThrow();

    // Kit entry should be registry-tracked with the author key id.
    const state = await readState();
    expect(state.skills["my-skill"]).toMatchObject({
      source: "registry",
      authorKeyId: keyId,
      registryUrl: "https://r.test",
      hash: contentHash,
    });
  });

  it("treats identical remote content as alreadyExists no-op (no POST)", async () => {
    // Formerly threw identical_content; now returns alreadyExists=true
    // so bulk publish doesn't error on already-current skills.
    const { publish } = await import("../src/commands/publish.js");
    await seedIdentityAndKey(configDir);
    const contentHash = await seedSkill("my-skill", CLEAN_SKILL);

    const { fetch, calls } = mockFetch((call) => {
      if (call.url.endsWith("/manifest")) {
        return {
          status: 200,
          body: {
            author: "taylor",
            slug: "my-skill",
            skill_id: "taylor:my-skill",
            latest_hash: contentHash.replace("sha256:", ""),
            install_count: 0,
            versions: [],
          },
        };
      }
      throw new Error(`unexpected request: ${call.url}`);
    });

    const result = await publish("my-skill", { configDir, fetchImpl: fetch });
    expect(result.alreadyExists).toBe(true);
    expect(result.hash).toBe(contentHash);

    // Only manifest GET — no POST to /v1/skills.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain("/manifest");
  });

  it("surfaces stale-base 409 with a clear refusal", async () => {
    const { publish } = await import("../src/commands/publish.js");
    await seedIdentityAndKey(configDir);
    const contentHash = await seedSkill("my-skill", CLEAN_SKILL);
    const differentHash = "a".repeat(64);

    const { fetch } = mockFetch((call) => {
      if (call.url.endsWith("/manifest")) {
        return {
          status: 200,
          body: { latest_hash: differentHash },
        };
      }
      return {
        status: 409,
        body: {
          error: "conflict",
          message: "Local is behind remote. Fetch the latest diff and re-publish.",
          latest_hash: differentHash,
        },
      };
    });

    await expect(
      publish("my-skill", { configDir, fetchImpl: fetch })
    ).rejects.toMatchObject({
      code: "stale_base",
      message: /Local is behind remote/,
    });
    void contentHash;
  });

  it("treats server 200 (no-op) as alreadyExists", async () => {
    const { publish } = await import("../src/commands/publish.js");
    await seedIdentityAndKey(configDir);
    const contentHash = await seedSkill("my-skill", CLEAN_SKILL);

    const { fetch } = mockFetch((call) => {
      if (call.url.endsWith("/manifest")) {
        return { status: 404, body: { error: "not_found" } };
      }
      return {
        status: 200,
        body: {
          hash: contentHash,
          skill_id: "taylor:my-skill",
          version_url: `/api/v1/skills/taylor/my-skill/versions/${contentHash}`,
          message: "Version already exists (no-op)",
        },
      };
    });

    const result = await publish("my-skill", { configDir, fetchImpl: fetch });
    expect(result.alreadyExists).toBe(true);
    expect(result.hash).toBe(contentHash);
  });

  // Malformed `requires:` blocks must be rejected at the publish
  // boundary, before signing/minting, so a bad dependency edge can never reach
  // a signed bundle.
  it("rejects a malformed requires block and never POSTs", async () => {
    const { publish } = await import("../src/commands/publish.js");
    await seedIdentityAndKey(configDir);
    await seedSkill(
      "bad-requires",
      `---
name: bad-requires
description: A skill with a malformed dependency edge.
requires:
  - skill: not-a-canonical-ref
---

# bad-requires
`
    );
    const { fetch, calls } = mockFetch(() => ({ status: 500, body: null }));

    await expect(
      publish("bad-requires", { configDir, fetchImpl: fetch })
    ).rejects.toMatchObject({
      name: "PublishError",
      code: "invalid_requires",
      message: /canonical @author\/slug ref/,
    });
    // Never reached the manifest fetch or the POST.
    expect(calls).toHaveLength(0);
  });

  // Regression: a leftover session token must NOT override the local signing
  // identity. With both a local identity AND a session token present, publish
  // must use the LOCAL Ed25519 key path (v2 signature), never session-attested.
  it("prefers the local signing key over a present session token", async () => {
    const { publish } = await import("../src/commands/publish.js");
    const { keyId } = await seedIdentityAndKey(configDir);
    const contentHash = await seedSkill("my-skill", CLEAN_SKILL);
    await seedSessionToken("stale-session-token");

    const { fetch, calls } = mockFetch((call) => {
      if (call.url.endsWith("/manifest")) {
        return { status: 404, body: { error: "not_found" } };
      }
      expect(call.url).toMatch(/\/skills$/);
      expect(call.method).toBe("POST");
      const body = call.body as {
        signature?: { alg: string; key_id: string; sig: string };
        publish_auth?: string;
      };
      // Local-key path: a real ed25519 signature, NOT session attestation.
      expect(body.publish_auth).toBeUndefined();
      expect(body.signature?.alg).toBe("ed25519");
      expect(body.signature?.key_id).toBe(keyId);
      expect(body.signature?.sig).not.toBe("");
      return {
        status: 201,
        body: {
          hash: contentHash,
          skill_id: "taylor:my-skill",
          version_url: `/api/v1/skills/taylor/my-skill/versions/${contentHash}`,
        },
      };
    });

    const result = await publish("my-skill", { configDir, fetchImpl: fetch });
    expect(result.alreadyExists).toBe(false);

    // The session-auth path would have hit /api/v1/whoami; the local path does not.
    expect(calls.some((c) => c.url.includes("/whoami"))).toBe(false);
    expect(calls.map((c) => c.url)).toEqual([
      "https://r.test/api/v1/skills/taylor/my-skill/manifest",
      "https://r.test/api/v1/skills",
    ]);
  });

  // AC #3: forward-compat unknown-key warnings are surfaced, not swallowed.
  it("surfaces requires: unknown-key warnings on a successful publish", async () => {
    const { publish } = await import("../src/commands/publish.js");
    await seedIdentityAndKey(configDir);
    const contentHash = await seedSkill(
      "warn-requires",
      `---
name: warn-requires
description: A skill with a forward-compat unknown requires key.
requires:
  - skill: "@alice/helper"
    note: this key is not in the schema yet
---

# warn-requires
`
    );

    const { fetch } = mockFetch((call) => {
      if (call.url.endsWith("/manifest")) {
        return { status: 404, body: { error: "not_found" } };
      }
      return {
        status: 201,
        body: {
          hash: contentHash,
          skill_id: "taylor:warn-requires",
          version_url: `/api/v1/skills/taylor/warn-requires/versions/${contentHash}`,
        },
      };
    });

    const result = await publish("warn-requires", { configDir, fetchImpl: fetch });
    expect(result.alreadyExists).toBe(false);
    expect(result.requiresWarnings).toHaveLength(1);
    expect(result.requiresWarnings[0]).toMatch(/unknown key "note"/);
  });
});
