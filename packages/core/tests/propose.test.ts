/**
 * propose: privacy gate, signature, and endpoint shape tests.
 *
 * Server contract (merged main):
 *   POST /api/v1/skills/:author/:slug/proposals → 201
 *   { proposal_id, proposed_hash, state, proposal_url, scan }
 *   NOTE: server uses `proposal_url`, not `review_url`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { canonicalContentHash, type BundleFiles } from "@skillet/protocol";

interface MockCall {
  url: string;
  method: string;
  body: unknown;
}

function mockFetch(
  responder: (call: MockCall) => { status: number; body: unknown },
): { fetch: typeof fetch; calls: MockCall[] } {
  const calls: MockCall[] = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const call: MockCall = {
      url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
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
  registryUrl = "https://r.test",
): Promise<{ keyId: string }> {
  const { generateAuthorKey, saveAuthorKey } = await import("../src/signing/index.js");
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

describe("propose", () => {
  let skilletDir: string;
  let configDir: string;

  beforeEach(async () => {
    skilletDir = await mkdtemp(join(tmpdir(), "skillet-prop-home-"));
    configDir = await mkdtemp(join(tmpdir(), "skillet-prop-cfg-"));
    // SKILLET_DIR covers both the kit state store and the identity file — the
    // tests that only set SKILLET_DIR without SKILLET_TOKEN should still resolve cleanly
    // leak into the real ~/.skillet. Set SKILLET_DIR here to fully isolate.
    process.env["SKILLET_DIR"] = skilletDir;
    vi.resetModules();
  });

  afterEach(async () => {
    await rm(skilletDir, { recursive: true, force: true });
    await rm(configDir, { recursive: true, force: true });
    delete process.env["SKILLET_DIR"];
  });

  it("refuses to propose when no identity is on disk", async () => {
    const { propose, ProposeError } = await import("../src/commands/propose.js");
    const { fetch, calls } = mockFetch(() => ({ status: 500, body: null }));
    await seedSkill("my-skill", CLEAN_SKILL);

    await expect(
      propose("my-skill", { configDir, fetchImpl: fetch }),
    ).rejects.toMatchObject({
      name: "ProposeError",
      code: "not_logged_in",
    });
    expect(calls).toHaveLength(0);
    void ProposeError;
  });

  it("refuses to propose a slug that is not in the kit", async () => {
    const { propose } = await import("../src/commands/propose.js");
    await seedIdentityAndKey(configDir);
    const { fetch, calls } = mockFetch(() => ({ status: 500, body: null }));

    await expect(
      propose("missing", { configDir, fetchImpl: fetch }),
    ).rejects.toMatchObject({ code: "skill_not_found" });
    expect(calls).toHaveLength(0);
  });

  // No client-side scan (U4/KTD2): propose defers to the registry proposal
  // route, which runs `secretsBlockingScan` at create AND approve. A real secret
  // is refused server-side (422) — surfaced here as a legible ProposeError — so
  // R5 holds without a divergent client gate.
  it("a real secret is blocked by the registry proposal gate, not a client pre-check (U4/R5)", async () => {
    const { propose } = await import("../src/commands/propose.js");
    await seedIdentityAndKey(configDir);
    await seedSkill("leaky", `# leaky\n\nuse ghp_${"a".repeat(36)} for auth.\n`);
    const { fetch, calls } = mockFetch((call) => {
      if (call.url.endsWith("/manifest")) return { status: 404, body: { error: "not_found" } };
      // Registry proposal-create route refuses the secret with a SINGULAR
      // `finding` (its established wire shape — the web form reads it too).
      return {
        status: 422,
        body: {
          error: "scan_blocked",
          message: "Proposal blocked: a credential was detected.",
          finding: { category: "secret", confidence: "high", file: "SKILL.md", lineStart: 3, lineEnd: 3, why: "token" },
        },
      };
    });

    // The 422 surfaces as a typed ProposeError, and the client normalizes the
    // singular `finding` into a `findings` array so the CLI can list file:line.
    const err = await propose("leaky", { configDir, fetchImpl: fetch }).catch((e) => e);
    expect(err).toMatchObject({ name: "ProposeError", code: "scan_blocked" });
    expect((err.detail as { findings: unknown[] }).findings).toHaveLength(1);
    // The bytes reached the registry proposal route (no client pre-check aborted).
    expect(calls.some((c) => c.method === "POST" && /\/proposals$/.test(c.url))).toBe(true);
  });

  it("proposes a clean skill with the §4 envelope and returns proposalUrl from proposal_url", async () => {
    const { propose } = await import("../src/commands/propose.js");
    const { keyId } = await seedIdentityAndKey(configDir);
    const contentHash = await seedSkill("my-skill", CLEAN_SKILL);
    const fakeProposalId = "prop-abc-123";

    const { fetch, calls } = mockFetch((call) => {
      if (call.url.endsWith("/manifest")) {
        return { status: 404, body: { error: "not_found" } };
      }
      expect(call.url).toMatch(/\/proposals$/);
      expect(call.method).toBe("POST");
      const body = call.body as {
        files: BundleFiles;
        base_hash: string | null;
        signature: { alg: string; key_id: string; sig: string };
      };
      expect(body.base_hash).toBeNull();
      expect(body.signature.alg).toBe("ed25519");
      expect(body.signature.key_id).toBe(keyId);
      expect(typeof body.signature.sig).toBe("string");
      expect(body.files["SKILL.md"]).toBeDefined();
      // Server returns proposal_url (not review_url)
      return {
        status: 201,
        body: {
          proposal_id: fakeProposalId,
          state: "pending",
          proposed_hash: contentHash,
          proposal_url: `/api/v1/skills/taylor/my-skill/proposals/${fakeProposalId}`,
          scan: { status: "pending" },
        },
      };
    });

    const result = await propose("my-skill", { configDir, fetchImpl: fetch });

    expect(result.proposalId).toBe(fakeProposalId);
    expect(result.hash).toBe(contentHash);
    expect(result.proposalUrl).toBe(
      `/api/v1/skills/taylor/my-skill/proposals/${fakeProposalId}`,
    );
    expect(calls.map((c) => c.url)).toEqual([
      "https://r.test/api/v1/skills/taylor/my-skill/manifest",
      "https://r.test/api/v1/skills/taylor/my-skill/proposals",
    ]);
  });

  it("passes the remote latest_hash as base_hash when the manifest exists", async () => {
    const { propose } = await import("../src/commands/propose.js");
    const { keyId } = await seedIdentityAndKey(configDir);
    const contentHash = await seedSkill("my-skill", CLEAN_SKILL);
    const remoteHash = "b".repeat(64);
    const fakeProposalId = "prop-xyz-456";

    const { fetch, calls } = mockFetch((call) => {
      if (call.url.endsWith("/manifest")) {
        return {
          status: 200,
          body: {
            author: "taylor",
            slug: "my-skill",
            skill_id: "taylor:my-skill",
            latest_hash: remoteHash,
            install_count: 0,
            versions: [],
          },
        };
      }
      const body = call.body as { base_hash: string | null };
      expect(body.base_hash).toBe(`sha256:${remoteHash}`);
      return {
        status: 201,
        body: {
          proposal_id: fakeProposalId,
          state: "pending",
          proposed_hash: contentHash,
          proposal_url: `/api/v1/skills/taylor/my-skill/proposals/${fakeProposalId}`,
          scan: { status: "pending" },
        },
      };
    });

    const result = await propose("my-skill", { configDir, fetchImpl: fetch });
    expect(result.proposalId).toBe(fakeProposalId);
    expect(calls).toHaveLength(2);
    void keyId;
  });

  it("surfaces stale-base 409 with a dedicated stale_base code and actionable message", async () => {
    const { propose, ProposeError } = await import("../src/commands/propose.js");
    await seedIdentityAndKey(configDir);
    const contentHash = await seedSkill("my-skill", CLEAN_SKILL);
    const differentHash = "c".repeat(64);

    const { fetch } = mockFetch((call) => {
      if (call.url.endsWith("/manifest")) {
        return {
          status: 200,
          body: {
            author: "taylor",
            slug: "my-skill",
            skill_id: "taylor:my-skill",
            latest_hash: differentHash,
            install_count: 0,
            versions: [],
          },
        };
      }
      return {
        status: 409,
        body: {
          error: "base_stale",
          message: "Proposal base_hash no longer matches the skill's current latest_hash. Re-propose from the current version.",
        },
      };
    });

    await expect(
      propose("my-skill", { configDir, fetchImpl: fetch }),
    ).rejects.toMatchObject({
      name: "ProposeError",
      code: "stale_base",
      message: /Re-propose|behind remote|latest/,
    });
    void contentHash;
    void ProposeError;
  });
});
